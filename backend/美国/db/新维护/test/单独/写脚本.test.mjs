// 写爬虫脚本（2026-11-08 用户定）：AI（线上 Codex，本地试跑换 Kimi）看程序压缩过的官网页面，写一串步骤；程序按步骤试跑，
// 不合格把结果告诉它再改，最多 3 轮。直接下载只拿到空壳、或者 AI 说做不到时，改用无头浏览器打开后的页面。全部用假的。
import { describe, expect, test } from 'vitest';
import { 压缩 } from '../../爬虫/压缩.mjs';
import { 写脚本, 提问版本, 交回格式 } from '../../爬虫/写脚本.mjs';

const 比赛 = { id: 'event-math', name: '全国大学生数学建模竞赛', aliases: ['国赛数模'] };
const 首页 = 'https://www.mcm.edu.cn/';
const 列表页 = 'https://www.mcm.edu.cn/tzgg/';
const 首页html = '<html><head><script>var a=1</script><style>.x{}</style></head><body><div class="nav"><a href="/tzgg/" onclick="x()">通知公告</a><img src="a.png"></div><p>欢迎访问全国大学生数学建模竞赛官网，这里发布竞赛通知、赛题和获奖名单等内容。'.padEnd(400, '。') + '</p></body></html>';
const 列表html = '<html><body><ul class="list"><li><a href="/a.html">关于举办2026年全国大学生数学建模竞赛的通知</a><span>2026-04-01</span></li><li><a href="/b.html">2025年获奖名单</a></li></ul></body></html>';
const 空壳 = '<html><body><div id="app"></div><script src="/app.js"></script></body></html>';

describe('压缩', () => {
  test('去掉脚本、样式、图片；属性只留 id、class、href（转成绝对网址）；长文字截断', () => {
    const 压 = 压缩(首页html, 首页);
    expect(压).not.toContain('<script');
    expect(压).not.toContain('<style');
    expect(压).not.toContain('<img');
    expect(压).not.toContain('onclick');
    expect(压).toContain('<a href="https://www.mcm.edu.cn/tzgg/">通知公告</a>');
    expect(压).toContain('…');
  });
  test('最长 3 万字', () => {
    expect(压缩(`<body>${'<p class="a">文字</p>'.repeat(5000)}</body>`, 首页).length).toBeLessThanOrEqual(30020);
  });
});

function 假AI(回答们) {
  const 调用 = [];
  return { 调用, async chat(参数) { 调用.push(参数); const 答 = 回答们.shift(); if (答 instanceof Error) throw 答; return { data: 答, usage: { tokensIn: 9000, tokensOut: 200 } }; } };
}
const 步 = (动作, 改 = {}) => ({ 动作, 网址: '', 选择器: '', 毫秒: 0, 条目: '', 标题: '', 链接: '', 日期: '', ...改 });
const 规则 = (步骤, 改 = {}) => ({ 状态: '规则', 要看: [], 列表页, 步骤, 说明: '', ...改 });
const 假取源码 = 表 => async url => ({ url, finalUrl: url, status: 表[url] ? '成功' : 'HTTP错误', httpStatus: 表[url] ? 200 : 404, html: 表[url] || '', error: 表[url] ? '' : '对方返回 404' });
function 假浏览器(表) {
  const 开过 = [];
  let 当前 = '';
  return { 开过, async 新页面() { return { 页: { 打开: async u => { 开过.push(u); 当前 = u; return {}; }, 等待: async () => {}, 点击: async () => {}, 源码: async () => 表[当前] || '', 网址: () => 当前 }, 关: async () => {} }; } };
}

