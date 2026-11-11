// 03 筛选：筛选总管依次调 标题筛选 → Jev筛选 → Codex代理追踪，经小数据库的查找、删除、标记线索维护当晚的条目。
// 不连网、不调真实接口：AI 总管换成假的。
import { describe, expect, test } from 'vitest';
import { fakeCtx } from '../../../../test/复用/假ctx.mjs';
import * as filter from '../../index.mjs';
import { 标题筛选 } from '../../标题筛选/index.mjs';
import { Jev筛选, 按概率分 } from '../../Jev筛选/index.mjs';
import { 类别们 } from '../../Jev筛选/题目.mjs';
import { Codex代理追踪, 最多轮数, 提示词文件 } from '../../Codex代理追踪/index.mjs';
import { 读不了 } from '../../筛选总管/读不了的网站.mjs';
import { loadPrompt } from '../../../../common/prompt.mjs';

const now = '2026-11-01T12:00:00.000Z';
const 候选 = (key, name, extra = {}) => ({ key, kind: 'candidate', status: '进行中', stage: '02-dedup', data: { name, url: key, snippet: '', ...extra } });

describe('标题筛选（程序化，只看标题）', () => {
  test.each([
    ['', '扔', '标题为空'],
    ['2026年9月27日 09:54广东', '追溯', '没有信息量'],
    ['关于组织2026年数学建模校内选拔赛的通知', '追溯', '校内选拔'],
    ['2026年度学科竞赛项目目录', '线索', '目录'],
    ['我校学子荣获全国大学生电子设计竞赛一等奖', '追溯', '赛事报道'],
    ['通知公告', '线索', '栏目页'],
    ['中国自动化学会', '线索', '机构名称'],
  ])('“%s” → %s', (title, 去向, 关键词) => {
    const r = 标题筛选(候选('https://a.cn', title));
    expect(r.去向).toBe(去向);
    expect(r.原因).toContain(关键词);
  });
  test('明显不是大学生的（中小学、青少年、兴趣体育）扔掉：判断来自程序审核的范围闸，规则只有一份', () => {
    for (const t of ['2026中小学智能未来邀请赛', '全国青少年信息学奥林匹克竞赛', '中国魔方运动巡回赛']) {
      expect(标题筛选(候选('https://a.cn', t)), t).toMatchObject({ 去向: '扔', 原因: expect.stringContaining('非大学生') });
    }
    // 通知、校内选拔、报道在范围闸也是“不收”，但在筛选这一步要去追溯，不能扔
    expect(标题筛选(候选('https://a.cn', '关于组织2026年数学建模校内选拔赛的通知')).去向).toBe('追溯');
  });
  test('看不出来的交给 Jev（交回 null）', () => {
    expect(标题筛选(候选('https://a.cn', '第十届全国大学生生物医学工程创新设计竞赛'))).toBeNull();
    expect(标题筛选(候选('https://a.cn', '中国自动化学会机器人竞赛'))).toBeNull();
  });
});

describe('读不了的网站', () => {
  test('微信公众号、百度百科读不了；别的能读', () => {
    expect(读不了('https://mp.weixin.qq.com/s/abc')).toBe(true);
    expect(读不了('https://baike.baidu.com/item/x')).toBe(true);
    expect(读不了('https://www.mcm.edu.cn')).toBe(false);
  });
});

