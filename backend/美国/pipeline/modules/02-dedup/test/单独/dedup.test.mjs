// 02 对比去重：主运行文件先读库（统一的查询）→ 程序去重（和库里一样的扔掉）→ AI 去重（DeepSeek）。
// 扔掉的经小数据库的删除接口标成已丢弃并写明原因；AI 调用出错就抛错，截断流程（去重是关键模块）。不连网、不调真实接口。
import { describe, expect, test } from 'vitest';
import { fakeCtx } from '../../../../test/复用/假ctx.mjs';
import * as dedup from '../../index.mjs';
import { 读库 } from '../../读库/index.mjs';
import { 程序去重, 规范名称 } from '../../程序去重/index.mjs';
import { AI去重, 每批, 最低把握, 提示词文件 } from '../../AI去重/index.mjs';
import { loadPrompt } from '../../../../common/prompt.mjs';

const now = '2026-10-31T12:00:00.000Z';
const 天前 = n => new Date(Date.parse(now) - n * 86400000).toISOString();
const 表 = {
  competition: [
    { key: 'event-math', version: 1, data: { id: 'event-math', name: '全国大学生数学建模竞赛', aliases: ['国赛数模'], level: '国家级', region: '全国', website: 'https://www.mcm.edu.cn/' } },
    { key: 'event-art', version: 1, data: { id: 'event-art', name: '湖南省大学生艺术展演', level: '省级/区域级', region: '湖南' } },
    { key: 'event-gone', version: 1, data: { id: 'event-gone', name: '已删除的比赛', level: '国家级', deleted_at: 天前(1) } },
  ],
  edition: [
    { key: 'ed-math-2026', version: 1, data: { id: 'ed-math-2026', competition_id: 'event-math', registration_url: 'https://reg.mcm.cn/2026', discovery_notice_url: 'https://school.cn/n/1' } },
  ],
  source: [{ key: 's1', version: 1, data: { id: 's1', edition_id: 'ed-math-2026', url: 'http://mcm.edu.cn/notice/2026', final_url: 'https://mcm.edu.cn/notice/2026-final' } }],
  blocked_competition: [{ key: 'b1', version: 1, data: { id: 'b1', name: '某某杯营销挑战赛', aliases: ['营销杯'], website: 'https://ying.cn' } }],
  rejected_url: [
    { key: 'r1', version: 1, data: { id: 'r1', url: 'https://bad.cn/1', url_key: 'bad.cn/1', reason: '不是比赛', module: '03-filter', rejected_at: 天前(3) } },
    { key: 'r2', version: 1, data: { id: 'r2', url: 'https://old.cn/1', url_key: 'old.cn/1', reason: '不是比赛', module: '03-filter', rejected_at: 天前(31) } },
  ],
};
const 带库 = () => fakeCtx({ now, list: table => 表[table] || [] });
const 候选 = (key, name, url = key, snippet = '') => ({ key, kind: 'candidate', status: '进行中', stage: '01-search', data: { name, url, snippet } });

describe('读库（统一的查询）', () => {
  test('一次读齐对比要用的：比赛（不含已删除）、库里所有网址、不收录名单、30 天内拒过的网址', () => {
    const 库 = 读库(带库());
    expect(库.比赛们.map(c => c.编号)).toEqual(['event-math', 'event-art']);
    expect(库.比赛们[0]).toEqual({ 编号: 'event-math', 名称: '全国大学生数学建模竞赛', 别名们: ['国赛数模'], 级别: '国家级', 地区: '全国' });
    expect([...库.网址们.keys()].sort()).toEqual(['mcm.edu.cn', 'mcm.edu.cn/notice/2026', 'mcm.edu.cn/notice/2026-final', 'reg.mcm.cn/2026', 'school.cn/n/1']);
    expect(库.网址们.get('reg.mcm.cn/2026')).toBe('库里届次 ed-math-2026 的报名入口');
    expect(库.不收录).toEqual([{ 名称们: ['某某杯营销挑战赛', '营销杯'], 网址键: 'ying.cn', 原因: '' }]);
    expect([...库.拒过.keys()]).toEqual(['bad.cn/1']);
  });
});

