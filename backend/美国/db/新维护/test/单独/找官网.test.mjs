// 找官网（2026-11-07 用户定改法）：像人一样只搜比赛名、取前 10 条，DeepSeek 只做选择题（是哪条，都不是填 0），程序打开它选的核实，
// 交回结果和要写回搜索记忆的改动。之前的“DeepSeek 自己联网问”、方案三（自己搜、程序打分）都换掉了。全部用假的 AI、假的读网页。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../test/复用/样例数据.mjs';
import { 搜索记忆 } from '../../../index.mjs';
import { 选择题, 提问版本 } from '../../找官网/问题.mjs';
import { 核实页面, 名称写法 } from '../../找官网/核实.mjs';
import { 找官网, 写回记忆 } from '../../找官网/index.mjs';
import { 维护记录改动 } from '../../找官网/记忆.mjs';

const 数模 = { id: 'event-math', name: '全国大学生数学建模竞赛', aliases: ['国赛数模'], organizer: '中国工业与应用数学学会' };
const 目标 = { 年份: 2026, 届次: null, 已知年份: 2025, 已知届次: null };
const 空节 = () => Object.fromEntries(搜索记忆.节名.map(名 => [名, []]));
const 节 = 改 => ({ ...空节(), ...改 });
const 结果 = (title, url, 改 = {}) => ({ title, url, content: `${title} 的摘要`, date: '2026-04-01', ...改 });

describe('选择题', () => {
  const 候选 = [结果('关于举办2026年全国大学生数学建模竞赛的通知', 'https://www.mcm.edu.cn/a.html', { website: '数模组委会', authority: 3 }), 结果('转发：数模竞赛', 'https://jwc.abc.edu.cn/1.htm')];
  test('写明比赛、别名、主办方、搜的什么、要哪一届、什么不算；列出编号、标题、网址、网站名、日期、权威等级、摘要；带上教训；只回 JSON', () => {
    const 题 = 选择题(数模, { 年份: 2026, 届次: '第十八届' }, 候选, 节({ 教训: ['mcm.edu.cn 改版后通知在 /tzgg/'] }));
    for (const 要有 of ['全国大学生数学建模竞赛', '国赛数模', '中国工业与应用数学学会', '搜索「全国大学生数学建模竞赛」的前 2 条结果', '2026 年', '第十八届',
      '学校转发、新闻、竞赛聚合站、百科、公众号都不算', '1. 关于举办2026年全国大学生数学建模竞赛的通知', 'https://www.mcm.edu.cn/a.html', '数模组委会', '2026-04-01', '权威等级 3',
      '2. 转发：数模竞赛', 'mcm.edu.cn 改版后通知在 /tzgg/', '{"选":序号,"理由":"一句话"}', '都不是填 0']) expect(题).toContain(要有);
    expect(提问版本).toBe('official-pick-v1');
  });
  test('没有记忆、没有主办方时不写那几行；摘要太长截到 200 字', () => {
    const 题 = 选择题({ name: '某某大赛' }, { 年份: 2026, 届次: null }, [结果('某某大赛', 'https://a.cn/', { content: '长'.repeat(500) })], null);
    expect(题).not.toContain('主办方');
    expect(题).not.toContain('教训');
    expect(题).not.toContain('长'.repeat(201));
  });
});

