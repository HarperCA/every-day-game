// 爬虫执行（2026-11-08 用户定）：按比赛库里的爬虫脚本（打开、等待、点击、取列表）取通知列表。
// 不要浏览器的脚本用 取源码（能带上次的 etag 问有没有更新），要浏览器的用 建浏览器。全部用假的取源码、假的浏览器。
import { describe, expect, test } from 'vitest';
import { 执行脚本, 取条目 } from '../../爬虫/执行.mjs';

const 列表页 = 'https://www.mcm.edu.cn/tzgg/';
const html = `<html><body><div class="nav"><a href="/">首页</a></div>
  <ul class="list">
    <li><a href="/a.html" title="关于举办2026年全国大学生数学建模竞赛的通知">关于举办2026年全国大学生数学建…</a><span class="date">2026-04-01</span></li>
    <li><a href="b.html">2025年赛题</a><span class="date">2025-09-01</span></li>
    <li><span>没有链接的条目</span></li>
  </ul></body></html>`;

describe('取条目', () => {
  test('按条目选择器取；标题优先用链接的 title；链接转成绝对网址；日期按相对选择器；没标题或没链接的不要', () => {
    expect(取条目(html, 列表页, { 条目: 'ul.list li', 日期: '.date' })).toEqual([
      { 标题: '关于举办2026年全国大学生数学建模竞赛的通知', 链接: 'https://www.mcm.edu.cn/a.html', 日期: '2026-04-01' },
      { 标题: '2025年赛题', 链接: 'https://www.mcm.edu.cn/tzgg/b.html', 日期: '2025-09-01' },
    ]);
  });
  test('给了标题、链接选择器就按它们取；条目本身是链接也行；同一链接只留一条', () => {
    const h = '<div><a class="t" href="/x">甲</a><a class="t" href="/x">甲</a><a class="t" href="/y">乙</a></div>';
    expect(取条目(h, 'https://a.cn/', { 条目: 'a.t' }).map(x => x.链接)).toEqual(['https://a.cn/x', 'https://a.cn/y']);
    expect(取条目(html, 列表页, { 条目: 'ul.list li', 标题: 'span.date', 链接: 'a' })[0]).toMatchObject({ 标题: '2026-04-01', 链接: 'https://www.mcm.edu.cn/a.html' });
  });
  test('选择器写错抛错', () => {
    expect(() => 取条目(html, 列表页, { 条目: 'ul[[' })).toThrow();
  });
});

function 假取源码(表) {
  const 调用 = [];
  const fn = async (url, 选项 = {}) => { 调用.push({ url, ...选项 }); return { url, finalUrl: url, status: '网络错误', httpStatus: null, html: '', error: '连不上', ...表[url] }; };
  fn.调用 = 调用;
  return fn;
}
function 假浏览器(页面们) {
  const 记 = [];
  let 当前 = '';
  return {
    记,
    关了: false,
    async 新页面() {
      return { 页: {
        打开: async url => { 记.push(['打开', url]); 当前 = url; return { httpStatus: 200, 网址: url }; },
        等待: async 参数 => { 记.push(['等待', 参数]); },
        点击: async 选择器 => { 记.push(['点击', 选择器]); 当前 = 页面们[`${当前}#${选择器}`] ? `${当前}#${选择器}` : 当前; },
        源码: async () => 页面们[当前] || '<html></html>',
        网址: () => 当前.split('#')[0],
      }, 关: async () => { 记.push(['关']); } };
    },
  };
}