describe('程序去重', () => {
  test('规范名称：去掉年份、第几届、引号括号空白，结尾的竞赛/大赛/比赛/挑战赛', () => {
    expect(规范名称('2026年第十二届“全国大学生数学建模竞赛”')).toBe('全国大学生数学建模');
    expect(规范名称('全国大学生数学建模 大赛')).toBe('全国大学生数学建模');
  });
  test('一样就扔：30 天内拒过、网址和库里一样、在不收录名单里、名称和库里比赛或别名一样；别的留下', () => {
    const 库 = 读库(带库());
    const { 扔, 留 } = 程序去重([
      候选('k1', '无关页面', 'https://bad.cn/1/'),
      候选('k2', '数模通知', 'https://www.mcm.edu.cn/notice/2026#a'),
      候选('k3', '营销杯 2026 报名', 'https://x.cn/3'),
      候选('k3b', '某页面', 'https://ying.cn/'),
      候选('k4', '2026年全国大学生数学建模竞赛', 'https://y.cn/4'),
      候选('k5', '国赛数模', 'https://y.cn/5'),
      候选('k6', '第三届全国大学生数学建模挑战营通知', 'https://y.cn/6'),
    ], 库);
    expect(扔).toEqual([
      { key: 'k1', 原因: '30 天内拒过（03-filter：不是比赛）' },
      { key: 'k2', 原因: '网址和库里一样：库里届次 ed-math-2026 的来源' },
      { key: 'k3', 原因: '在不收录名单里：营销杯' },
      { key: 'k3b', 原因: '在不收录名单里：某某杯营销挑战赛' },
      { key: 'k4', 原因: '名称和库里比赛一样：全国大学生数学建模竞赛（event-math）' },
      { key: 'k5', 原因: '名称和库里比赛一样：全国大学生数学建模竞赛（event-math）' },
    ]);
    expect(留.map(c => c.key)).toEqual(['k6']);
  });
  test('不收录名单只认名称一样或标题里写着这个名称，不认相似', () => {
    const { 扔 } = 程序去重([候选('k', '营销大赛', 'https://z.cn')], 读库(带库()));
    expect(扔).toEqual([]);
  });
});

// 假的 AI 总管会话：按顺序交回准备好的结果，记下每次调用
function 假AI(回答们, { 剩 = Infinity } = {}) {
  const ai = { calls: [], 报告: [],
    chat: async req => { ai.calls.push(req); const r = 回答们[ai.calls.length - 1]; if (r instanceof Error) throw r; return { data: typeof r === 'function' ? r(req) : r }; },
    budgetLeft: () => 剩,
    报告问题: x => ai.报告.push(x) };
  return ai;
}
const 结果 = (编号, 结论, extra = {}) => ({ 编号, 结论, 比赛编号: null, 重复于: null, 把握: 0.9, 理由: '理由', ...extra });
// 提示词里库里比赛用短号（库1、库2……）列出；从提示词里找某个比赛的短号（2026-11-04：AI 抄长编号会抄漏，见下面的测试）
const 库号 = (req, 名称) => req.messages.map(m => m.content).join('\n').match(new RegExp(`(库\\d+)｜${名称}｜`))[1];

