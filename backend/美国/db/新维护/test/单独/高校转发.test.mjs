// 找高校转发（2026-11-13 用户定）：新维护里官网打不开（无头浏览器也打不开）时，改用第三方通知——复用找新一届那套“学校转发”的搜索和核对：
// 搜“比赛名 + 年份/届次”，只要高校网站（.edu.cn、不是已知官方网站）上的；程序核对比赛名和届次，排除招新、承办、实施方案、获奖公示、
// 国家级比赛的赛区省赛；找到这一届（库里最新一届）或新一届的转发通知，交回给入库的条目（带比赛编号、来源类型 school_repost；
// 这一届带届次编号，新一届带新届）。不调 DeepSeek 选择题，只用程序核对。用假的搜索、读网页，真的比赛库（内存）。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../test/复用/样例数据.mjs';
import { 找高校转发 } from '../../找新一届/高校转发.mjs';
import { 同届 } from '../../找新一届/核对.mjs';

const 名 = '中国大学生计算机设计大赛';
const 官网 = 'https://jsjds.blcu.edu.cn/';
function 库({ 级别 = '国家级' } = {}) {
  const db = open(); seed(db);
  db.transaction(tx => {
    tx.insert('competition', 'event-cz', { name: 名, level: 级别, website: 官网 });
    tx.insert('edition', 'edition-cz-2025', { competition_id: 'event-cz', ordinal: 1, edition_name: `2025年第十八届${名}`, edition_year: '2025', edition_ordinal: '第十八届', status: '已发布' });
  });
  return db;
}
const 条 = (url, title, 改 = {}) => ({ url, title, content: '', date: '2026-11-01', ...改 });
const 页 = (title, text = '', 改 = {}) => ({ status: '成功', title, text, finalUrl: '', error: '', links: [], ...改 });
function 假会话(搜 = () => []) {
  const 搜索 = [];
  return { 搜索, search: async ({ purpose, query }) => { 搜索.push({ purpose, query }); return { references: 搜(query) }; } };
}
function 假读网页(页们 = {}) {
  const 读过 = [];
  return { 读过, 读网页: async 网址 => { 读过.push(网址); return 页们[网址] ?? { status: '网络错误', title: '', text: '', error: '连接被拒绝' }; } };
}
const 跑 = (db, 会话, 读网页) => 找高校转发('event-cz', { db, 会话, 读网页, 屏蔽: ['saikr.com'], 今天: '2026-11-13' });

describe('同届（和库里最新一届是不是同一届）', () => {
  test('两边都有届次比届次；否则比年份（单个年份落在区间里算，区间比开头）', () => {
    expect(同届({ 届: 18, 年: null }, { 届: 18, 年: 2025 })).toBe(true);
    expect(同届({ 届: 19, 年: 2025 }, { 届: 18, 年: 2025 })).toBe(false);
    expect(同届({ 届: null, 年: 2025, 年止: 2025 }, { 届: 18, 年: 2025, 年止: 2025 })).toBe(true);
    expect(同届({ 届: null, 年: 2026, 年止: 2026 }, { 届: null, 年: 2025, 年止: 2026 })).toBe(true);
    expect(同届({ 届: null, 年: 2026, 年止: 2027 }, { 届: null, 年: 2025, 年止: 2026 })).toBe(false);
    expect(同届({ 届: null, 年: null }, { 届: 18, 年: 2025 })).toBe(false);
  });
});

