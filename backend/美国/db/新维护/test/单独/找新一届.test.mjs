// 找新一届（2026-11-12 用户定）：已归档的比赛，用“比赛名 + 下一年/下一届”搜（after: 第一次从上一届结束、之后从上次找的前 3 天），
// 程序先筛（比赛名、届次比库里新、排除招新/承办/校赛/获奖类）→ DeepSeek 选择题（分批）→ 读通知、程序再核对 → 追官方原文
// （转发里指向官方网站的链接、外部链接判断是官网的、在已知官方域名下搜）→ 每个新届只交一条给入库工具（带比赛编号、新届、不审核）：
// 追到官方用官方通知，追不到用高校转发（来源类型 school_repost）。
// 用假的搜索、DeepSeek、读网页、入库，真的比赛库（内存）。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../test/复用/样例数据.mjs';
import { 找新一届 } from '../../找新一届/index.mjs';
import { 挑要找的 } from '../../找新一届/挑比赛.mjs';
import { 跑找新一届 } from '../../运行.mjs';

const 时刻 = new Date('2026-11-12T02:00:00.000Z');
const 官网 = 'https://jsjds.blcu.edu.cn/';
const 名 = '中国大学生计算机设计大赛';
const 转发 = 'https://jwc.abc.edu.cn/info/1001/2345.htm';
const 转发标题 = `关于组织参加第十九届${名}的通知`;

function 库({ 最新状态 = '已归档' } = {}) {
  const db = open(); seed(db);
  db.transaction(tx => {
    tx.insert('competition', 'event-cz', { name: 名, level: '国家级', website: 官网 });
    tx.insert('edition', 'edition-cz-2025', { competition_id: 'event-cz', ordinal: 1, edition_name: `2025年第十八届${名}`, edition_year: '2025', edition_ordinal: '第十八届',
      registration_start: '2025-03-01', registration_end: '2025-04-15', competition_end: '2025-08-20', status: 最新状态 });
    tx.insert('source', 'source-cz-2025-1', { edition_id: 'edition-cz-2025', url: `${官网}info/2025.html`, source_type: 'organizer_notice', is_official: true, validity_status: 'valid' });
  });
  return db;
}
const 条 = (url, title, 改 = {}) => ({ url, title, content: '', date: '2026-11-01', ...改 });
const 页 = (title, text, 改 = {}) => ({ status: '成功', title, text, finalUrl: '', error: '', links: [], ...改 });

// 假的 AI：search 按搜索词给结果（函数），chat 默认全选（记下每次交了几条）
function 假ai({ 搜 = () => [], 选 = 候选数 => Array.from({ length: 候选数 }, (_, i) => i + 1) } = {}) {
  const 调用 = { 搜索: [], 选择: [] };
  const 会话 = {
    search: async ({ purpose, query }) => { 调用.搜索.push({ purpose, query }); return { references: 搜(query) }; },
    chat: async ({ purpose, messages }) => {
      const 题 = messages[0].content;
      const 数 = (题.match(/^\d+\. /gm) || []).length;
      调用.选择.push({ purpose, 数, 题 });
      return { data: { 选: 选(数, 题), 理由: '' }, usage: { tokensIn: 100, tokensOut: 10 } };
    },
  };
  return { 调用, ai: { session: () => 会话 } };
}
function 假读网页(页们 = {}) {
  const 读过 = [];
  return { 读过, 读网页: async 网址 => { 读过.push(网址); return 页们[网址] ?? { status: '网络错误', title: '', text: '', error: '连接被拒绝' }; } };
}
// 假的入库工具：记下条目和选项；默认每条都新建了新一届
const 建了 = (x, 参数) => ({ 网址: x.网址, 状态: '进行中', 原因: '新一届，维护不审核，发布', 入库类型: '新一届', 改动: [], 写进: !参数.试跑 });
function 部件({ 入库结果 = 建了, 判 = {} } = {}) {
  const 调用 = { 入库: [], 判断官网: [] };
  return {
    调用,
    入库: async (网址们, 参数) => { 调用.入库.push({ 网址们, 参数 }); return { 条目们: 网址们.map(x => 入库结果(x, 参数)), 写入: { error: null } }; },
    判断官网: async 网址 => { 调用.判断官网.push(网址); return 判[网址] || { 是: false, 原因: '页面上没有比赛名' }; },
  };
}
const 选项 = (db, { ai, 读网页, 件, ...改 }) => ({ db, ai, 工具: { 读网页 }, 部件: 件, now: () => 时刻, ...改 });
const 后台记录 = db => db.find('audit_log', { action: '找新一届' });