describe('核实（程序打开 DeepSeek 选的网址）', () => {
  const 页 = (title, text, status = '成功') => ({ url: 'https://a.cn/', finalUrl: 'https://a.cn/', status, title, text, links: [] });
  test('名称的几种写法：原名、别名、去掉括号里的、按“—”“·”拆开的长段（都规范成小写、去空格）', () => {
    expect(名称写法({ name: '全国高校创新英语挑战赛（综合能力赛）', aliases: ['创英赛'] })).toEqual(['全国高校创新英语挑战赛(综合能力赛)', '创英赛', '全国高校创新英语挑战赛']);
    expect(名称写法({ name: '传智杯—AIoT嵌入式系统创新大赛' })).toEqual(['传智杯—aiot嵌入式系统创新大赛', 'aiot嵌入式系统创新大赛']);
    expect(名称写法({ name: '新锐设计竞赛·华灿奖' })).toEqual(['新锐设计竞赛·华灿奖', '新锐设计竞赛']);
  });
  test('页面上有比赛名称（任一写法）就算是这个比赛的页面；年份、主办单位只记下来，不卡', () => {
    expect(核实页面(页('关于举办2026年全国大学生数学建模竞赛的通知', '中国工业与应用数学学会'), 数模, 目标))
      .toEqual({ 结果: '合格', 缺: [], 有新一届: true, 年份对上: true, 主办单位对上: true });
    expect(核实页面(页('国赛数模', '欢迎'), 数模, 目标)).toEqual({ 结果: '合格', 缺: [], 有新一届: false, 年份对上: false, 主办单位对上: false });
    expect(核实页面(页('全国大学生数学建模竞赛', '2025 年赛题'), 数模, 目标)).toMatchObject({ 结果: '合格', 有新一届: false, 年份对上: true });
    expect(核实页面(页('首页', '欢迎'), 数模, 目标)).toMatchObject({ 结果: '不合格', 缺: ['比赛名称'] });
  });
  test('打不开：超时、网络错误、HTTP 错误；别的读不出算不合格', () => {
    for (const status of ['超时', '网络错误', 'HTTP错误']) expect(核实页面(页('', '', status), 数模, 目标).结果).toBe('打不开');
    expect(核实页面(页('', '', '不支持的类型'), 数模, 目标)).toMatchObject({ 结果: '不合格', 缺: ['读不出内容'] });
  });
});

// ---- 整个找官网 ----
const 官网页 = { status: '成功', title: '关于举办2026年全国大学生数学建模竞赛的通知', text: '中国工业与应用数学学会' };
const 官网网址 = 'https://www.mcm.edu.cn/html_cn/node/a.html';
const 搜到 = [
  结果('全国大学生数学建模竞赛 - 赛氪', 'https://www.saikr.com/vse/1'),
  结果('转发：关于举办2026年全国大学生数学建模竞赛的通知', 'https://jwc.abc.edu.cn/1.htm'),
  结果('关于举办2026年全国大学生数学建模竞赛的通知', 官网网址, { authority: 3 }),
];
// 搜：一个列表（每次搜都交回它）、按搜索词查的对象、或 Error；答：一个回答（每次都一样）、回答列表（依次用）、或 Error
function 假AI({ 搜 = 搜到, 答 = { 选: 2, 理由: '组委会发布的通知' } } = {}) {
  const 调用 = [];
  const 答们 = Array.isArray(答) ? [...答] : null;
  return {
    调用,
    async search(参数) {
      调用.push({ 搜索: 参数 });
      if (搜 instanceof Error) throw 搜;
      return { references: Array.isArray(搜) ? 搜 : (搜[参数.query] || []), provider: 'deepseek' };
    },
    async chat(参数) {
      调用.push({ 对话: 参数 });
      const 这次 = 答们 ? 答们.shift() : 答;
      if (这次 instanceof Error) throw 这次;
      return { data: 这次, usage: { tokensIn: 3000, tokensOut: 300 } };
    },
  };
}
const 假读网页 = 页们 => async url => ({ url, finalUrl: url, status: '网络错误', title: '', text: '', links: [], error: '连不上', ...页们[url] });
const 跑 = (ai, 页们 = { [官网网址]: 官网页 }, 比赛 = 数模) => 找官网(比赛, { ai, 读网页: 假读网页(页们), 节: 空节(), 目标, 屏蔽: ['saikr.com'], 今天: '2026-11-07' });
const 第一词 = '全国大学生数学建模竞赛';