describe('执行脚本', () => {
  const 单页 = { 列表页, 要浏览器: false, 步骤: [{ 动作: '打开', 网址: 列表页 }, { 动作: '取列表', 条目: 'ul.list li', 日期: '.date' }] };
  test('不要浏览器：取源码打开列表页（带上次的 etag、最后修改），按取列表取出条目，交回网站给的新版本标记', async () => {
    const 取源码 = 假取源码({ [列表页]: { status: '成功', html, etag: '"v2"', 最后修改: 'x' } });
    const 回 = await 执行脚本(单页, { 取源码, etag: '"v1"', 最后修改: 'w' });
    expect(取源码.调用[0]).toMatchObject({ url: 列表页, etag: '"v1"', 最后修改: 'w' });
    expect(回).toMatchObject({ 状态: '成功', 最终网址: 列表页, etag: '"v2"', 最后修改: 'x' });
    expect(回.条目们).toHaveLength(2);
  });
  test('网站说没更新：交回“没更新”，不取条目', async () => {
    const 回 = await 执行脚本(单页, { 取源码: 假取源码({ [列表页]: { status: '没更新', etag: '"v1"' } }), etag: '"v1"' });
    expect(回).toMatchObject({ 状态: '没更新', 条目们: [] });
  });
  test('没写打开就打开列表页；打开失败、取不到条目、选择器写错都算失败并写明原因', async () => {
    expect(await 执行脚本({ ...单页, 步骤: [{ 动作: '取列表', 条目: 'ul.list li' }] }, { 取源码: 假取源码({ [列表页]: { status: '成功', html } }) })).toMatchObject({ 状态: '成功' });
    expect(await 执行脚本(单页, { 取源码: 假取源码({}) })).toMatchObject({ 状态: '失败', 错误: '打开 https://www.mcm.edu.cn/tzgg/：网络错误 连不上' });
    expect(await 执行脚本({ ...单页, 步骤: [{ 动作: '取列表', 条目: 'ol.none li' }] }, { 取源码: 假取源码({ [列表页]: { status: '成功', html } }) })).toMatchObject({ 状态: '失败', 错误: '取不到条目（ol.none li）' });
    expect((await 执行脚本({ ...单页, 步骤: [{ 动作: '取列表', 条目: 'ul[[' }] }, { 取源码: 假取源码({ [列表页]: { status: '成功', html } }) })).错误).toContain('选择器出错');
  });
  test('不要浏览器的脚本里有点击：失败，要浏览器才能点', async () => {
    const 回 = await 执行脚本({ ...单页, 步骤: [{ 动作: '打开', 网址: 列表页 }, { 动作: '点击', 选择器: 'a' }, { 动作: '取列表', 条目: 'li' }] }, { 取源码: 假取源码({ [列表页]: { status: '成功', html } }) });
    expect(回).toMatchObject({ 状态: '失败', 错误: '第 2 步点击要浏览器' });
  });
  test('要浏览器：照步骤打开、点击、等待，取列表时读当前页面源码；用完关掉页面', async () => {
    const 首页 = 'https://www.raicom.com.cn/';
    const 浏览器 = 假浏览器({ [首页]: '<html>首页</html>', [`${首页}#a.docs`]: html });
    const 脚本 = { 列表页: 首页, 要浏览器: true, 步骤: [{ 动作: '打开', 网址: 首页 }, { 动作: '点击', 选择器: 'a.docs' }, { 动作: '等待', 选择器: 'ul.list li' }, { 动作: '取列表', 条目: 'ul.list li' }] };
    const 回 = await 执行脚本(脚本, { 浏览器 });
    expect(浏览器.记).toEqual([['打开', 首页], ['点击', 'a.docs'], ['等待', { 选择器: 'ul.list li' }], ['关']]);
    expect(回).toMatchObject({ 状态: '成功', etag: null });
    expect(回.条目们.map(x => x.链接)).toEqual(['https://www.mcm.edu.cn/a.html', 'https://www.raicom.com.cn/b.html'].map(u => u.replace('www.mcm.edu.cn', 'www.raicom.com.cn')));
  });
  test('浏览器里出错（点不到、超时）：失败并写明哪一步，页面照样关掉', async () => {
    const 浏览器 = 假浏览器({});
    浏览器.新页面 = async () => ({ 页: { 打开: async () => ({}), 点击: async () => { throw new Error('Timeout 20000ms'); }, 等待: async () => {}, 源码: async () => '', 网址: () => '' }, 关: async () => { 浏览器.关了 = true; } });
    const 回 = await 执行脚本({ 列表页, 要浏览器: true, 步骤: [{ 动作: '点击', 选择器: 'a' }, { 动作: '取列表', 条目: 'li' }] }, { 浏览器 });
    expect(回).toMatchObject({ 状态: '失败', 错误: '第 1 步点击：Timeout 20000ms' });
    expect(浏览器.关了).toBe(true);
  });
  test('浏览器起不来（新页面抛错）：不抛出，交回失败，错误以“浏览器打不开”开头，失败类是网络', async () => {
    const 浏览器 = { 新页面: async () => { throw new Error('browserType.launch: Executable does not exist'); } };
    const 回 = await 执行脚本({ 列表页, 要浏览器: true, 步骤: [{ 动作: '取列表', 条目: 'li' }] }, { 浏览器 });
    expect(回).toMatchObject({ 状态: '失败', 失败类: '网络' });
    expect(回.错误).toMatch(/^浏览器打不开：browserType\.launch/);
  });
});

