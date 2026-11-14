// 入库指定网址 · 找新一届的条目（2026-11-12 用户定）：发现新一届就入库发布；追不到官方通知的用高校转发发布，来源标“高校转发”（school_repost，不算官方）。
//   条目带 新届 { 年份, 届次 }：只建新一届（对上库里已有届次的不动），届次名称按比赛名加程序认出的年份、届次拼，不用抽取出来的名字；
//   条目带 来源类型 'school_repost'：来源写成高校转发、不标官方；学校名、“我校学生”不写进主办方、参赛对象（不拿上一届的顶上，主办方空着时显示比赛的）；
//     转发里只有学校自己的截止（“请于…前交学院”）的不当全国报名截止：报名时间留空，pending_announcement 为真（时间以官方通知为准）。
// 用假的 04（直接给抽取结果）和真的 06、内存里的真比赛库。
import { describe, expect, test } from 'vitest';
import { 入库指定网址, 默认模块们 } from '../../入库指定网址.mjs';
import { openDb } from '../../../../db/index.mjs';

const 静 = { info() {}, warn() {}, error() {}, child() { return this; } };
const now = new Date('2026-11-12T04:00:00.000Z');
const 转发 = 'https://jwc.abc.edu.cn/info/1001/2345.htm';
const 官方通知 = 'https://jsjds.blcu.edu.cn/info/2026.html';
const 上届主办 = '教育部高等学校计算机类专业教学指导委员会';

function 准备() {
  const db = openDb({ file: ':memory:', now: () => now });
  db.insert('competition', 'event-cz', { name: '中国大学生计算机设计大赛', level: '国家级', organizer: '教育部计算机类教指委' });
  db.insert('edition', 'edition-cz-2025', { competition_id: 'event-cz', ordinal: 1, edition_name: '2025年第十八届中国大学生计算机设计大赛', edition_year: '2025', edition_ordinal: '第十八届',
    status: '已归档', organizer: 上届主办, participants: '全国普通高校在校本科生' });
  db.insert('source', 'source-cz-2025-1', { edition_id: 'edition-cz-2025', url: 'https://jsjds.blcu.edu.cn/info/2025.html', source_type: 'organizer_notice', is_official: true, validity_status: 'valid' });
  return db;
}
const 字 = (value, quote = value) => ({ value, quote });
// 假的 04：按网址给抽取结果（字段带原文出处 quote）
const 假04 = 抽们 => ({ name: '04-extract', run: async input => ({
  items: input.items.map(i => ({ key: i.key, kind: i.kind, status: '进行中', data: { ...i.data, extraction: { fields: 抽们[i.key] || {} } } })), changes: [], problems: [] }) });
const 真06 = 默认模块们.find(m => m.name === '06-ingest');
const 跑 = (db, 条目们, 抽们, 改 = {}) => 入库指定网址(条目们, { 主库: db, 模块们: [假04(抽们), 真06], log: 静, now: () => now, 来源: '找新一届', 不审核: true, ...改 });
const 新届条 = (网址, 改 = {}) => ({ 网址, 标题: '关于组织参加第十九届中国大学生计算机设计大赛的通知', 比赛名: '中国大学生计算机设计大赛', 比赛编号: 'event-cz', 新届: { 年份: '2026', 届次: '第十九届' }, ...改 });
const 新届次 = db => db.find('edition', { competition_id: 'event-cz' }).find(e => e.id !== 'edition-cz-2025');