describe('找官网', () => {
  test('只搜一次比赛名（official_search）；去掉屏蔽网站后把前 10 条交给 DeepSeek 选（official_pick，要 JSON）；打开它选的核实', async () => {
    const ai = 假AI();
    const 回 = await 跑(ai);
    expect(ai.调用[0].搜索).toMatchObject({ purpose: 'official_search', query: 第一词 });
    expect(ai.调用[1].对话).toMatchObject({ purpose: 'official_pick', json: true, promptVersion: 'official-pick-v1' });
    expect(ai.调用).toHaveLength(2);
    const 题 = ai.调用[1].对话.messages[0].content;
    expect(题).not.toContain('saikr.com');
    expect(题).toContain('2. 关于举办2026年全国大学生数学建模竞赛的通知');
    expect(回).toMatchObject({
      结果: '找到',
      官网: { 域名: 'mcm.edu.cn', 首页: 'https://www.mcm.edu.cn/', 网址: 官网网址, 标题: 官网页.title, 理由: '组委会发布的通知', 第几条: 2, 权威: 3, 有新一届: true, 年份对上: true, 主办单位对上: true },
      调用: { 搜索: 1, DeepSeek: 1, 打开: 1 }, 用量: { tokensIn: 3000, tokensOut: 300 },
    });
    expect(回.记忆改动).toEqual({
      官方域名: ['mcm.edu.cn'],
      成功过的搜索词: ['全国大学生数学建模竞赛（DeepSeek 搜索）'],
      往年通知标题格式: ['关于举办{年份}年全国大学生数学建模竞赛的通知'],
    });
  });
  test('只交前 10 条；同一网址只留一条', async () => {
    const 多 = Array.from({ length: 12 }, (_, i) => 结果(`第${i + 1}条`, `https://s${i + 1}.cn/`));
    const ai = 假AI({ 搜: [多[0], ...多], 答: { 选: 0, 理由: '都是转发' } });
    await 跑(ai);
    const 题 = ai.调用[1].对话.messages[0].content;
    expect(题).toContain('10. 第10条');
    expect(题).not.toContain('11. ');
    expect(题.split('https://s1.cn/')).toHaveLength(2);
  });
  test('页面读出来的文字没有比赛名称（网页加载后才显示内容这类），但它在搜索结果的标题或摘要里有：也算对上', async () => {
    const 回 = await 跑(假AI(), { [官网网址]: { status: '成功', title: '大赛', text: '请开启脚本' } });
    expect(回).toMatchObject({ 结果: '找到', 官网: { 标题: '大赛' } });
    const 读不出 = await 跑(假AI(), { [官网网址]: { status: '不支持的类型', title: '', text: '' } });
    expect(读不出).toMatchObject({ 结果: '找到', 官网: { 标题: 搜到[2].title } });
  });
  test.each([
    ['搜比赛名没有结果', { 搜: [] }, {}, '搜比赛名没有结果'],
    ['搜到的都是屏蔽名单里的网站', { 搜: [搜到[0]] }, {}, '搜到的 1 条都是屏蔽名单里的网站'],
    ['DeepSeek 说都不是', { 答: { 选: 0, 理由: '都是学校转发' } }, {}, 'DeepSeek 认为前 2 条里没有官网：都是学校转发'],
    ['DeepSeek 选的序号不在列表里', { 答: { 选: 7, 理由: 'x' } }, {}, 'DeepSeek 选的序号不对：7'],
    ['页面和搜索结果里都没有比赛名称', { 搜: [结果('首页', 官网网址, { content: '欢迎' })], 答: { 选: 1, 理由: 'x' } }, { [官网网址]: { status: '成功', title: '首页', text: '欢迎' } }, '选的页面上没有比赛名称：mcm.edu.cn'],
  ])('%s → 待审，写一条教训；只搜一次（2026-11-08 用户定：加搜效率低，不要）', async (_名, 设定, 页们, 原因) => {
    const 回 = await 找官网(数模, { ai: 假AI(设定), 读网页: 假读网页(页们), 节: 节({ 教训: ['一', '二', '三'] }), 目标, 屏蔽: ['saikr.com'], 今天: '2026-11-07' });
    expect(回).toMatchObject({ 结果: '待审', 官网: null, 原因, 调用: { 搜索: 1 } });
    expect(回.记忆改动).toEqual({ 教训: ['二', '三', `2026-11-07 搜比赛名没找到官网：${原因}`] });
  });
  test('选的网址打不开（美国、北京都读不到由 读网页 负责）：网络问题，记下网址', async () => {
    const ai = 假AI();
    const 回 = await 跑(ai, {});
    expect(回).toMatchObject({ 结果: '网络问题', 官网: null, 打不开: [官网网址], 调用: { 搜索: 1 } });
    expect(回.记忆改动).toEqual({ 教训: ['2026-11-07 官网 mcm.edu.cn 打不开，按频率再读'] });
  });
  test('DeepSeek 没按格式回答：待审；搜索或对话别的出错（额度用完、余额不足）照样报错，交给调用方顺延', async () => {
    const 格式 = Object.assign(new Error('试了 2 次都解析不出来'), { kind: '格式不对' });
    expect(await 跑(假AI({ 答: 格式 }))).toMatchObject({ 结果: '待审', 原因: 'DeepSeek 没按格式回答', 调用: { 搜索: 1 } });
    const 余额 = Object.assign(new Error('余额不足'), { kind: '额度用完' });
    await expect(跑(假AI({ 搜: 余额 }))).rejects.toThrow('余额不足');
    await expect(跑(假AI({ 答: 余额 }))).rejects.toThrow('余额不足');
  });
});