describe('写脚本', () => {
  test('第 1 轮给首页结构，AI 要看列表页；第 2 轮给列表页，AI 交回规则；试跑取到含比赛名的条目就写好；交回能存进比赛库的脚本', async () => {
    const ai = 假AI([{ 状态: '要看', 要看: [列表页], 列表页: '', 步骤: [], 说明: '' },
      规则([步('打开', { 网址: 列表页 }), 步('取列表', { 条目: 'ul.list li', 日期: 'span' })])]);
    const 回 = await 写脚本(比赛, { ai, 取源码: 假取源码({ [首页]: 首页html, [列表页]: 列表html }), 起点网址: 首页 });
    expect(ai.调用).toHaveLength(2);
    expect(ai.调用[0]).toMatchObject({ purpose: 'crawl_script', json: true, schema: 交回格式, promptVersion: 提问版本 });
    const 第一问 = ai.调用[0].messages[0].content;
    for (const 要有 of ['全国大学生数学建模竞赛', '打开', '等待', '点击', '取列表', '最后一步必须是取列表', '通知公告']) expect(第一问).toContain(要有);
    expect(ai.调用[1].messages[0].content).toContain('关于举办2026年全国大学生数学建模竞赛的通知');
    expect(回).toMatchObject({
      结果: '写好',
      脚本: { 列表页, 要浏览器: false, 提示版本: 'crawl-script-v1', 步骤: [{ 动作: '打开', 网址: 列表页 }, { 动作: '取列表', 条目: 'ul.list li', 日期: 'span' }] },
      试跑: { 状态: '成功' },
    });
    expect(回.试跑.条目们).toHaveLength(2);
    expect(回.轮们.map(x => x.状态)).toEqual(['要看', '规则']);
    expect(回.用量).toEqual({ tokensIn: 18000, tokensOut: 400 });
  });
  test('试跑不合格（取不到条目）：把试跑结果和列表页结构交给 AI 再改', async () => {
    const ai = 假AI([规则([步('取列表', { 条目: 'ol li' })]), 规则([步('取列表', { 条目: 'ul.list li' })])]);
    const 回 = await 写脚本(比赛, { ai, 取源码: 假取源码({ [首页]: 首页html, [列表页]: 列表html }), 起点网址: 首页 });
    expect(回.结果).toBe('写好');
    expect(ai.调用[1].messages[0].content).toContain('取不到条目（ol li）');
    expect(ai.调用[1].messages[0].content).toContain('ul class="list"');
  });
  test('直接下载是空壳页：改用浏览器打开后的页面，写出来的脚本标要浏览器', async () => {
    const 浏览器 = 假浏览器({ [首页]: 首页html.replace('<body>', '<body><div id="app">') , [列表页]: 列表html });
    const ai = 假AI([规则([步('打开', { 网址: 列表页 }), 步('等待', { 选择器: 'ul.list li' }), 步('取列表', { 条目: 'ul.list li' })])]);
    const 回 = await 写脚本(比赛, { ai, 取源码: 假取源码({ [首页]: 空壳 }), 浏览器, 起点网址: 首页 });
    expect(浏览器.开过[0]).toBe(首页);
    expect(ai.调用[0].messages[0].content).toContain('无头浏览器打开');
    expect(回).toMatchObject({ 结果: '写好', 脚本: { 要浏览器: true, 步骤: [{ 动作: '打开' }, { 动作: '等待', 选择器: 'ul.list li' }, { 动作: '取列表' }] } });
  });
  test('AI 说做不到：有浏览器就改用浏览器打开的页面再问一轮', async () => {
    const 浏览器 = 假浏览器({ [首页]: 首页html, [列表页]: 列表html });
    const ai = 假AI([{ 状态: '做不到', 要看: [], 列表页: '', 步骤: [], 说明: '列表靠脚本加载' }, 规则([步('取列表', { 条目: 'ul.list li' })])]);
    const 回 = await 写脚本(比赛, { ai, 取源码: 假取源码({ [首页]: 首页html, [列表页]: 列表html }), 浏览器, 起点网址: 首页 });
    expect(回).toMatchObject({ 结果: '写好', 脚本: { 要浏览器: true } });
  });
  test('要求用浏览器（旧脚本爬不到新通知时重写）：一开始就用浏览器，提示里写上重写原因和旧脚本', async () => {
    const 浏览器 = 假浏览器({ [首页]: 首页html, [列表页]: 列表html });
    const ai = 假AI([规则([步('取列表', { 条目: 'ul.list li' })])]);
    const 旧脚本 = { 列表页, 步骤: [{ 动作: '取列表', 条目: 'ol li' }], 要浏览器: false };
    const 回 = await 写脚本(比赛, { ai, 取源码: 假取源码({}), 浏览器, 起点网址: 首页, 要浏览器: true, 原因: '旧脚本爬不到新通知', 旧脚本 });
    expect(浏览器.开过[0]).toBe(首页);
    const 问 = ai.调用[0].messages[0].content;
    expect(问).toContain('旧脚本爬不到新通知');
    expect(问).toContain('ol li');
    expect(回).toMatchObject({ 结果: '写好', 脚本: { 要浏览器: true } });
  });
  test('写不出：3 轮都不合格、做不到又没有浏览器、步骤格式不对（不认识的动作）、起点打不开；AI 出错照样抛出', async () => {
    const 不行 = 规则([步('取列表', { 条目: 'ol li' })]);
    expect(await 写脚本(比赛, { ai: 假AI([不行, 不行, 不行]), 取源码: 假取源码({ [首页]: 首页html, [列表页]: 列表html }), 起点网址: 首页 })).toMatchObject({ 结果: '写不出', 原因: expect.stringContaining('3 轮') });
    expect(await 写脚本(比赛, { ai: 假AI([{ 状态: '做不到', 要看: [], 列表页: '', 步骤: [], 说明: '要登录' }]), 取源码: 假取源码({ [首页]: 首页html }), 起点网址: 首页 })).toMatchObject({ 结果: '写不出', 原因: '做不到：要登录' });
    const 坏 = 规则([{ ...步('取列表', { 条目: 'li' }), 动作: '运行' }]);
    const 回 = await 写脚本(比赛, { ai: 假AI([坏, 坏, 坏]), 取源码: 假取源码({ [首页]: 首页html, [列表页]: 列表html }), 起点网址: 首页 });
    expect(回.结果).toBe('写不出');
    expect(回.轮们[0].说明).toContain('不认识的动作');
    expect(await 写脚本(比赛, { ai: 假AI([]), 取源码: 假取源码({}), 起点网址: 首页 })).toMatchObject({ 结果: '写不出', 原因: expect.stringContaining('起点打不开') });
    await expect(写脚本(比赛, { ai: 假AI([Object.assign(new Error('额度用完'), { kind: '额度用完' })]), 取源码: 假取源码({ [首页]: 首页html }), 起点网址: 首页 })).rejects.toThrow('额度用完');
  });
  test('AI 交回的 JSON 解析不出来（格式不对）：记一轮“没按格式回答”，告诉下一轮，接着写', async () => {
    const 坏 = Object.assign(new Error('回答不是 JSON：好的，我来写'), { kind: '格式不对' });
    const ai = 假AI([坏, 规则([步('打开', { 网址: 列表页 }), 步('取列表', { 条目: 'ul.list li' })])]);
    const 回 = await 写脚本(比赛, { ai, 取源码: 假取源码({ [首页]: 首页html, [列表页]: 列表html }), 起点网址: 首页 });
    expect(回.结果).toBe('写好');
    expect(回.轮们[0]).toMatchObject({ 轮: 1, 状态: '没按格式' });
    expect(回.轮们[0].说明).toContain('没按格式回答');
    expect(ai.调用[1].messages[0].content).toContain('没按格式回答');
    // 3 轮都格式不对：写不出，不抛出
    const 都坏 = await 写脚本(比赛, { ai: 假AI([坏, 坏, 坏]), 取源码: 假取源码({ [首页]: 首页html }), 起点网址: 首页 });
    expect(都坏).toMatchObject({ 结果: '写不出', 原因: expect.stringContaining('没按格式回答') });
  });
  test('浏览器起不来（新页面抛错）：当这一页打不开，不抛出；原因里写“浏览器打不开”', async () => {
    const 坏浏览器 = { 新页面: async () => { throw new Error('browserType.launch: Executable does not exist'); } };
    const ai = 假AI([]);
    // 一开始就要浏览器
    const 回 = await 写脚本(比赛, { ai, 取源码: 假取源码({ [首页]: 首页html }), 浏览器: 坏浏览器, 起点网址: 首页, 要浏览器: true });
    expect(回).toMatchObject({ 结果: '写不出', 原因: expect.stringContaining('起点打不开：浏览器打不开：browserType.launch') });
    // 直接下载是空壳、改用浏览器时浏览器起不来
    const 空 = await 写脚本(比赛, { ai, 取源码: 假取源码({ [首页]: 空壳 }), 浏览器: 坏浏览器, 起点网址: 首页 });
    expect(空).toMatchObject({ 结果: '写不出', 原因: expect.stringContaining('浏览器打不开') });
    expect(ai.调用).toHaveLength(0);
  });
  test('试跑时浏览器起不来：算试跑不合格，原因里写“浏览器打不开”，不抛出', async () => {
    let 次 = 0;
    const 时好时坏 = { async 新页面() { 次 += 1; if (次 > 1) throw new Error('browser has been closed'); return 假浏览器({ [首页]: 首页html }).新页面(); } };
    const ai = 假AI([规则([步('取列表', { 条目: 'ul.list li' })])]);
    const 回 = await 写脚本(比赛, { ai, 取源码: 假取源码({}), 浏览器: 时好时坏, 起点网址: 首页, 要浏览器: true, 最多轮: 1 });
    expect(回.结果).toBe('写不出');
    expect(回.轮们[0].说明).toContain('浏览器打不开');
  });
});