// 假的 AI 总管会话
function 假AI({ decide = [], chat = [], search = [], fetchPage = {}, 剩 = Infinity } = {}) {
  const ai = { 调用: { decide: [], chat: [], search: [], fetchPage: [] }, 报告: [],
    budgetLeft: () => 剩,
    报告问题: x => ai.报告.push(x),
    decide: async req => { ai.调用.decide.push(req); const r = decide[ai.调用.decide.length - 1]; if (r instanceof Error) throw r; return r; },
    chat: async req => { ai.调用.chat.push(structuredClone(req)); const r = chat[ai.调用.chat.length - 1]; if (r instanceof Error) throw r; return { data: r }; },
    search: async req => { ai.调用.search.push(req); const r = search[ai.调用.search.length - 1]; if (r instanceof Error) throw r; return r; },
    fetchPage: async req => { ai.调用.fetchPage.push(req); const r = fetchPage[req.url]; if (r instanceof Error) throw r; if (!r) throw new Error('404'); return { markdown: r }; },
  };
  return ai;
}
// 假的读网页（ctx.web.读网页）：表里有的交回“成功”和正文，没有的交回 HTTP错误
function 假web(表 = {}) {
  const web = { 读过: [], 读网页: async url => { web.读过.push(url); return 表[url] ? { url, finalUrl: url, status: '成功', title: '', text: 表[url], links: [{ url: `${url}/fj.pdf`, text: '附件：大赛章程', kind: '附件' }], error: '' } : { url, finalUrl: url, status: 'HTTP错误', title: '', text: '', links: [], error: '对方返回 404' }; } };
  return web;
}
// 屏蔽名单（总控从比赛库读好放进 ctx）：Codex 追踪搜索时要带上
const 装AI = (ctx, opts = {}) => { ctx.ai = 假AI(opts); ctx.web = 假web(opts.fetchPage); ctx.屏蔽网站 = () => ['zhihu.com']; };
const 概率 = over => ({ answers: { kind: { choice: 'competition_site', probabilities: { competition_site: 0, organizer_notice: 0, registration_entry: 0, directory_lead: 0, repost_or_school_selection: 0, news_or_result: 0, unrelated: 0, ...over } } } });

describe('Jev 筛选', () => {
  test('按概率分去向：无关 > 50% 扔，20%～50% 线索；目录最高线索；官网+报名+主办方通知 ≥ 转载+新闻 读详情，否则追溯', () => {
    expect(按概率分({ unrelated: 0.6 }).去向).toBe('扔');
    expect(按概率分({ unrelated: 0.3 }).去向).toBe('线索');
    expect(按概率分({ unrelated: 0.1, directory_lead: 0.5, competition_site: 0.2, news_or_result: 0.2 }).去向).toBe('线索');
    expect(按概率分({ unrelated: 0.1, competition_site: 0.3, organizer_notice: 0.2, news_or_result: 0.4 }).去向).toBe('读详情');
    expect(按概率分({ unrelated: 0.1, competition_site: 0.2, repost_or_school_selection: 0.5 }).去向).toBe('追溯');
  });
  test('每条候选经 AI 总管的 decide（用途 classify）问一次，题目是 7 个类别', async () => {
    const ctx = fakeCtx({ now });
    装AI(ctx, { decide: [概率({ competition_site: 0.9 }), 概率({ unrelated: 0.8 })] });
    const out = await Jev筛选([候选('https://a.cn', '甲'), 候选('https://b.cn', '乙', { snippet: '招聘' })], ctx);
    expect(out.map(x => [x.key, x.去向])).toEqual([['https://a.cn', '读详情'], ['https://b.cn', '扔']]);
    expect(ctx.ai.调用.decide[0]).toMatchObject({ purpose: 'classify', state: { title: '甲', url: 'https://a.cn' } });
    expect(Object.keys(ctx.ai.调用.decide[0].questions.kind.criteria)).toEqual(类别们);
  });
  test('额度不够：一次都不调，抛错截断', async () => {
    const ctx = fakeCtx({ now });
    装AI(ctx, { 剩: 1 });
    await expect(Jev筛选([候选('a', '甲'), 候选('b', '乙')], ctx)).rejects.toThrow('额度不够');
    expect(ctx.ai.调用.decide).toHaveLength(0);
  });
  test('调用出错：抛错截断，不另外报告', async () => {
    const ctx = fakeCtx({ now });
    装AI(ctx, { decide: [new Error('OpenRouter 超时')] });
    await expect(Jev筛选([候选('a', '甲')], ctx)).rejects.toThrow('OpenRouter 超时');
    expect(ctx.ai.报告).toEqual([]);
  });
  test('返回的概率用不了：报告给 AI 总管，再抛错截断', async () => {
    const ctx = fakeCtx({ now });
    装AI(ctx, { decide: [{ answers: { kind: { choice: null, probabilities: {} } } }] });
    await expect(Jev筛选([候选('a', '甲')], ctx)).rejects.toThrow('概率');
    expect(ctx.ai.报告[0]).toMatchObject({ purpose: 'classify', 原因: expect.stringContaining('概率') });
  });
});