describe('写回记忆（比赛库）', () => {
  test('把记忆改动经 搜索记忆.改节 写进比赛库；还没有记忆的从初始开始', () => {
    const db = open(); seed(db);
    写回记忆(db, 'event-math', { 官方域名: ['mcm.edu.cn'] }, { 操作人: '找官网' });
    expect(搜索记忆.读(db, 'event-math')).toMatchObject({ version: 1, updated_by: '找官网', 节: { 官方域名: ['mcm.edu.cn'] } });
    写回记忆(db, 'event-math', { 教训: ['一'] }, { 操作人: '找官网' });
    expect(搜索记忆.读(db, 'event-math')).toMatchObject({ version: 2, 节: { 官方域名: ['mcm.edu.cn'], 教训: ['一'] } });
    expect(写回记忆(db, 'event-math', {}, { 操作人: '找官网' })).toBeNull();
  });
});

describe('维护记录改动（2026-11-08：每次维护成功失败都记一行，最新在前，只留最近 5 条）', () => {
  test('新的一行放最前面，挤掉最旧的；没有记忆、旧记忆没有这一节的从空开始', () => {
    expect(维护记录改动(null, '2026-11-08 成功：没有变化（指纹和上次一样，跳过）')).toEqual({ 维护记录: ['2026-11-08 成功：没有变化（指纹和上次一样，跳过）'] });
    expect(维护记录改动({ 教训: ['一'] }, '新')).toEqual({ 维护记录: ['新'] });
    expect(维护记录改动(节({ 维护记录: ['5', '4', '3', '2', '1'] }), '6')).toEqual({ 维护记录: ['6', '5', '4', '3', '2'] });
    expect(搜索记忆.最多维护记录).toBe(5);
  });
  test('经 写回记忆 写进比赛库，别的节不动', () => {
    const db = open(); seed(db);
    写回记忆(db, 'event-math', { 教训: ['一'] }, { 操作人: '新维护' });
    写回记忆(db, 'event-math', 维护记录改动(搜索记忆.读(db, 'event-math').节, '2026-11-08 失败：没发现这个比赛的通知'), { 操作人: '新维护' });
    expect(搜索记忆.读(db, 'event-math').节).toMatchObject({ 教训: ['一'], 维护记录: ['2026-11-08 失败：没发现这个比赛的通知'] });
  });
});