describe('AI 去重', () => {
  test('提示词放在 prompt.md，第一行是版本号', () => {
    expect(loadPrompt(提示词文件, { 库里的比赛: 'x', 候选: 'y' }).version).toMatch(/^dedup-v\d+$/);
  });
  test(`每 ${每批} 条一批，经 AI 总管用 arbitrate 用途调 DeepSeek，提示词里有库里全部比赛和这批候选`, async () => {
    const 候选们 = Array.from({ length: 25 }, (_, i) => 候选(`k${i}`, `比赛${i}`, `https://c.cn/${i}`));
    const ctx = 带库();
    ctx.ai = 假AI([req => ({ 结果: Array.from({ length: 20 }, (_, i) => 结果(i + 1, '新的')) }), { 结果: Array.from({ length: 5 }, (_, i) => 结果(i + 1, '新的')) }]);
    const out = await AI去重(候选们, 读库(ctx), ctx);
    expect(ctx.ai.calls).toHaveLength(2);
    expect(ctx.ai.calls[0]).toMatchObject({ purpose: 'arbitrate', json: true, promptVersion: expect.stringMatching(/^dedup-v/) });
    const 正文 = ctx.ai.calls[0].messages.map(m => m.content).join('\n');
    expect(正文).toMatch(/库\d+｜全国大学生数学建模竞赛｜国赛数模｜国家级｜全国/);
    expect(正文).not.toContain('event-math');   // 不给 AI 看原始编号
    expect(正文).toContain('1｜比赛0｜https://c.cn/0');
    expect(正文).not.toContain('比赛20｜');
    expect(out).toEqual({ 扔: [], 问题们: [] });
  });
  test(`扔掉：库里已有且把握 ≥ ${最低把握}、和同批前面一条是同一个比赛；拿不准、新的、把握不够的留下`, async () => {
    const ctx = 带库();
    ctx.ai = 假AI([req => ({ 结果: [
      结果(1, '库里已有', { 比赛编号: 库号(req, '全国大学生数学建模竞赛'), 理由: '是数模国赛的通知' }),
      结果(2, '库里已有', { 比赛编号: 库号(req, '全国大学生数学建模竞赛'), 把握: 0.5 }),
      结果(3, '拿不准'),
      结果(4, '新的'),
      结果(5, '新的', { 重复于: 4, 理由: '同一个比赛' }),
    ] })]);
    const 候选们 = [候选('a', '数模通知'), 候选('b', '数模？'), 候选('c', '某赛'), 候选('d', '新赛'), 候选('e', '新赛报名')];
    expect((await AI去重(候选们, 读库(ctx), ctx)).扔).toEqual([
      { key: 'a', 原因: 'AI 判为库里已有：全国大学生数学建模竞赛（event-math）：是数模国赛的通知' },
      { key: 'e', 原因: 'AI 判为和今晚另一条候选是同一个比赛（d）：同一个比赛' },
    ]);
  });
  test('AI 交回短号或原样的编号都认；抄漏的长编号（11-04 线上：event-agent-followup-xxx 抄成 event-xxx）不认，照规矩截断', async () => {
    const ctx = 带库();
    ctx.ai = 假AI([{ 结果: [结果(1, '库里已有', { 比赛编号: 'event-math' })] }]);
    expect((await AI去重([候选('a', 't')], 读库(ctx), ctx)).扔[0].原因).toMatch('全国大学生数学建模竞赛（event-math）');
    const 坏 = 带库();
    坏.ai = 假AI([{ 结果: [结果(1, '库里已有', { 比赛编号: 'event-ath' })] }]);
    await expect(AI去重([候选('a', 't')], 读库(坏), 坏)).rejects.toThrow('不在库里');
  });
  test('没有候选：不调接口', async () => {
    const ctx = 带库();
    ctx.ai = 假AI([]);
    expect(await AI去重([], 读库(ctx), ctx)).toEqual({ 扔: [], 问题们: [] });
    expect(ctx.ai.calls).toHaveLength(0);
  });
  test('额度不够这一晚要的批数：一次都不调，直接抛错截断', async () => {
    const ctx = 带库();
    ctx.ai = 假AI([], { 剩: 1 });
    const 候选们 = Array.from({ length: 21 }, (_, i) => 候选(`k${i}`, `t${i}`));
    await expect(AI去重(候选们, 读库(ctx), ctx)).rejects.toThrow('额度不够');
    expect(ctx.ai.calls).toHaveLength(0);
  });
  test('接口调用出错：抛错截断（错误 AI 总管已经自己记下），不另外报告', async () => {
    const ctx = 带库();
    ctx.ai = 假AI([new Error('DeepSeek 超时')]);
    await expect(AI去重([候选('a', 't')], 读库(ctx), ctx)).rejects.toThrow('DeepSeek 超时');
    expect(ctx.ai.报告).toEqual([]);
  });
  test.each([
    ['漏了候选', { 结果: [] }, '漏了'],
    ['结论不在三种之内', { 结果: [结果(1, '可能重复')] }, '结论'],
    ['库里已有却没给库里有的比赛编号', { 结果: [结果(1, '库里已有', { 比赛编号: 'event-none' })] }, '比赛编号'],
    ['重复于指向自己或后面的', { 结果: [结果(1, '新的', { 重复于: 1 })] }, '重复于'],
    ['把握不是 0 到 1', { 结果: [结果(1, '新的', { 把握: 3 })] }, '把握'],
    ['不是要的格式', { 别的: 1 }, '结果'],
  ])('返回的内容用不了（%s）：报告给 AI 总管，再抛错截断', async (_, 回答, 关键词) => {
    const ctx = 带库();
    ctx.ai = 假AI([回答]);
    await expect(AI去重([候选('a', 't')], 读库(ctx), ctx)).rejects.toThrow(关键词);
    expect(ctx.ai.报告).toEqual([expect.objectContaining({ purpose: 'arbitrate', promptVersion: expect.stringMatching(/^dedup-v/), 原因: expect.stringContaining(关键词) })]);
  });
});

