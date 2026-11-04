// AI 总管的调用流程：用假接口跑通分发、额度、重试、暂停、JSON 解析和记账，不连任何真实接口、不花钱。
import { describe, expect, test } from 'vitest';
import { createAi } from '../../../index.mjs';
import { fakeProvider, fakeSearcher, night, setup } from '../../../test/复用/假接口.mjs';
import { DEFAULT_CONFIG } from '../../config.mjs';
import { AiError } from '../../errors.mjs';
import { createKeyStore } from '../../keys.mjs';
import { createUsageStore } from '../../usage.mjs';

describe('分发', () => {
  test('带工具的对话：tools 和 toolChoice 原样交给接口（赛事助手最后一轮要强制不再调工具，2026-11-01）', async () => {
    const { ai, ds } = setup();
    const tools = [{ type: 'function', function: { name: 'search_competitions', parameters: { type: 'object', properties: {} } } }];
    await ai.session({ source: '实时', module: '赛事助手' }).chat({ purpose: 'assistant', messages: [], tools, toolChoice: 'none' });
    expect(ds.calls[0].tools).toEqual(tools);
    expect(ds.calls[0].toolChoice).toBe('none');
  });
  test('按用途发给配置里的那家接口和模型，用量按会话身份记账', async () => {
    const { ai, usage, ds, cx } = setup();
    const s = ai.session(night);
    const r = await s.chat({ purpose: 'extract', messages: [{ role: 'user', content: '抽字段' }], promptVersion: 'extract-v1' });
    await ai.session({ ...night, module: '03-filter' }).chat({ purpose: 'trace', messages: [] });
    expect(r.message.content).toBe('好');
    expect(ds.calls[0].model).toBe('deepseek-flash');
    expect(ds.calls[0].key).toBe('sk-test-0000000000');
    expect(cx.calls).toHaveLength(1);
    expect(usage.ofModule('2026-10-29', '04-extract')).toMatchObject({ calls: 1, ok: 1, tokensIn: 100, tokensOut: 20 });
    expect(usage.ofRun('2026-10-29').modules.map(m => m.module)).toEqual(['03-filter', '04-extract']);
  });
  test('用途不存在、还没指定接口、能力对不上：直接报“请求有误”，不发请求', async () => {
    const purposes = { ...DEFAULT_CONFIG.purposes, 待定: { 能力: 'chat', provider: null, model: null } };
    const { ai, ds } = setup({ config: { purposes } });
    const s = ai.session(night);
    await expect(s.chat({ purpose: '不存在', messages: [] })).rejects.toMatchObject({ kind: '请求有误' });
    await expect(s.chat({ purpose: '待定', messages: [] })).rejects.toThrow('还没指定');
    await expect(s.chat({ purpose: 'search', messages: [] })).rejects.toThrow('不能当 chat 用');
    await expect(s.chat({ purpose: 'review', messages: [] })).rejects.toThrow('没有 chat 能力');   // 这里没装 Kimi
    expect(ds.calls).toHaveLength(0);
  });
  test('开会话必须写明来源', () => {
    const { ai } = setup();
    expect(() => ai.session({})).toThrow('来源');
  });
});

