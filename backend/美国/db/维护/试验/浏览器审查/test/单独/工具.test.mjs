// 试验：Codex 只能用我们的工具（搜索、读页）。交回的内容要短，次数硬限制，屏蔽站直接拒绝，读过的全文留着给程序核对。
import { describe, expect, test } from 'vitest';
import { 截取片段, 筛链接 } from '../../片段.mjs';
import { 建工具, 工具定义 } from '../../工具.mjs';

describe('截取片段：只交回有用的段落，文字一个字不改', () => {
  const 废话 = '学校新闻动态，欢迎访问本站。'.repeat(3);
  const 正文 = ['某学会关于举办第五届全国大学生测试大赛的通知', ...Array(300).fill(废话), '主办单位：中国测试学会', ...Array(300).fill(废话), '报名截止时间：2026年12月30日 17:00', '参赛对象：全国高校在校学生'].join('\n');

  test('要紧的行都留下，总长不超过上限，废话被去掉', () => {
    const { 片段, 总字数, 显示字数 } = 截取片段(正文, { 名称: '全国大学生测试大赛', 上限: 600 });
    for (const 行 of ['主办单位：中国测试学会', '报名截止时间：2026年12月30日 17:00', '参赛对象：全国高校在校学生', '第五届全国大学生测试大赛的通知']) expect(片段).toContain(行);
    expect(片段.length).toBeLessThanOrEqual(600);
    expect(显示字数).toBe(片段.length);
    expect(总字数).toBe(正文.length);
  });
  test('按原来的先后排列，中间跳过的地方有标记', () => {
    const { 片段 } = 截取片段(正文, { 上限: 600 });
    expect(片段.indexOf('主办单位')).toBeLessThan(片段.indexOf('报名截止时间'));
    expect(片段).toContain('……');
  });
  test('很长的一行按句子切开，只留有用的句子', () => {
    const 长行 = `${'无关的内容在这里。'.repeat(400)}报名截止日期为2026年10月31日。${'无关的内容在这里。'.repeat(400)}`;
    const { 片段 } = 截取片段(长行, { 上限: 300 });
    expect(片段).toContain('报名截止日期为2026年10月31日');
    expect(片段.length).toBeLessThanOrEqual(300);
  });
  test('短页面原样全给', () => {
    expect(截取片段('第一行\n第二行', { 上限: 600 }).片段).toBe('第一行\n第二行');
  });
  test('空正文不出错', () => {
    expect(截取片段('', {})).toMatchObject({ 片段: '', 总字数: 0 });
  });
});

describe('筛链接：留通知、附件、报名，去掉导航', () => {
  test('有用的排前面，有上限', () => {
    const 链接们 = [{ url: 'https://a.cn/', text: '首页' }, { url: 'https://a.cn/x', text: '关于我们' }, { url: 'https://a.cn/n.pdf', text: '附件1' }, { url: 'https://a.cn/s', text: '在线报名' }, { url: 'https://a.cn/t', text: '大赛通知' }];
    expect(筛链接(链接们, { 上限: 2 }).map(l => l.url)).toEqual(['https://a.cn/n.pdf', 'https://a.cn/s']);
    expect(筛链接(链接们).map(l => l.url)).not.toContain('https://a.cn/x');
  });
  test('名字和比赛有关的也留', () => {
    expect(筛链接([{ url: 'https://a.cn/q', text: '全国大学生测试大赛专栏' }], { 名称: '全国大学生测试大赛' })).toHaveLength(1);
  });
});

function 工具们(改 = {}) {
  const 搜过 = [], 读过 = [];
  const t = 建工具({
    搜索: async 词 => { 搜过.push(词); return [{ title: '通知', url: 'https://a.cn/n', content: '摘要'.repeat(200) }, { title: '聚合', url: 'https://www.saikr.com/x', content: '聚合站' }]; },
    读页: async 网址 => { 读过.push(网址); return { status: '成功', url: 网址, finalUrl: 网址, title: '标题', text: `主办单位：中国测试学会\n网址是 ${网址}`, links: [{ url: 'https://a.cn/s', text: '在线报名' }], 线路: '浏览器' }; },
    屏蔽了: 网址 => /saikr\.com/.test(网址),
    ...改,
  });
  return { t, 搜过, 读过 };
}