describe('找新一届', () => {
  test('只追到高校转发：用转发发布（来源类型 school_repost），带比赛编号、新届、不审核、不改已有；程序筛掉招新、获奖、旧届、名字不对的；记后台记录', async () => {
    const db = 库();
    const 结果们 = [
      条(转发, 转发标题),
      条('https://x.com/a', `${名}协会招新`),
      条('https://y.edu.cn/b', `第十八届${名}获奖名单公示`),
      条('https://z.edu.cn/c', '关于组织参加第十九届中国大学生程序设计竞赛的通知'),
      条('https://w.edu.cn/d', `关于举办第十七届${名}的通知`),
    ];
    const { ai, 调用 } = 假ai({ 搜: q => (q.startsWith('site:') ? [] : 结果们) });
    const { 读网页 } = 假读网页({ [转发]: 页(转发标题, `各学院：第十九届${名}现已启动，请于2026年12月1日前报送学院。`) });
    const 件 = 部件();
    const 回 = await 找新一届('event-cz', 选项(db, { ai, 读网页, 件 }));

    // 搜索：比赛名 + 下一年 / 下一届，after: 上一届比赛结束
    expect(调用.搜索.filter(x => !x.query.startsWith('site:')).map(x => x.query)).toEqual([`${名} 2026 after:2025-08-20`, `${名} 第十九届 after:2025-08-20`]);
    expect(调用.搜索.every(x => x.purpose === 'new_edition_search')).toBe(true);
    // 招新、获奖、旧届、名字不对的程序先筛掉，不交给 DeepSeek
    expect(调用.选择).toHaveLength(1);
    expect(调用.选择[0]).toMatchObject({ purpose: 'new_edition_pick', 数: 1 });
    expect(件.调用.入库).toHaveLength(1);
    expect(件.调用.入库[0].网址们).toEqual([{ 网址: 转发, 标题: 转发标题, 比赛名: 名, 比赛编号: 'event-cz', 新届: { 年份: null, 届次: '第十九届' },
      来源类型: 'school_repost', 核对说明: expect.stringContaining('高校转发') }]);
    expect(件.调用.入库[0].参数).toMatchObject({ 主库: db, 来源: '找新一届', 试跑: false, 更新已有: false, 不审核: true });
    expect(回).toMatchObject({ 比赛: 'event-cz', 成功: true, 摘要: '入库 1 条' });
    expect(回.线索).toEqual([expect.objectContaining({ 网址: 转发, 类: '高校转发' })]);
    const 记 = 后台记录(db);
    expect(记).toHaveLength(1);
    expect(记[0]).toMatchObject({ record_id: 'event-cz', detail: { 成功: true, 摘要: '入库 1 条' } });
  });

  test('转发里有指向官方网站的链接，官方页面核对过：用官方通知（不带来源类型），官方页面认出的年份也带上', async () => {
    const db = 库();
    const 官方通知 = `${官网}info/2026.html`;
    const { ai } = 假ai({ 搜: q => (q.startsWith('site:') ? [] : [条(转发, 转发标题)]) });
    const { 读网页 } = 假读网页({
      [转发]: 页(转发标题, `第十九届${名}通知，详见大赛官网。`, { links: [{ url: 'https://beian.miit.gov.cn/', text: '备案' }, { url: 官方通知, text: '大赛官网通知' }] }),
      [官方通知]: 页(`关于举办2026年（第十九届）${名}的通知`, `2026年（第十九届）${名}定于……`),
    });
    const 件 = 部件();
    const 回 = await 找新一届('event-cz', 选项(db, { ai, 读网页, 件 }));
    expect(件.调用.入库[0].网址们).toEqual([expect.objectContaining({ 网址: 官方通知, 新届: { 年份: '2026', 届次: '第十九届' }, 核对说明: expect.stringContaining('官方') })]);
    expect(件.调用.入库[0].网址们[0].来源类型).toBeUndefined();
    expect(回.线索[0]).toMatchObject({ 类: '高校转发', 官方: 官方通知 });
  });

  test('转发里没有官方链接：在已知官方域名下搜“比赛名 届次”，找到核对过的就用官方通知', async () => {
    const db = 库();
    const 官方通知 = `${官网}info/2026b.html`;
    const { ai, 调用 } = 假ai({ 搜: q => (q.startsWith('site:') ? [条(官方通知, `关于举办第十九届${名}的通知`)] : [条(转发, 转发标题)]) });
    const { 读网页 } = 假读网页({ [转发]: 页(转发标题, `第十九届${名}`), [官方通知]: 页(`关于举办第十九届${名}的通知`, '报名截止……') });
    const 件 = 部件();
    await 找新一届('event-cz', 选项(db, { ai, 读网页, 件 }));
    expect(调用.搜索.find(x => x.query.startsWith('site:')).query).toBe(`site:jsjds.blcu.edu.cn ${名} 第十九届 after:2025-08-20`);
    expect(件.调用.入库[0].网址们[0]).toMatchObject({ 网址: 官方通知 });
    expect(件.调用.入库[0].网址们[0].来源类型).toBeUndefined();
  });

  test('转发里链到外部网站：页面核对过、判断官网说首页是官网，也算官方', async () => {
    const db = 库();
    const 外部 = 'https://www.newsite.cn/n/1.html';
    const { ai } = 假ai({ 搜: q => (q.startsWith('site:') ? [] : [条(转发, 转发标题)]) });
    const { 读网页 } = 假读网页({ [转发]: 页(转发标题, `第十九届${名}`, { links: [{ url: 外部, text: '大赛通知' }] }), [外部]: 页(`第十九届${名}通知`, '……') });
    const 件 = 部件({ 判: { 'https://www.newsite.cn/': { 是: true, 原因: '页面上有比赛名' } } });
    await 找新一届('event-cz', 选项(db, { ai, 读网页, 件 }));
    expect(件.调用.判断官网).toEqual(['https://www.newsite.cn/']);
    expect(件.调用.入库[0].网址们[0]).toMatchObject({ 网址: 外部 });
    expect(件.调用.入库[0].网址们[0].来源类型).toBeUndefined();
  });

  test('搜索标题带比赛名，但读到的页面上没有这个比赛的名字：不建', async () => {
    const db = 库();
    const { ai } = 假ai({ 搜: () => [条(转发, 转发标题)] });
    const { 读网页 } = 假读网页({ [转发]: 页('关于组织参加第十九届中国大学生程序设计竞赛的通知', '程序设计竞赛……') });
    const 件 = 部件();
    const 回 = await 找新一届('event-cz', 选项(db, { ai, 读网页, 件 }));
    expect(件.调用.入库).toHaveLength(0);
    expect(回).toMatchObject({ 成功: true, 摘要: '没发现新一届' });
  });

  test('标题认不出届次：读页面，从页面标题或正文里紧挨着比赛名的届次认；页面是旧届的不建', async () => {
    const db = 库();
    const 甲 = 'https://jwc.a.edu.cn/1.htm', 乙 = 'https://jwc.b.edu.cn/2.htm';
    const { ai } = 假ai({ 搜: q => (q.startsWith('site:') ? [] : [条(甲, `关于组织参加${名}的通知`), 条(乙, `关于组织参加${名}的通知`, { date: '2026-10-01' })]) });
    const { 读网页 } = 假读网页({ [甲]: 页(`关于组织参加${名}的通知`, `现将第十九届${名}有关事项通知如下`), [乙]: 页(`关于组织参加${名}的通知`, `第十八届${名}决赛安排`) });
    const 件 = 部件();
    await 找新一届('event-cz', 选项(db, { ai, 读网页, 件 }));
    expect(件.调用.入库[0].网址们.map(x => x.网址)).toEqual([甲]);
  });

  test('同一次多条线索指向同一新届（第十九届、第19届、2026年第十九届）：只交一条（新的、带年份的优先），只建一次', async () => {
    const db = 库();
    const 甲 = 'https://jwc.a.edu.cn/1.htm', 乙 = 'https://jwc.b.edu.cn/2.htm', 丙 = 'https://jwc.c.edu.cn/3.htm';
    const { ai } = 假ai({ 搜: q => (q.startsWith('site:') ? [] : [
      条(甲, `关于组织参加第十九届${名}的通知`, { date: '2026-10-01' }),
      条(乙, `关于组织参加第19届${名}的通知`, { date: '2026-10-20' }),
      条(丙, `关于组织参加2026年第十九届${名}的通知`, { date: '2026-10-10' }),
    ]) });
    const { 读网页 } = 假读网页({ [甲]: 页('甲', `第十九届${名}`), [乙]: 页('乙', `第19届${名}`), [丙]: 页('丙', `2026年第十九届${名}`) });
    const 件 = 部件();
    const 回 = await 找新一届('event-cz', 选项(db, { ai, 读网页, 件 }));
    expect(件.调用.入库[0].网址们).toHaveLength(1);
    expect(件.调用.入库[0].网址们[0]).toMatchObject({ 网址: 丙, 新届: { 年份: '2026', 届次: '第十九届' } });
    expect(回.线索).toHaveLength(3);
  });

  // 2026-11-13 用户定（和高校转发补救同一套规矩，核对.mjs）：转发页要够新、只建最新的一届、来源必须是通知详情页
  test('同一次找到第十九届、第二十届：只建最新的第二十届（一次最多一届）', async () => {
    const db = 库();
    const 甲 = 'https://jwc.a.edu.cn/info/1/1.htm', 乙 = 'https://jwc.b.edu.cn/info/2/2.htm';
    const { ai } = 假ai({ 搜: q => (q.startsWith('site:') ? [] : [
      条(甲, `关于组织参加第十九届${名}的通知`, { date: '2026-10-01' }),
      条(乙, `关于组织参加第二十届${名}的通知`, { date: '2026-10-20' }),
    ]) });
    const { 读网页 } = 假读网页({ [甲]: 页('甲', `第十九届${名}`), [乙]: 页('乙', `第二十届${名}`) });
    const 件 = 部件();
    const 回 = await 找新一届('event-cz', 选项(db, { ai, 读网页, 件 }));
    expect(件.调用.入库[0].网址们).toEqual([expect.objectContaining({ 网址: 乙, 新届: { 年份: null, 届次: '第二十届' } })]);
    expect(回.过程.map(x => x.说明).join('\n')).toContain('只建最新的第二十届');
  });

  test('转发页太旧（网址、正文里的发布日期不晚于上一届结束或超过 12 个月）、来源是列表页：都不用', async () => {
    const db = 库();
    const 旧 = 'https://xgc.ntu.edu.cn/2024/1012/c2608a251445/page.psp';
    const 列表 = 'https://xsgzb.ecnu.edu.cn/p40114c8089/list6.htm';
    const 正文旧 = 'https://jwc.c.edu.cn/info/3/3.htm';
    const { ai, 调用 } = 假ai({ 搜: q => (q.startsWith('site:') ? [] : [
      条(旧, `关于组织参加第十九届${名}的通知`, { date: '' }),
      条(列表, `第十九届${名}`),
      条(正文旧, `关于组织参加第十九届${名}的通知`, { date: '' }),
    ]) });
    const { 读过, 读网页 } = 假读网页({ [正文旧]: 页(`关于组织参加第十九届${名}的通知`, `发布时间：2025-06-01\n第十九届${名}`) });
    const 件 = 部件();
    const 回 = await 找新一届('event-cz', 选项(db, { ai, 读网页, 件 }));
    expect(读过).toEqual([正文旧]);
    expect(件.调用.入库).toHaveLength(0);
    expect(回.摘要).toBe('没发现新一届');
    const 说明 = 回.过程.map(x => x.说明).join('\n');
    expect(说明).toContain('转发页太旧：2024-10-12');
    expect(说明).toContain('列表页');
    expect(说明).toContain('转发页太旧：2025-06-01');
    expect(调用.选择[0].数).toBe(1);
  });

  test('候选多时 DeepSeek 选择题分批（每批最多 10 条），没选上的不读', async () => {
    const db = 库();
    const 结果们 = Array.from({ length: 12 }, (_, i) => 条(`https://jwc.s${i}.edu.cn/1.htm`, `关于组织参加第十九届${名}的通知（${i}）`));
    const { ai, 调用 } = 假ai({ 搜: q => (q.startsWith('site:') ? [] : 结果们), 选: () => [] });
    const { 读网页, 读过 } = 假读网页();
    const 件 = 部件();
    const 回 = await 找新一届('event-cz', 选项(db, { ai, 读网页, 件 }));
    expect(调用.选择.map(x => x.数)).toEqual([10, 2]);
    expect(读过).toEqual([]);
    expect(回.摘要).toBe('没发现新一届');
  });

  test('之后每周：after: 从上次找新一届（后台记录）的前 3 天开始', async () => {
    const db = 库();
    db.insert('audit_log', 'x1', { created_at: '2026-11-05T02:00:00.000Z', action: '找新一届', table_name: 'competition', record_id: 'event-cz', detail: {} });
    const { ai, 调用 } = 假ai();
    await 找新一届('event-cz', 选项(db, { ai, ...假读网页(), 件: 部件() }));
    expect(调用.搜索[0].query).toBe(`${名} 2026 after:2026-11-02`);
  });

  test('试跑：照常搜、读、交入库（入库按试跑），不写后台记录；摘要“拟新增 N 届”', async () => {
    const db = 库();
    const { ai } = 假ai({ 搜: q => (q.startsWith('site:') ? [] : [条(转发, 转发标题)]) });
    const { 读网页 } = 假读网页({ [转发]: 页(转发标题, `第十九届${名}`) });
    const 件 = 部件();
    const 回 = await 找新一届('event-cz', 选项(db, { ai, 读网页, 件, 试跑: true }));
    expect(件.调用.入库[0].参数.试跑).toBe(true);
    expect(回).toMatchObject({ 成功: true, 摘要: '拟新增 1 届' });
    expect(后台记录(db)).toHaveLength(0);
  });

  test('最新一届没归档：不找', async () => {
    const db = 库({ 最新状态: '已发布' });
    const { ai, 调用 } = 假ai();
    const 回 = await 找新一届('event-cz', 选项(db, { ai, ...假读网页(), 件: 部件() }));
    expect(调用.搜索).toHaveLength(0);
    expect(回).toMatchObject({ 成功: true, 摘要: '不用找' });
  });

  test('额度类错误：记失败“出错”后往外抛（让运行入口停批）', async () => {
    const db = 库();
    const ai = { session: () => ({ search: async () => { throw Object.assign(new Error('DeepSeek 额度用完'), { kind: '额度用完' }); }, chat: async () => ({}) }) };
    await expect(找新一届('event-cz', 选项(db, { ai, ...假读网页(), 件: 部件() }))).rejects.toMatchObject({ kind: '额度用完' });
    expect(后台记录(db)[0].detail).toMatchObject({ 成功: false, 摘要: '出错' });
  });
});