describe('找高校转发', () => {
  const 本届转发 = 'https://jwc.abc.edu.cn/info/1001/1.htm';
  const 新届转发 = 'https://jwc.def.edu.cn/info/1001/2.htm';
  const 新届转发2 = 'https://cs.ghi.edu.cn/info/2.htm';
  const 结果们 = [
    条(本届转发, `关于组织参加2025年第十八届${名}的通知`),
    条(新届转发, `关于组织参加第十九届${名}的通知`),
    条(新届转发2, `转发：第十九届${名}通知`),
    条(`${官网}notice/19.html`, `第十九届${名}通知`),                       // 已知官方网站上的（官网打不开时也读不到），不要
    条('https://www.saikr.com/vse/19', `第十九届${名}`),                    // 屏蔽网站
    条('https://news.example.com/19', `第十九届${名}开赛`),                 // 不是高校网站
    条('https://jwc.xyz.edu.cn/info/3.htm', `第十九届${名}获奖名单公示`),    // 获奖公示
    条('https://jwc.xyz.edu.cn/info/4.htm', `第十九届${名}江苏赛区通知`),    // 国家级比赛的赛区通知
    条('https://jwc.xyz.edu.cn/info/5.htm', `关于组织第十七届${名}的通知`),  // 旧届
    条('https://jwc.xyz.edu.cn/info/6.htm', '关于举办某某杯的通知'),         // 没有比赛名
  ];
  test('搜“比赛名 + 年份/下一届”（用途 new_edition_search）；只要高校网站上的、排除招新获奖赛区旧届没比赛名的；这一届带届次编号，新一届带新届，同一新届只交一条', async () => {
    const db = 库();
    const 会话 = 假会话(() => 结果们);
    const { 读过, 读网页 } = 假读网页({
      [本届转发]: 页(`关于组织参加2025年第十八届${名}的通知`, '报名截止 2025年4月15日'),
      [新届转发]: 页(`关于组织参加第十九届${名}的通知`, '各学院：……'),
      [新届转发2]: 页(`转发：第十九届${名}通知`),
    });
    const 回 = await 跑(db, 会话, 读网页);
    expect(会话.搜索).toEqual([
      { purpose: 'new_edition_search', query: `${名} 2025` },
      { purpose: 'new_edition_search', query: `${名} 2026` },
      { purpose: 'new_edition_search', query: `${名} 第十九届` },
    ]);
    expect(读过).toEqual([本届转发, 新届转发]);   // 第二条第十九届的：同一届已经有了，不读
    expect(回.条目们).toEqual([
      expect.objectContaining({ 网址: 本届转发, 标题: `关于组织参加2025年第十八届${名}的通知`, 比赛名: 名, 比赛编号: 'event-cz', 届次: 'edition-cz-2025', 来源类型: 'school_repost' }),
      expect.objectContaining({ 网址: 新届转发, 比赛编号: 'event-cz', 新届: { 年份: null, 届次: '第十九届' }, 来源类型: 'school_repost' }),
    ]);
    expect(回.条目们[0].核对说明).toContain('官网打不开');
    expect(回.条目们[0].核对说明).toContain('abc.edu.cn');
    expect(回.条目们[1]).not.toHaveProperty('届次');
    const 说明 = 回.过程.map(x => x.说明).join('\n');
    for (const 有 of ['获奖公示', '赛区', '旧届', '没有比赛名', '不是高校网站', '已知官方网站', '屏蔽网站', '同一届已有']) expect(说明).toContain(有);
    expect(回.过程.every(x => x.步骤 && x.说明)).toBe(true);
  });
  test('读页面再核对：打不开、标题是排除那类、页面没比赛名的不用；标题认不出届次的用页面认（正文紧挨比赛名的届次）', async () => {
    const db = 库();
    const a = 'https://jwc.a.edu.cn/1.htm', b = 'https://jwc.b.edu.cn/2.htm', c = 'https://jwc.c.edu.cn/3.htm', d = 'https://jwc.d.edu.cn/4.htm';
    const 会话 = 假会话(q => (q.endsWith('2025') ? [条(a, `${名}通知`), 条(b, `${名}报名`), 条(c, `${名}安排`), 条(d, `${名}要求`)] : []));
    const { 读网页 } = 假读网页({
      [b]: 页('关于公布获奖名单的通知', `${名}`),
      [c]: 页('通知', '欢迎'),
      [d]: 页(`${名}要求`, `第十九届${名}将于2026年举行`),
    });
    const 回 = await 跑(db, 会话, 读网页);
    expect(回.条目们).toEqual([expect.objectContaining({ 网址: d, 新届: { 年份: null, 届次: '第十九届' } })]);
    const 说明 = 回.过程.map(x => x.说明).join('\n');
    expect(说明).toContain(`${a}：打不开`);
    expect(说明).toContain(`${b}：页面标题是获奖公示`);
    expect(说明).toContain(`${c}：页面上没有比赛名`);
  });
  test('没有会话（没配 AI）或比赛没有届次：不搜，交回空', async () => {
    expect((await 跑(库(), null, async () => ({}))).条目们).toEqual([]);
    const db = open(); seed(db);
    db.insert('competition', 'event-cz', { name: 名, level: '国家级' });
    const 会话 = 假会话();
    expect((await 找高校转发('event-cz', { db, 会话, 读网页: async () => ({}), 今天: '2026-11-13' })).条目们).toEqual([]);
    expect(会话.搜索).toEqual([]);
  });
});