describe('工具：次数硬限制（2026-11-07 验证用）', () => {
  test('工具定义只有搜索和读页，没有点击、填表、执行脚本', () => {
    expect(工具定义.map(x => x.name).sort()).toEqual(['read_page', 'search']);
  });
  test('每轮只能搜 1 次，第 2 次拒绝且不真的去搜', async () => {
    const { t, 搜过 } = 工具们();
    t.开一轮('r1', { 名称: '大赛' });
    expect((await t.调用('r1', 'search', { query: '大赛 2026' })).出错).toBeFalsy();
    const 第二次 = await t.调用('r1', 'search', { query: '再搜' });
    expect(第二次.出错).toBe(true);
    expect(第二次.文字).toContain('次数');
    expect(搜过).toEqual(['大赛 2026']);
  });
  test('每轮最多读 3 页，下一轮重新算', async () => {
    const { t, 读过 } = 工具们();
    t.开一轮('r1', {});
    for (const n of [1, 2, 3]) expect((await t.调用('r1', 'read_page', { url: `https://a.cn/${n}` })).出错).toBeFalsy();
    expect((await t.调用('r1', 'read_page', { url: 'https://a.cn/4' })).出错).toBe(true);
    expect(读过).toHaveLength(3);
    t.开一轮('r2', {});
    expect((await t.调用('r2', 'read_page', { url: 'https://a.cn/4' })).出错).toBeFalsy();
  });
  test('读过的再读不算次数，也不重新打开', async () => {
    const { t, 读过 } = 工具们();
    t.开一轮('r1', {});
    await t.调用('r1', 'read_page', { url: 'https://a.cn/1' });
    await t.调用('r1', 'read_page', { url: 'https://a.cn/1' });
    expect(读过).toHaveLength(1);
    expect(t.记录('r1').读页).toBe(1);
  });
  test('屏蔽站：搜索结果里去掉，直接读也拒绝且不算次数', async () => {
    const { t, 读过 } = 工具们();
    t.开一轮('r1', {});
    const 搜 = await t.调用('r1', 'search', { query: 'x' });
    expect(搜.文字).toContain('https://a.cn/n');
    expect(搜.文字).not.toContain('saikr');
    const 读 = await t.调用('r1', 'read_page', { url: 'https://www.saikr.com/x' });
    expect(读.出错).toBe(true);
    expect(读过).toEqual([]);
    expect(t.记录('r1').读页).toBe(0);
  });
  test('摘要截短', async () => {
    const { t } = 工具们();
    t.开一轮('r1', {});
    expect((await t.调用('r1', 'search', { query: 'x' })).文字.length).toBeLessThan(400);
  });
  test('读页交回片段和链接；全文留着，按原网址和最终网址都找得到', async () => {
    const { t } = 工具们({ 读页: async 网址 => ({ status: '成功', url: 网址, finalUrl: 'https://a.cn/final', title: '标题', text: '主办单位：中国测试学会', links: [{ url: 'https://a.cn/s', text: '在线报名' }], 线路: '浏览器' }) });
    t.开一轮('r1', {});
    const 回 = await t.调用('r1', 'read_page', { url: 'https://a.cn/1' });
    expect(回.文字).toContain('主办单位：中国测试学会');
    expect(回.文字).toContain('https://a.cn/s');
    expect(t.页(' https://a.cn/1 '.trim())?.text).toContain('主办单位');
    expect(t.页('https://a.cn/final')?.text).toContain('主办单位');
  });
  test('读不到：告诉 Codex 状态，算一次，不再重试；页面状态留给程序判断', async () => {
    const { t } = 工具们({ 读页: async 网址 => ({ status: '超时', url: 网址, finalUrl: 网址, text: '', links: [], error: '超时' }) });
    t.开一轮('r1', {});
    const 回 = await t.调用('r1', 'read_page', { url: 'https://a.cn/1' });
    expect(回.出错).toBeFalsy();
    expect(回.文字).toContain('超时');
    expect(回.文字).toContain('不要重试');
    expect(t.页('https://a.cn/1').status).toBe('超时');
    expect(t.记录('r1').读页).toBe(1);
  });
  test('记录每轮交回给 Codex 的字数', async () => {
    const { t } = 工具们();
    t.开一轮('r1', {});
    const 回 = await t.调用('r1', 'read_page', { url: 'https://a.cn/1' });
    expect(t.记录('r1').交回字数).toBe(回.文字.length);
  });
  test('没开过的一轮、不认识的工具：拒绝', async () => {
    const { t } = 工具们();
    expect((await t.调用('没开', 'search', { query: 'x' })).出错).toBe(true);
    t.开一轮('r1', {});
    expect((await t.调用('r1', '点击', {})).出错).toBe(true);
  });
  test('搜索接口出错：告诉 Codex，不抛出', async () => {
    const { t } = 工具们({ 搜索: async () => { throw new Error('429'); } });
    t.开一轮('r1', {});
    const 回 = await t.调用('r1', 'search', { query: 'x' });
    expect(回.出错).toBe(true);
    expect(回.文字).toContain('搜索失败');
  });
});