describe('高校转发（来源类型 school_repost）', () => {
  const 学校抽取 = {
    competition_name: 字('某某大学关于组织参加计算机设计大赛的通知'),
    organizer: 字('某某大学教务处'),
    participants: 字('我校全日制本科生'),
    format_and_rules: 字('作品分为软件应用与开发、微课与教学辅助等类别'),
    registration_end: 字('2026-12-01', '请于2026年12月1日前将报名表交至学院教学办'),
  };
  test('新建新一届并发布；来源是高校转发、不标官方；名字按比赛名和认出的届次拼；学校名不写进主办方，“我校学生”不写；学校截止不当报名截止', async () => {
    const db = 准备();
    const 回 = await 跑(db, [新届条(转发, { 来源类型: 'school_repost' })], { [转发]: 学校抽取 });
    expect(回.条目们[0]).toMatchObject({ 状态: '进行中', 入库类型: '新一届', 写进: true });
    const 届 = 新届次(db);
    expect(届).toMatchObject({
      status: '已发布', edition_name: '2026年第十九届中国大学生计算机设计大赛', edition_year: '2026', edition_ordinal: '第十九届', ordinal: 2,
      organizer: null, participants: null, registration_start: null, registration_end: null, pending_announcement: true, registration_url: null,
      format_and_rules: '作品分为软件应用与开发、微课与教学辅助等类别',
    });
    const 源们 = db.find('source', { edition_id: 届.id });
    expect(源们).toHaveLength(1);
    expect(源们[0]).toMatchObject({ url: 转发, source_type: 'school_repost', is_official: false, validity_status: 'valid' });
    expect(源们[0].review_reason).toContain('高校转发');
    expect(db.get('edition', 'edition-cz-2025').data.status).toBe('已归档');
  });
  test('转发里写明全国报名截止（不是交学院的）：照常用', async () => {
    const db = 准备();
    await 跑(db, [新届条(转发, { 来源类型: 'school_repost' })], { [转发]: { ...学校抽取, registration_end: 字('2027-03-31', '大赛报名截止时间为2027年3月31日') } });
    expect(新届次(db)).toMatchObject({ registration_end: '2027-03-31', pending_announcement: false });
  });
  test('报名网址是转发页同一网站的（没单独抽到时就是转发页）：不当报名入口；别的网站的照用', async () => {
    const db = 准备();
    await 跑(db, [新届条(转发, { 来源类型: 'school_repost' })], { [转发]: 学校抽取 });
    expect(新届次(db).registration_url).toBe(null);
    const db2 = 准备();
    const 假04报名 = { name: '04-extract', run: async input => ({ items: input.items.map(i => ({ key: i.key, kind: i.kind, status: '进行中',
      data: { ...i.data, registration_url: 'https://jsjds.blcu.edu.cn/reg', extraction: { fields: 学校抽取 } } })), changes: [], problems: [] }) };
    await 入库指定网址([新届条(转发, { 来源类型: 'school_repost' })], { 主库: db2, 模块们: [假04报名, 真06], log: 静, now: () => now, 来源: '找新一届', 不审核: true });
    expect(新届次(db2).registration_url).toBe('https://jsjds.blcu.edu.cn/reg');
  });
  test('主办方里有全国的单位也有学校：只去掉学校', async () => {
    const db = 准备();
    await 跑(db, [新届条(转发, { 来源类型: 'school_repost' })], { [转发]: { ...学校抽取, organizer: 字(`${上届主办}、某某大学`) } });
    expect(新届次(db).organizer).toBe(上届主办);
  });
  test('试跑：照常判断，不写库', async () => {
    const db = 准备();
    const 回 = await 跑(db, [新届条(转发, { 来源类型: 'school_repost' })], { [转发]: 学校抽取 }, { 试跑: true });
    expect(回.条目们[0]).toMatchObject({ 状态: '进行中', 入库类型: '新一届', 写进: false });
    expect(新届次(db)).toBeUndefined();
  });
});

describe('新届（找新一届的条目）', () => {
  test('官方通知：来源照旧是核验过的官方主办方通知，核对说明用条目给的', async () => {
    const db = 准备();
    const 回 = await 跑(db, [新届条(官方通知, { 核对说明: '找新一届：官方网站上的通知' })], { [官方通知]: { competition_name: 字('第十九届中国大学生计算机设计大赛'), registration_end: 字('2027-04-15', '报名截止：2027年4月15日') } });
    expect(回.条目们[0]).toMatchObject({ 入库类型: '新一届', 写进: true });
    const 届 = 新届次(db);
    expect(届).toMatchObject({ status: '已发布', registration_end: '2027-04-15', edition_ordinal: '第十九届' });
    expect(db.find('source', { edition_id: 届.id })[0]).toMatchObject({ url: 官方通知, source_type: 'organizer_notice', is_official: true, review_reason: '找新一届：官方网站上的通知' });
  });
  test('对上库里已有的届次：不动已有届次，丢弃', async () => {
    const db = 准备();
    const 回 = await 跑(db, [新届条(转发, { 来源类型: 'school_repost', 新届: { 年份: '2025', 届次: '第十八届' } })], { [转发]: {} });
    expect(回.条目们[0]).toMatchObject({ 状态: '已丢弃', 写进: false });
    expect(回.条目们[0].原因).toContain('已有');
    expect(db.find('source', { edition_id: 'edition-cz-2025' })).toHaveLength(1);
    expect(db.find('edition', { competition_id: 'event-cz' })).toHaveLength(1);
  });
  test('同一次两条指向同一新届：只建一次，第二条补来源', async () => {
    const db = 准备();
    const 第二 = 'https://jwc.def.edu.cn/2.htm';
    const 回 = await 跑(db, [新届条(转发, { 来源类型: 'school_repost' }), 新届条(第二, { 来源类型: 'school_repost' })], { [转发]: {}, [第二]: {} });
    expect(回.条目们.map(x => x.入库类型)).toEqual(['新一届', '补来源']);
    const 届 = 新届次(db);
    expect(db.find('edition', { competition_id: 'event-cz' })).toHaveLength(2);
    expect(db.find('source', { edition_id: 届.id }).map(s => s.url).sort()).toEqual([转发, 第二].sort());
  });
});