// 2026-11-13 服务器试跑抽查出的两个错 → 用户定三条规矩（核对.mjs 共用）：转发页要够新；只建比库里新的最新一届、一次最多一届；来源必须是通知详情页
describe('找高校转发：够新、只建最新一届、只用详情页（2026-11-13）', () => {
  const 跑2 = (db, 编号, 会话, 读网页) => 找高校转发(编号, { db, 会话, 读网页, 屏蔽: [], 今天: '2026-11-13' });
  const 智慧 = '全国智慧城市与智能建造大学生创新创业竞赛';
  const 南通 = 'https://xgc.ntu.edu.cn/2024/1012/c2608a251445/page.psp';
  function 智慧库() {
    const db = open(); seed(db);
    db.transaction(tx => {
      tx.insert('competition', 'event-zh', { name: 智慧, level: '国家级', website: 'https://zhcs.example.org/' });
      tx.insert('edition', 'ed-zh-4', { competition_id: 'event-zh', ordinal: 1, edition_name: `2023年第四届${智慧}`, edition_year: '2023', edition_ordinal: '第四届', competition_end: '2023-12-10', status: '已发布' });
    });
    return db;
  }
  test('全国智慧城市与智能建造：2024-10-12 的转发页（网址里有日期）太旧，不读、不建“第五届”；搜索日期给错了也按网址里的日期认', async () => {
    for (const 搜索日期 of ['2024-10-12', '2026-11-01', '']) {
      const 会话 = 假会话(() => [条(南通, `关于组织参加第五届${智慧}的通知`, { date: 搜索日期 })]);
      const { 读过, 读网页 } = 假读网页({ [南通]: 页(`关于组织参加第五届${智慧}的通知`, `第五届${智慧}现已启动`) });
      const 回 = await 跑2(智慧库(), 'event-zh', 会话, 读网页);
      expect(回.条目们).toEqual([]);
      expect(读过).toEqual([]);
      expect(回.过程.map(x => x.说明).join('\n')).toContain('转发页太旧：2024-10-12');
    }
  });
  test('网址和搜索结果都没日期：读页面认正文里的发布时间，太旧不用', async () => {
    const 网址 = 'https://xgc.ntu.edu.cn/info/1001/2345.htm';
    const 会话 = 假会话(() => [条(网址, `关于组织参加第五届${智慧}的通知`, { date: '' })]);
    const { 读网页 } = 假读网页({ [网址]: 页(`关于组织参加第五届${智慧}的通知`, `发布时间：2024-10-12 浏览次数：30\n第五届${智慧}现已启动`) });
    const 回 = await 跑2(智慧库(), 'event-zh', 会话, 读网页);
    expect(回.条目们).toEqual([]);
    expect(回.过程.map(x => x.说明).join('\n')).toContain('转发页太旧：2024-10-12');
  });
  test('认不出日期：标题或正文有比库里新的届次才用（新一届）；这一届的认不出日期不用', async () => {
    const 新 = 'https://jwc.a.edu.cn/info/1001/7.htm';
    const 本 = 'https://jwc.b.edu.cn/info/1001/8.htm';
    const 会话 = 假会话(q => (q.endsWith('2023') ? [条(本, `关于组织参加第四届${智慧}的通知`, { date: '' }), 条(新, `关于组织参加第七届${智慧}的通知`, { date: '' })] : []));
    const { 读网页 } = 假读网页({ [新]: 页(`关于组织参加第七届${智慧}的通知`, '各学院：……'), [本]: 页(`关于组织参加第四届${智慧}的通知`, '各学院：……') });
    const 回 = await 跑2(智慧库(), 'event-zh', 会话, 读网页);
    expect(回.条目们).toEqual([expect.objectContaining({ 网址: 新, 新届: { 年份: null, 届次: '第七届' } })]);
    expect(回.过程.map(x => x.说明).join('\n')).toContain(`${本}：认不出发布日期`);
  });

  const 文学 = '上海市大学生原创文学大赛';
  const 华师 = 'https://xsgzb.ecnu.edu.cn/p40114c8089/list6.htm';
  function 文学库() {
    const db = open(); seed(db);
    db.transaction(tx => {
      tx.insert('competition', 'event-wx', { name: 文学, level: '省级/区域级' });
      tx.insert('edition', 'ed-wx-9', { competition_id: 'event-wx', ordinal: 1, edition_name: `第九届${文学}`, edition_ordinal: '第九届', edition_year: '2022', competition_end: '2022-12-01', status: '已发布' });
    });
    return db;
  }
  test('上海市大学生原创文学大赛：华东师大的列表页不用；同时找到第十届、第十三届，只建最新的第十三届', async () => {
    const 十 = 'https://xsgzb.abc.edu.cn/2026/0301/c1a2/page.htm';
    const 十三 = 'https://tw.def.edu.cn/2026/1001/c3a4/page.htm';
    const 会话 = 假会话(q => (q.endsWith('2022') ? [条(华师, `第十届${文学}`, { date: '2026-10-20' }), 条(十, `关于举办第十届${文学}的通知`, { date: '2026-03-01' }), 条(十三, `关于举办第十三届${文学}的通知`, { date: '2026-10-01' })] : []));
    const { 读过, 读网页 } = 假读网页({
      [十]: 页(`关于举办第十届${文学}的通知`, `第十届${文学}征稿启事`),
      [十三]: 页(`关于举办第十三届${文学}的通知`, `第十三届${文学}征稿启事`),
    });
    const 回 = await 跑2(文学库(), 'event-wx', 会话, 读网页);
    expect(读过).not.toContain(华师);
    expect(回.条目们).toEqual([expect.objectContaining({ 网址: 十三, 新届: { 年份: null, 届次: '第十三届' } })]);
    const 说明 = 回.过程.map(x => x.说明).join('\n');
    expect(说明).toContain('列表页');
    expect(说明).toContain('只建最新的第十三届');
  });
  test('读到的页面像列表（链接多、正文几乎都是链接文字）也不用', async () => {
    const 网址 = 'https://xsgzb.abc.edu.cn/2026/1001/c1a2/page.htm';
    const 链们 = Array.from({ length: 15 }, (_, i) => ({ url: `https://xsgzb.abc.edu.cn/info/${i}.htm`, text: `往届${文学}获奖作品展示之${i}` }));
    const 会话 = 假会话(q => (q.endsWith('2022') ? [条(网址, `第十三届${文学}`, { date: '2026-10-01' })] : []));
    const { 读网页 } = 假读网页({ [网址]: 页(`第十三届${文学}`, 链们.map(l => l.text).join('\n'), { links: 链们 }) });
    const 回 = await 跑2(文学库(), 'event-wx', 会话, 读网页);
    expect(回.条目们).toEqual([]);
    expect(回.过程.map(x => x.说明).join('\n')).toContain('像列表');
  });
});