describe('失败类：网络（打不开、超时、HTTP 错误、robots 不允许、浏览器打不开）还是取不到（取不到条目、选择器出错、步骤不对）', () => {
  const 单页 = { 列表页, 要浏览器: false, 步骤: [{ 动作: '打开', 网址: 列表页 }, { 动作: '取列表', 条目: 'ul.list li' }] };
  const 跑 = (步骤, 表) => 执行脚本({ ...单页, 步骤 }, { 取源码: 假取源码(表) });
  test('不要浏览器：打开失败按取源码的状态分', async () => {
    for (const status of ['网络错误', '超时', 'HTTP错误', 'robots不允许']) {
      expect((await 跑(单页.步骤, { [列表页]: { status, error: 'x' } })).失败类, status).toBe('网络');
    }
    // 脚本里的网址不安全、列表页不是网页：重跑没用，要重写脚本
    for (const status of ['网址不安全', '不支持的类型']) {
      expect((await 跑(单页.步骤, { [列表页]: { status, error: 'x' } })).失败类, status).toBe('取不到');
    }
  });
  test('不要浏览器：取不到条目、选择器出错、点击要浏览器、没有取列表都算取不到；成功和没更新不带失败类', async () => {
    const 有页 = { [列表页]: { status: '成功', html } };
    expect((await 跑([{ 动作: '取列表', 条目: 'ol.none li' }], 有页)).失败类).toBe('取不到');
    expect((await 跑([{ 动作: '取列表', 条目: 'ul[[' }], 有页)).失败类).toBe('取不到');
    expect((await 跑([{ 动作: '打开', 网址: 列表页 }, { 动作: '点击', 选择器: 'a' }, { 动作: '取列表', 条目: 'li' }], 有页)).失败类).toBe('取不到');
    expect((await 跑([{ 动作: '打开', 网址: 列表页 }], 有页)).失败类).toBe('取不到');
    expect((await 跑(单页.步骤, 有页)).失败类 ?? null).toBeNull();
    expect((await 跑(单页.步骤, { [列表页]: { status: '没更新' } })).失败类 ?? null).toBeNull();
  });
  function 出错浏览器(错在, 错误) {
    return { async 新页面() {
      const 动作 = { 打开: async () => ({}), 点击: async () => {}, 等待: async () => {}, 源码: async () => html, 网址: () => 列表页 };
      动作[错在] = async () => { throw new Error(错误); };
      return { 页: 动作, 关: async () => {} };
    } };
  }
  const 浏览器脚本 = { 列表页, 要浏览器: true, 步骤: [{ 动作: '打开', 网址: 列表页 }, { 动作: '点击', 选择器: 'a.more' }, { 动作: '等待', 选择器: 'ul.list li' }, { 动作: '取列表', 条目: 'ul.list li' }] };
  test('要浏览器：打开出错算网络（网址不安全除外）；点击、等待找不到选择器算取不到；浏览器中途关掉算网络', async () => {
    const 类 = async (错在, 错误) => (await 执行脚本(浏览器脚本, { 浏览器: 出错浏览器(错在, 错误) })).失败类;
    expect(await 类('打开', 'page.goto: net::ERR_NAME_NOT_RESOLVED at https://x/')).toBe('网络');
    expect(await 类('打开', 'page.goto: Timeout 20000ms exceeded.')).toBe('网络');
    expect(await 类('打开', '页面请求了不安全的地址：跳转到 http://10.0.0.1/ 不读内网地址 10.0.0.1')).toBe('网络');
    expect(await 类('打开', '网址不安全：不读内网地址 10.0.0.1')).toBe('取不到');
    expect(await 类('点击', 'page.click: Timeout 20000ms exceeded.')).toBe('取不到');
    expect(await 类('等待', 'page.waitForSelector: Timeout 20000ms exceeded.')).toBe('取不到');
    expect(await 类('源码', 'page.content: Target page, context or browser has been closed')).toBe('网络');
    expect(await 类('点击', 'page.click: Target page, context or browser has been closed')).toBe('网络');
  });
  test('脚本要浏览器但没给浏览器：算网络（环境问题，不用重写脚本）', async () => {
    expect(await 执行脚本(浏览器脚本, {})).toMatchObject({ 状态: '失败', 失败类: '网络' });
  });
});