describe('挑要找的', () => {
  const 加 = (db, id, 届, 改 = {}) => db.transaction(tx => {
    tx.insert('competition', id, { name: `比赛${id}`, level: '国家级' });
    tx.insert('edition', `${id}-e`, { competition_id: id, ordinal: 1, edition_name: `比赛${id}`, status: '已归档', ...届 });
  });
  test('最新一届已归档、预计报名时间已过或 60 天内；上次找过的隔 7 天再找；预计时间离今天近的先；有上限', () => {
    const db = open(); seed(db);   // 样例里的都没归档
    加(db, 'c-near', { registration_start: '2025-11-20' });   // 预计 2026-11-20，8 天后
    加(db, 'c-past', { registration_start: '2025-09-01' });   // 预计 2026-09-01，过了 2 个多月
    加(db, 'c-far', { registration_start: '2026-03-01' });    // 预计 2027-03-01，窗口外
    加(db, 'c-checked', { registration_start: '2025-10-01' });
    加(db, 'c-old-check', { registration_start: '2025-10-01' });
    db.insert('audit_log', 'a1', { created_at: '2026-11-09T00:00:00.000Z', action: '找新一届', record_id: 'c-checked', detail: {} });
    db.insert('audit_log', 'a2', { created_at: '2026-11-01T00:00:00.000Z', action: '找新一届', record_id: 'c-old-check', detail: {} });
    const 挑 = 挑要找的(db, { now: 时刻 });
    expect(挑.map(x => x.比赛)).toEqual(['c-near', 'c-old-check', 'c-past']);
    expect(挑[1]).toMatchObject({ 上次找: '2026-11-01T00:00:00.000Z' });
    expect(挑要找的(db, { now: 时刻, 上限: 1 }).map(x => x.比赛)).toEqual(['c-near']);
  });
  test('没有任何日期的已归档比赛排在最后', () => {
    const db = open();
    加(db, 'c-none', { edition_year: '2024' });
    加(db, 'c-past', { registration_start: '2025-09-01' });
    expect(挑要找的(db, { now: 时刻 }).map(x => x.比赛)).toEqual(['c-past', 'c-none']);
  });
});

