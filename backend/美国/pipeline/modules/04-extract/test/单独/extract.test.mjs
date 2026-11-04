// 04 读详情和抽取的编排：步骤换成假的，只检查流程走向、条目状态和原因、改动格式。不连网、不调 AI。
import { describe, expect, test } from 'vitest';
import { checkModuleOutput } from '../../../../小数据库/index.mjs';
import { fakeCtx } from '../../../../test/复用/假ctx.mjs';
import { item } from '../../../../test/复用/假模块.mjs';
import * as extract from '../../index.mjs';
import { reread } from '../../steps/reread.mjs';

const full = { organizer: { value: '中国数学会', quote: '主办单位：中国数学会' }, registration_end: { value: '2026-09-01', quote: '9 月 1 日截止' }, participants: { value: '在校大学生', quote: '在校大学生' } };

describe('04 读详情和抽取', () => {
  const steps = (over = {}) => ({
    readSource: async () => ({ ok: true, text: '正文', url: 'https://a.cn' }),
    extractFields: async () => ({ ok: true, fields: full, dropped: [], promptVersion: 'extract-v1' }),
    reread: async () => ({ ok: false, reason: '重读方式还没定' }),
    supplement: async () => ({ used: false, reason: '没找到正式通知' }),
    ...over,
  });

  test('正常：抽取结果放进 data.extraction，正文存进 blobs；只处理还没抽取过的候选', async () => {
    const ctx = fakeCtx();
    const out = await extract.createRun(steps())({ items: [item('c1', '进行中', { name: '数模' }), item('c2', '进行中', { extraction: {} })] }, ctx);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ key: 'c1', status: '进行中', reason: '抽取完成' });
    expect(out.items[0].data.extraction).toMatchObject({ fields: full, sourceHash: 'hash-1', promptVersion: 'extract-v1', url: 'https://a.cn' });
    expect(out.items[0].data.name).toBe('数模');
    expect(() => checkModuleOutput(out, { module: '04-extract' })).not.toThrow();
  });
  test('读不到：能重试的顺延，不能的失败，原因写明', async () => {
    let n = 0;
    const out = await extract.createRun(steps({
      readSource: async () => (n++ === 0 ? { ok: false, retryable: true, reason: '对方出错' } : { ok: false, retryable: false, reason: '网址不安全' }),
    }))({ items: [item('a'), item('b')] }, fakeCtx());
    expect(out.items.map(i => [i.status, i.reason])).toEqual([['顺延', '读不到正文：对方出错'], ['失败', '读不到正文：网址不安全']]);
    expect(out.problems).toEqual(['1 条抽取失败']);
  });
  test('空壳页：交给重读；重读方式没定时标失败、写明原因', async () => {
    const out = await extract.createRun(steps({ extractFields: async () => ({ ok: false, status: 'page_is_boilerplate' }) }))({ items: [item('a')] }, fakeCtx());
    expect(out.items[0]).toMatchObject({ status: '失败', reason: '重读方式还没定' });
  });
  test('抽空了重试一次；关键信息还缺时补读，补读后更全才换用', async () => {
    const calls = [];
    const results = [
      { ok: true, fields: {} },                                          // 第一次抽空
      { ok: true, fields: { organizer: full.organizer } },               // 重试：有主办方，但缺参赛对象和报名时间
      { ok: true, fields: full },                                        // 补读后再抽：更全
    ];
    const out = await extract.createRun(steps({
      extractFields: async ({ text }) => { calls.push(text); return results.shift(); },
      supplement: async () => ({ used: true, text: '正文+正式通知', noticeUrl: 'https://a.cn/notice' }),
    }))({ items: [item('a')] }, fakeCtx());
    expect(calls).toEqual(['正文', '正文', '正文+正式通知']);
    expect(out.items[0].data.extraction).toMatchObject({ retried: true, fields: full,
      supplement: { used: true, noticeUrl: 'https://a.cn/notice', missingBefore: ['参赛对象', '报名时间'], missingAfter: [] } });
  });
  test('补读拿到读正文交回的东西（还没读过的通知链接）；记下哪些字段是程序填的、哪些是 AI 填的', async () => {
    const 收到 = [];
    const out = await extract.createRun(steps({
      readSource: async () => ({ ok: true, text: '正文', url: 'https://a.cn', 读过: ['https://a.cn'], 余下通知: [{ url: 'https://a.cn/n1', text: '通知', kind: '通知' }] }),
      extractFields: async () => ({ ok: true, fields: { organizer: full.organizer }, 程序填了: ['organizer'], AI填了: [] }),
      supplement: async args => { 收到.push(args); return { used: false, reason: '通知链接都没读到正文' }; },
    }))({ items: [item('a')] }, fakeCtx());
    expect(收到[0].source.余下通知.map(l => l.url)).toEqual(['https://a.cn/n1']);
    expect(收到[0].missing).toEqual(['参赛对象', '报名时间']);
    expect(out.items[0].data.extraction).toMatchObject({ 程序填了: ['organizer'], AI填了: [], 读过: ['https://a.cn'] });
  });
  test('每晚最多补读 20 条、空壳页重读 20 条（沿用旧代码的上限），超过的不再补读、重读', async () => {
    let 补读 = 0;
    let 重读 = 0;
    const 条目们 = Array.from({ length: 22 }, (_, i) => item(`c${i}`));
    const 补读出 = await extract.createRun(steps({
      extractFields: async () => ({ ok: true, fields: { organizer: full.organizer } }),
      supplement: async () => { 补读 += 1; return { used: false, reason: '' }; },
    }))({ items: 条目们 }, fakeCtx());
    expect(补读).toBe(20);
    expect(补读出.items.filter(i => i.data.extraction.supplement?.reason === '今晚补读已到上限')).toHaveLength(2);
    const 重读出 = await extract.createRun(steps({
      extractFields: async () => ({ ok: false, status: 'page_is_boilerplate' }),
      reread: async () => { 重读 += 1; return { ok: false, reason: '太短' }; },
    }))({ items: 条目们 }, fakeCtx());
    expect(重读).toBe(20);
    expect(重读出.items.filter(i => i.reason === '空壳页：今晚重读已到上限')).toHaveLength(2);
  });
  test('停止信号：没处理的标顺延', async () => {
    const controller = new AbortController();
    controller.abort(new Error('超时'));
    const out = await extract.createRun(steps())({ items: [item('a')] }, fakeCtx({ signal: controller.signal }));
    expect(out.items[0]).toMatchObject({ status: '顺延' });
  });
});