// 假的小数据库：查找交回准备好的候选，删除记下来
function 带小数据库(ctx, 候选们) {
  const 删过 = [];
  ctx.小数据库 = {
    查找: ({ kind } = {}) => 候选们.filter(c => !kind || c.kind === kind).filter(c => !删过.some(d => d.key === c.key)),
    删除: 列表 => { 删过.push(...列表); return { 删除: 列表.length }; },
  };
  return 删过;
}

describe('主运行文件', () => {
  test('按顺序：查找候选 → 读库 → 程序去重并删除 → AI 去重（只看程序留下的）并删除；原因写明是“02 对比去重·哪一步”', async () => {
    const ctx = 带库();
    const 删过 = 带小数据库(ctx, [候选('k1', '2026年全国大学生数学建模竞赛', 'https://y.cn/1'), 候选('k2', '新赛', 'https://y.cn/2'), { ...候选('r', 'x'), kind: 'record' }]);
    ctx.ai = 假AI([req => { expect(req.messages.map(m => m.content).join()).not.toContain('y.cn/1'); return { 结果: [结果(1, '库里已有', { 比赛编号: 库号(req, '湖南省大学生艺术展演'), 理由: '同一个' })] }; }]);
    const out = await dedup.run({ runId: '2026-10-31' }, ctx);
    expect(删过).toEqual([
      { key: 'k1', 原因: '02 对比去重·程序去重：名称和库里比赛一样：全国大学生数学建模竞赛（event-math）' },
      { key: 'k2', 原因: '02 对比去重·AI去重：AI 判为库里已有：湖南省大学生艺术展演（event-art）：同一个' },
    ]);
    expect(out).toEqual({ items: [], changes: [], problems: [] });
  });
  test('没有候选：什么都不调', async () => {
    const ctx = 带库();
    带小数据库(ctx, []);
    ctx.ai = 假AI([]);
    expect(await dedup.run({}, ctx)).toEqual({ items: [], changes: [], problems: [] });
    expect(ctx.ai.calls).toHaveLength(0);
  });
  test('AI 去重出错：模块抛错（程序去重删的由总控撤回）', async () => {
    const ctx = 带库();
    带小数据库(ctx, [候选('k2', '新赛', 'https://y.cn/2')]);
    ctx.ai = 假AI([new Error('DeepSeek 超时')]);
    await expect(dedup.run({}, ctx)).rejects.toThrow('DeepSeek 超时');
  });
});