describe('跑找新一届（运行入口 --找新一届）', () => {
  test('没给比赛就按 挑要找的 挑，逐个找；挑不到就什么都不做', async () => {
    const db = open();
    const 找过 = [];
    const 找 = async id => { 找过.push(id); return { 比赛: id, 成功: true, 摘要: '没发现新一届', 结果: '没发现新一届' }; };
    expect(await 跑找新一届({ db, now: () => 时刻, 找 })).toEqual([]);
    db.transaction(tx => {
      tx.insert('competition', 'c1', { name: '比赛一', level: '国家级' });
      tx.insert('edition', 'c1-e', { competition_id: 'c1', ordinal: 1, edition_name: '比赛一', status: '已归档', registration_start: '2025-10-01' });
    });
    const 回 = await 跑找新一届({ db, now: () => 时刻, 找 });
    expect(找过).toEqual(['c1']);
    expect(回).toEqual([expect.objectContaining({ 比赛: 'c1', 摘要: '没发现新一届' })]);
  });
  test('额度类错误停批：还没开始的不再开始', async () => {
    const db = open();
    const 找过 = [];
    const 找 = async id => { 找过.push(id); throw Object.assign(new Error('额度用完'), { kind: '额度用完' }); };
    const 回 = await 跑找新一届({ db, 比赛们: ['a', 'b', 'c'], 并发: 1, now: () => 时刻, 找 });
    expect(找过).toEqual(['a']);
    expect(回).toEqual([expect.objectContaining({ 比赛: 'a', 结果: '出错' })]);
  });
});