const 页 = '第十届全国大学生某某竞赛由中国某某学会主办，面向全国普通高校在校本科生和研究生，报名截止 2026 年 12 月 1 日。'.repeat(4);
const 结论 = (结果, extra = {}) => ({ 动作: '结论', 结论: { 结果, 理由: '理由', 比赛名: '全国大学生某某竞赛', 官方来源: [], ...extra } });

describe('Codex 代理追踪', () => {
  test('提示词放在 prompt.md，第一行是版本号', () => {
    expect(loadPrompt(提示词文件, { 今天: '2026-11-01', 最多轮数: 6 }).version).toMatch(/^trace-v\d+$/);
  });
  test('经 AI 总管用 trace 用途调 Codex：Codex 决定搜索、读网页，程序去执行并把结果交回，直到给出结论', async () => {
    const ctx = fakeCtx({ now });
    装AI(ctx, {
      chat: [
        { 动作: '搜索', 搜索词: '全国大学生某某竞赛 2026 通知', 网站: '' },
        { 动作: '读网页', 网址: 'https://xh.org.cn/n/1' },
        结论('找到官方来源', { 官方来源: [{ 网址: 'https://xh.org.cn/n/1', 摘录: '由中国某某学会主办' }] }),
      ],
      search: [{ references: [{ title: '关于举办第十届某某竞赛的通知', url: 'https://xh.org.cn/n/1', content: '学会主办' }] }],
      fetchPage: { 'https://xh.org.cn/n/1': 页 },
    });
    const [r] = await Codex代理追踪([候选('https://school.cn/1', '关于组织某某竞赛校内选拔的通知')], ctx);
    expect(r).toMatchObject({ key: 'https://school.cn/1', 结果: '找到官方来源', 比赛名: '全国大学生某某竞赛', 官方来源: [{ 网址: 'https://xh.org.cn/n/1' }] });
    expect(ctx.ai.调用.chat.map(c => c.purpose)).toEqual(['trace', 'trace', 'trace']);
    expect(ctx.ai.调用.chat[0]).toMatchObject({ json: true, promptVersion: expect.stringMatching(/^trace-v/) });
    expect(ctx.ai.调用.search[0]).toMatchObject({ purpose: 'search', query: '全国大学生某某竞赛 2026 通知', blocked: ['zhihu.com'] });
    const 第三轮 = ctx.ai.调用.chat[2].messages.map(m => m.content).join('\n');
    expect(第三轮).toContain('关于举办第十届某某竞赛的通知');
    expect(第三轮).toContain('中国某某学会主办');
    expect(第三轮).toContain('附件：大赛章程');
    expect(ctx.web.读过).toEqual(['https://xh.org.cn/n/1']);
    expect(ctx.ai.调用.fetchPage).toEqual([]);   // 用自己的读网页，不交给 Kimi
  });
  test('官方来源要核对：没读过的网址、摘录不在原文里的去掉；一个不剩就改成找不到官方来源', async () => {
    const ctx = fakeCtx({ now });
    装AI(ctx, { chat: [结论('找到官方来源', { 官方来源: [{ 网址: 'https://没读过.cn', 摘录: '主办' }] })] });
    const [r] = await Codex代理追踪([候选('k', '通知')], ctx);
    expect(r.结果).toBe('找不到官方来源');
    expect(r.原因).toContain('没读过');
  });
  test('网页读不到（读网页交回失败的状态）：告诉 Codex 读不到和原因，让它换办法，不截断', async () => {
    const ctx = fakeCtx({ now });
    装AI(ctx, { chat: [{ 动作: '读网页', 网址: 'https://dead.cn' }, 结论('找不到官方来源')] });
    const [r] = await Codex代理追踪([候选('k', '通知')], ctx);
    expect(r.结果).toBe('找不到官方来源');
    expect(ctx.ai.调用.chat[1].messages.at(-1).content).toContain('没读到');
    expect(ctx.ai.调用.chat[1].messages.at(-1).content).toContain('HTTP错误');
  });
  test(`最多 ${最多轮数} 轮：最后一轮提醒必须给结论；还不给就是内容用不了，报告并截断`, async () => {
    const ctx = fakeCtx({ now });
    装AI(ctx, { chat: Array.from({ length: 最多轮数 }, () => ({ 动作: '搜索', 搜索词: 'x' })), search: Array.from({ length: 最多轮数 }, () => ({ references: [] })) });
    await expect(Codex代理追踪([候选('k', '通知')], ctx)).rejects.toThrow('结论');
    expect(ctx.ai.调用.chat.at(-1).messages.at(-1).content).toContain('最后一轮');
    expect(ctx.ai.报告[0]).toMatchObject({ purpose: 'trace' });
  });
  test('动作不对：报告并截断', async () => {
    const ctx = fakeCtx({ now });
    装AI(ctx, { chat: [{ 动作: '睡觉' }] });
    await expect(Codex代理追踪([候选('k', '通知')], ctx)).rejects.toThrow('动作');
    expect(ctx.ai.报告).toHaveLength(1);
  });
  test('Codex 调用出错：截断；额度用完：这条和没轮上的标顺延，不截断', async () => {
    const ctx = fakeCtx({ now });
    装AI(ctx, { chat: [new Error('codex 进程超时')] });
    await expect(Codex代理追踪([候选('k', '通知')], ctx)).rejects.toThrow('codex 进程超时');
    const ctx2 = fakeCtx({ now });
    装AI(ctx2, { chat: [Object.assign(new Error('会话的调用次数已用完'), { kind: '额度用完' })] });
    expect(await Codex代理追踪([候选('k', '通知')], ctx2)).toEqual([{ key: 'k', 顺延: true, 原因: '额度用完，下一晚接着追：会话的调用次数已用完' }]);
  });
});