describe('重试和暂停', () => {
  test('429 退避后重试，成功后照常返回；每次尝试都记账', async () => {
    const { ai, usage } = setup({ deepseek: [new AiError('请求太多', '429'), '好'] });
    const r = await ai.session(night).chat({ purpose: 'extract', messages: [] });
    expect(r.usage.attempts).toBe(2);
    expect(usage.ofModule('2026-10-29', '04-extract')).toMatchObject({ calls: 2, ok: 1, failed: 1 });
  });
  test('请求有误不重试', async () => {
    const { ai, ds } = setup({ deepseek: [new AiError('请求有误', '400')] });
    await expect(ai.session(night).chat({ purpose: 'extract', messages: [] })).rejects.toMatchObject({ kind: '请求有误' });
    expect(ds.calls).toHaveLength(1);
  });
  test('密钥错误：不重试，这家接口暂停，后面的调用直接返回“已暂停”', async () => {
    const { ai, ds } = setup({ deepseek: [new AiError('密钥错误', '401')] });
    const s = ai.session(night);
    await expect(s.chat({ purpose: 'extract', messages: [] })).rejects.toMatchObject({ kind: '密钥错误' });
    await expect(s.chat({ purpose: 'arbitrate', messages: [] })).rejects.toMatchObject({ kind: '已暂停' });
    expect(ds.calls).toHaveLength(1);
  });
  test('连续失败到上限就暂停', async () => {
    const { ai, ds } = setup({ deepseek: [new AiError('对方出错', '502')], config: { breaker: { failures: 2, pauseMs: 60000 } } });
    const s = ai.session(night);
    await expect(s.chat({ purpose: 'extract', messages: [] })).rejects.toMatchObject({ kind: '已暂停' });
    expect(ds.calls).toHaveLength(2);
  });
  test('没有密钥：报“密钥错误”，报错里不会出现密钥原文', async () => {
    const usage = createUsageStore(':memory:');
    const keys = createKeyStore({ env: {} });
    const ds = fakeProvider('deepseek', ['好']);
    const ai = createAi({ config: { ...DEFAULT_CONFIG, retry: { attempts: 1, backoffMs: 0 } }, providers: { deepseek: ds.provider }, usage, keys });
    await expect(ai.session(night).chat({ purpose: 'extract', messages: [] })).rejects.toMatchObject({ kind: '密钥错误' });
    const leaky = createKeyStore({ env: { AI_KEY_DEEPSEEK: 'sk-very-secret-123456' } });
    leaky.get('deepseek');
    expect(leaky.mask('Bearer sk-very-secret-123456 无效')).not.toContain('sk-very-secret-123456');
  });
});

describe('额度和 JSON', () => {
  test('会话额度用完：报“额度用完”，不发请求', async () => {
    const { ai, ds } = setup({ config: { lanes: { ...DEFAULT_CONFIG.lanes, batch: { concurrency: 2, budget: 2 } } } });
    const s = ai.session(night);
    await s.chat({ purpose: 'extract', messages: [] });
    await s.chat({ purpose: 'extract', messages: [] });
    expect(s.budgetLeft()).toBe(0);
    await expect(s.chat({ purpose: 'extract', messages: [] })).rejects.toMatchObject({ kind: '额度用完' });
    expect(ds.calls).toHaveLength(2);
  });
  test('报告问题：接口调用成功但返回的内容调用方用不了（漏条目、结论不对），按会话身份记下，不占调用次数', async () => {
    const { ai, usage } = setup({ config: { lanes: { ...DEFAULT_CONFIG.lanes, batch: { concurrency: 2, budget: 1 } } } });
    const s = ai.session({ ...night, module: '02-dedup' });
    s.报告问题({ purpose: 'arbitrate', promptVersion: 'dedup-v1', 原因: '漏了 2 条候选的结论' });
    expect(s.budgetLeft()).toBe(1);
    expect(usage.problemsOf('2026-10-29')).toEqual([expect.objectContaining({
      source: '每晚自动化', run_id: '2026-10-29', module: '02-dedup', purpose: 'arbitrate', prompt_version: 'dedup-v1', reason: '漏了 2 条候选的结论' })]);
    expect(usage.ofRun('2026-10-29')).toMatchObject({ calls: 0 });
    expect(() => s.报告问题({ purpose: 'arbitrate' })).toThrow('原因');
  });
  test('按日期查问题：某天（北京时间）以来所有来源报告的，新的在前（给后台“失败任务”页）', () => {
    let 现在 = new Date('2026-10-28T01:00:00Z');
    const usage = createUsageStore(':memory:', { now: () => 现在 });
    usage.recordProblem({ identity: { source: '维护' }, purpose: 'verify', reason: '太早' });
    现在 = new Date('2026-10-29T17:30:00Z');   // 北京 10-30 01:30
    usage.recordProblem({ identity: { source: '每晚自动化', runId: '2026-10-30', module: '02-dedup' }, purpose: 'arbitrate', reason: '漏了条目' });
    现在 = new Date('2026-10-31T02:00:00Z');
    usage.recordProblem({ identity: { source: '维护' }, purpose: 'verify', reason: '结论不在规定里' });
    expect(usage.problemsSince('2026-10-30').map(p => p.reason)).toEqual(['结论不在规定里', '漏了条目']);
  });
  test('要 JSON：剥掉代码块再解析；第一次解析不出来自动再试一次', async () => {
    const { ai, ds } = setup({ deepseek: ['不是 JSON', '```json\n{"name":"传智杯"}\n```'] });
    const r = await ai.session(night).chat({ purpose: 'extract', messages: [], json: true });
    expect(r.data).toEqual({ name: '传智杯' });
    expect(ds.calls).toHaveLength(2);
    expect(ds.calls[0].json).toBe(true);
  });
  test('JSON 一直解析不出来：报“格式不对”', async () => {
    const { ai } = setup({ deepseek: ['不是 JSON'] });
    await expect(ai.session(night).chat({ purpose: 'extract', messages: [], json: true })).rejects.toMatchObject({ kind: '格式不对' });
  });
});