describe('04 空壳页重读（经 AI 总管读网页）', () => {
  const ctxWith = fetchPage => ({ ...fakeCtx(), ai: { fetchPage } });
  test('读到够长的正文：交回并写明来源；读网页用的是 reread 用途', async () => {
    const calls = [];
    const out = await reread({ data: { detailUrl: 'https://a.cn' } }, ctxWith(async args => { calls.push(args); return { markdown: '正'.repeat(300), images: ['https://img/1.png'] }; }));
    expect(calls[0]).toMatchObject({ purpose: 'reread', url: 'https://a.cn' });
    expect(out.ok).toBe(true);
    expect(out.text.startsWith('来源页面')).toBe(true);
    expect(out.images).toEqual(['https://img/1.png']);
  });
  test('太短、出错、没有网址：交回读不到并写明原因', async () => {
    expect(await reread({ data: { url: 'https://a.cn' } }, ctxWith(async () => ({ markdown: '短', images: [] })))).toMatchObject({ ok: false, reason: '空壳页重读后正文只有 1 字' });
    expect((await reread({ data: { url: 'https://a.cn' } }, ctxWith(async () => { throw new Error('密钥错误'); }))).reason).toContain('密钥错误');
    expect((await reread({ data: {} }, ctxWith(async () => ({})))).reason).toContain('没有网址');
  });
});