// 假的小数据库：查找交回准备好的候选，删除、标记线索都记下来
function 带小数据库(ctx, 候选们) {
  const 记 = { 删除: [], 线索: [] };
  const 动过 = key => [...记.删除, ...记.线索].some(x => x.key === key);
  ctx.小数据库 = {
    查找: ({ kind } = {}) => 候选们.filter(c => !kind || c.kind === kind).filter(c => !动过(c.key)),
    删除: 列表 => { 记.删除.push(...列表); return { 删除: 列表.length }; },
    标记线索: 列表 => { 记.线索.push(...列表); return { 线索: 列表.length }; },
  };
  ctx.item = () => null;
  return 记;
}

describe('筛选总管', () => {
  test('平台条目不筛；标题能判的不问 Jev；扔的删除并记拒过的网址，线索的标记线索，读详情的交回并写明去向', async () => {
    const ctx = fakeCtx({ now });
    const 记 = 带小数据库(ctx, [
      候选('https://tianchi.cn/1', '天池某赛', { 路线们: ['平台'] }),
      候选('https://a.cn/dir', '2026年度学科竞赛项目目录'),
      候选('https://a.cn/site', '第十届全国大学生某某竞赛'),
      候选('https://a.cn/job', '某公司校园招聘'),
    ]);
    装AI(ctx, { decide: [概率({ competition_site: 0.9 }), 概率({ unrelated: 0.9 })] });
    const out = await filter.run({ runId: '2026-11-01' }, ctx);
    expect(ctx.ai.调用.decide.map(d => d.state.title)).toEqual(['第十届全国大学生某某竞赛', '某公司校园招聘']);
    expect(记.删除.map(x => x.key)).toEqual(['https://a.cn/job']);
    expect(记.线索).toEqual([{ key: 'https://a.cn/dir', 原因: expect.stringMatching(/^03 筛选·标题筛选：.*目录/) }]);
    expect(记.删除).toEqual([{ key: 'https://a.cn/job', 原因: expect.stringMatching(/^03 筛选·Jev筛选：/) }]);
    expect(out.changes).toEqual([expect.objectContaining({ table: 'rejected_url', itemKey: 'https://a.cn/job', payload: expect.objectContaining({ module: '03-filter' }) })]);
    expect(out.items.map(i => [i.key, i.status, i.data.筛选.去向])).toEqual([['https://tianchi.cn/1', '进行中', '读详情'], ['https://a.cn/site', '进行中', '读详情']]);
    expect(ctx.ai.调用.chat).toHaveLength(0);
  });
  test('Jev 判读详情、但网站读不了或标题是通知的：改去追溯', async () => {
    const ctx = fakeCtx({ now });
    带小数据库(ctx, [候选('https://mp.weixin.qq.com/s/1', '某某大赛来了'), 候选('https://a.cn/n', '关于举办某某大赛的通知')]);
    装AI(ctx, { decide: [概率({ competition_site: 0.9 }), 概率({ organizer_notice: 0.9 })], chat: [结论('找不到官方来源'), 结论('找不到官方来源')] });
    await filter.run({ runId: '2026-11-01' }, ctx);
    expect(ctx.ai.调用.chat).toHaveLength(2);
  });
  test('追溯的结果：找到官方来源的，官方来源作为新候选往下走、通知标已丢弃；不是比赛的删除并记拒过；找不到的标线索；顺延的交回顺延', async () => {
    const ctx = fakeCtx({ now });
    const 记 = 带小数据库(ctx, [
      候选('https://s.cn/1', '关于组织某某竞赛校内选拔的通知'),
      候选('https://s.cn/2', '奖学金评选校内选拔的通知'),
      候选('https://s.cn/3', '关于组织另一竞赛校内选拔的通知'),
      候选('https://s.cn/4', '关于组织第三竞赛校内选拔的通知'),
    ]);
    const 额度用完 = Object.assign(new Error('用完了'), { kind: '额度用完' });
    装AI(ctx, {
      chat: [{ 动作: '读网页', 网址: 'https://xh.org.cn/n/1' }, 结论('找到官方来源', { 官方来源: [{ 网址: 'https://xh.org.cn/n/1', 摘录: '由中国某某学会主办' }] }), 结论('不是比赛', { 比赛名: '' }), 结论('找不到官方来源'), 额度用完],
      fetchPage: { 'https://xh.org.cn/n/1': 页 },
    });
    // 并发 2：按调用顺序排好假回答太脆，这里把并发换成 1
    const out = await filter.createRun({ ...filter.DEFAULT_PARTS, Codex代理追踪: (通知们, c) => Codex代理追踪(通知们, c, { 并发: 1 }) })({ runId: '2026-11-01' }, ctx);
    expect(记.删除).toEqual([
      { key: 'https://s.cn/1', 原因: '03 筛选·Codex代理追踪：已追溯到官方来源 https://xh.org.cn/n/1，官方来源作为新候选往下走' },
      { key: 'https://s.cn/2', 原因: '03 筛选·Codex代理追踪：不是比赛：理由' },
    ]);
    expect(记.线索).toEqual([{ key: 'https://s.cn/3', 原因: '03 筛选·Codex代理追踪：找不到官方来源：理由' }]);
    expect(out.items).toEqual([
      expect.objectContaining({ key: 'https://xh.org.cn/n/1', kind: 'candidate', status: '进行中', data: expect.objectContaining({ name: '全国大学生某某竞赛', url: 'https://xh.org.cn/n/1', 追溯自: 'https://s.cn/1', 筛选: expect.objectContaining({ 去向: '读详情' }) }) }),
      expect.objectContaining({ key: 'https://s.cn/4', status: '顺延', reason: expect.stringContaining('额度用完') }),
    ]);
    expect(out.changes.map(c => c.itemKey)).toEqual(['https://s.cn/2']);
  });
  test('追到的官方来源今晚已经是候选：不重复加，通知照样标已丢弃', async () => {
    const ctx = fakeCtx({ now });
    带小数据库(ctx, [候选('https://s.cn/1', '关于组织某某竞赛校内选拔的通知')]);
    ctx.item = key => (key === 'https://xh.org.cn/n/1' ? { key, status: '进行中' } : null);
    装AI(ctx, { chat: [{ 动作: '读网页', 网址: 'https://xh.org.cn/n/1' }, 结论('找到官方来源', { 官方来源: [{ 网址: 'https://xh.org.cn/n/1', 摘录: '由中国某某学会主办' }] })], fetchPage: { 'https://xh.org.cn/n/1': 页 } });
    const out = await filter.run({ runId: '2026-11-01' }, ctx);
    expect(out.items).toEqual([]);
  });
  test('没有候选：什么都不调', async () => {
    const ctx = fakeCtx({ now });
    带小数据库(ctx, []);
    装AI(ctx, );
    expect(await filter.run({}, ctx)).toEqual({ items: [], changes: [], problems: [] });
  });
});