describe('记账汇总', () => {
  test('按晚收尾后能查到存下的汇总；按天按来源分开', async () => {
    const { ai, usage } = setup();
    await ai.session(night).chat({ purpose: 'extract', messages: [] });
    await ai.session({ source: '实时', module: '赛事助手' }).chat({ purpose: 'assistant', messages: [] });
    const closed = usage.closeRun('2026-10-29');
    expect(closed.calls).toBe(1);
    expect(usage.closedRun('2026-10-29').totals.calls).toBe(1);
    const today = usage.ofDay(new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10));
    expect(today.map(r => r.source).sort()).toEqual(['实时', '每晚自动化']);
    usage.setFixedFee('2026-10', 'codex', 150, '每月订阅');
    expect(usage.fixedFees('2026-10')[0].amount).toBe(150);
  });
});

describe('搜索：依次补位、每天次数', () => {
  const searchers = (baidu, kimi, deepseekSearch = [['https://ds.cn']]) => {
    const b = fakeSearcher('baidu', baidu);
    const k = fakeSearcher('kimi', kimi);
    const d = fakeSearcher('deepseek', deepseekSearch);
    return { b, k, d, extraProviders: { baidu: b.provider, kimi: k.provider, deepseek: d.provider } };   // 搜索补位的最后一家是 DeepSeek
  };
  function build(baidu, kimi, config = {}) {
    const x = searchers(baidu, kimi);
    const env = setup({ config, extraProviders: x.extraProviders });
    return { ...env, ...x };
  }
  test('先用百度；带上网站、时间、屏蔽名单', async () => {
    const { ai, b, k } = build([['https://a.cn']], [['https://k.cn']]);
    const r = await ai.session(night).search({ query: '数学建模 报名通知', site: 'www.mcm.edu.cn', recent: 'month', blocked: ['zhihu.com'] });
    expect(r).toMatchObject({ provider: 'baidu', references: [{ url: 'https://a.cn' }], tried: [] });
    expect(b.calls[0]).toMatchObject({ query: '数学建模 报名通知', site: 'www.mcm.edu.cn', recent: 'month', blocked: ['zhihu.com'], key: 'bd-test-0000000000' });
    expect(k.calls).toHaveLength(0);
  });
  test('百度出错：换 Kimi 补位，记下百度为什么没用上', async () => {
    const { ai, k } = build([new AiError('请求有误', '400')], [['https://k.cn']]);
    const r = await ai.session(night).search({ query: 'x' });
    expect(r).toMatchObject({ provider: 'kimi', references: [{ url: 'https://k.cn' }] });
    expect(r.tried).toEqual([{ provider: 'baidu', kind: '请求有误', message: '400' }]);
    expect(k.calls).toHaveLength(1);
  });
  test('百度每天自动调用到上限：换下一家；手动测试不受限、也不占份额', async () => {
    const { ai, usage } = build([['https://a.cn']], [['https://k.cn']], { dailyLimits: { baidu: 2 } });
    const s = ai.session(night);
    expect((await s.search({ query: '1' })).provider).toBe('baidu');
    expect((await s.search({ query: '2' })).provider).toBe('baidu');
    const third = await s.search({ query: '3' });
    expect(third.provider).toBe('kimi');
    expect(third.tried[0].kind).toBe('额度用完');
    const manual = await ai.session({ source: '手动测试' }).search({ query: '4' });
    expect(manual.provider).toBe('baidu');
    expect(usage.countToday('baidu', { excludeSource: '手动测试' })).toBe(2);
  });
  test('补位的都失败：报最后一家的错', async () => {
    const purposes = { ...DEFAULT_CONFIG.purposes, search: { 能力: 'search', provider: ['baidu', 'kimi'] } };
    const { ai } = build([new AiError('请求有误', 'b')], [new AiError('密钥错误', 'k')], { purposes });
    await expect(ai.session(night).search({ query: 'x' })).rejects.toMatchObject({ kind: '密钥错误' });
  });
});
