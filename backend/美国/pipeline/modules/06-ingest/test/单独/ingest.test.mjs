// 06 入库：入库总管把 05 审核通过的候选对照主库、整理成比赛、届次、来源，过发布门槛，放进小数据库的待写入；
// 写入主库() 给总控在最后调用，把待写入的用主库的事务写进去。没有验收，写进去就是发布（2026-11-01 用户定）。
// 用内存里的真实比赛库（美国/db，带字段校验）和真实的小数据库，不连网、不调 AI。
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { openDb } from '../../../../../db/index.mjs';
import { openRunDb } from '../../../../小数据库/index.mjs';
import { tempRoot } from '../../../../test/复用/假模块.mjs';
import { fakeCtx } from '../../../../test/复用/假ctx.mjs';
import * as ingest from '../../index.mjs';
import { 对照主库 } from '../../对照主库/index.mjs';
import { 整理字段, 拆名称, 已截止, 比赛编号, 届次数, 比对届次 } from '../../整理字段/index.mjs';
import { 写入主库 } from '../../写入主库/index.mjs';
import { 有核验过的官方来源 } from '../../../../../程序审核/发布门槛/index.mjs';

const now = new Date('2026-11-01T04:00:00.000Z');
const 主库 = () => openDb({ file: ':memory:', now: () => now });
const 来源 = (url = 'https://xh.org.cn/n/1') => ({ url, final_url: url, source_type: 'organizer_notice', is_official: true, validity_status: 'valid', title: '通知', content_summary: '一致',
  evidence_excerpt: '由中国某某学会主办', review_reason: 'AI 三项核验通过：一致', supports_fields: ['name', 'registration_end'], last_verified_at: now.toISOString() });
const 记录 = (name, over = {}) => ({ name, organizer: '中国某某学会', participants: '全国普通高校在校本科生', eligibility: '', format_and_rules: '提交作品，专家评审', team_size: '',
  registration_method: '', registration_organization: '', fees: '', registration_start: '2026-11-01', registration_end: '2026-12-01', pending_announcement: false,
  registration_url: 'https://reg.xh.org.cn', professions: ['设计与艺术'], reward_highlights: ['实习或直通面试', '乱写的'], sources: [{ url: 'https://xh.org.cn/n/1' }], ...over });
const 审过 = (key, r, 来源们 = [来源()]) => ({ key, kind: 'candidate', status: '进行中', stage: '05-review', data: { name: r.name, url: key, 渠道们: ['baidu'], 搜索词们: ['某某'], 路线们: ['细分专业'], review: { 结果: '通过', 档: '直接收', 记录: r, 来源们 } } });
// 主库的读接口给 ctx（和总控给模块的一样：list 交回 { key, version, data }）
const ctx装主库 = db => { const ctx = fakeCtx({ now: now.toISOString(), list: t => db.list(t), view: (t, k) => db.get(t, k) }); return ctx; };

describe('整理字段', () => {
  test('名称里的年份、第几届拆出来，原文留在届次名称', () => {
    expect(拆名称('2026年第十届全国大学生某某竞赛')).toEqual({ 名称: '全国大学生某某竞赛', 年份: '2026', 届次: '第十届' });
    expect(拆名称('全国大学生某某竞赛（2025-2026）')).toEqual({ 名称: '全国大学生某某竞赛', 年份: '2025—2026', 届次: null });
    expect(拆名称('全国大学生某某竞赛')).toEqual({ 名称: '全国大学生某某竞赛', 年份: null, 届次: null });
  });
  test('比赛编号是 event- 加规范名称算出的 8 位短码：同名同号', () => {
    expect(比赛编号('全国大学生某某竞赛')).toMatch(/^event-[0-9a-f]{8}$/);
    expect(比赛编号('“全国大学生某某竞赛”')).toBe(比赛编号('全国大学生某某竞赛'));
  });
  test('新比赛：比赛、届次、来源按比赛库的字段填；级别填“其他/未明确”；空的填 null；回报只留比赛库认的', () => {
    const d = 整理字段({ 记录: 记录('2026年第十届全国大学生某某竞赛'), 来源们: [来源()], 对照: { kind: '新比赛' }, 发现: { 网址: 'https://xh.org.cn/n/1', 渠道们: ['baidu'] } });
    const 码 = 比赛编号('全国大学生某某竞赛').slice('event-'.length);
    expect(d.competition).toEqual({ id: `event-${码}`, data: { name: '全国大学生某某竞赛', level: '其他/未明确', organizer: '中国某某学会', professions: ['设计与艺术'] } });
    expect(d.edition.id).toBe(`edition-${码}-2026`);
    expect(d.edition.data).toMatchObject({ competition_id: `event-${码}`, ordinal: 1, edition_name: '2026年第十届全国大学生某某竞赛', edition_year: '2026', edition_ordinal: '第十届',
      organizer: '中国某某学会', eligibility: null, team_size: null, registration_url: 'https://reg.xh.org.cn', registration_start: '2026-11-01', registration_end: '2026-12-01',
      pending_announcement: false, reward_highlights: ['实习或直通面试'], discovery: { 网址: 'https://xh.org.cn/n/1', 渠道们: ['baidu'] } });
    expect(d.sources).toEqual([{ id: `source-${码}-2026-1`, data: { edition_id: `edition-${码}-2026`, ...来源() } }]);
  });
  test('已有比赛的新一届：挂在已有比赛下，顺序接着排；补来源：来源编号接着已有的排', () => {
    const 新一届 = 整理字段({ 记录: 记录('2027年全国大学生某某竞赛'), 来源们: [来源()], 对照: { kind: '新一届', competitionId: 'event-cmp009', 下一个顺序: 3 } });
    expect(新一届.competition).toBeNull();
    expect(新一届.edition).toMatchObject({ id: 'edition-cmp009-2027', data: { competition_id: 'event-cmp009', ordinal: 3 } });
    const 补 = 整理字段({ 记录: 记录('全国大学生某某竞赛'), 来源们: [来源('https://b.cn')], 对照: { kind: '补来源', competitionId: 'event-cmp009', editionId: 'edition-cmp009-2026', 已有来源数: 2 } });
    expect(补.sources.map(s => s.id)).toEqual(['source-cmp009-2026-3']);
    expect(补.edition).toBeNull();
  });
  test('没有年份时编号用顺序；报名截止按北京时间这一天结束算，过了就是已截止', () => {
    const d = 整理字段({ 记录: 记录('全国大学生某某竞赛'), 来源们: [来源()], 对照: { kind: '新比赛' } });
    expect(d.edition.id).toMatch(/-n1$/);
    expect(已截止({ registration_end: '2026-11-01' }, now)).toBe(false);
    expect(已截止({ registration_end: '2026-10-31' }, now)).toBe(true);
    expect(已截止({ registration_end: '2026-11-01T20:00:00+08:00' }, now)).toBe(false);
    expect(已截止({ registration_end: '2026-11-01T10:00:00+08:00' }, now)).toBe(true);
    expect(已截止({ registration_end: null }, now)).toBe(false);
  });
});

describe('对照主库', () => {
  const 有一个比赛 = () => {
    const db = 主库();
    db.insert('competition', 'event-cmp009', { name: '全国大学生某某竞赛', aliases: ['某某赛'], level: '国家级' });
    db.insert('edition', 'edition-cmp009-2025', { competition_id: 'event-cmp009', ordinal: 1, edition_name: '2025年全国大学生某某竞赛', edition_year: '2025', status: '已发布' });
    db.insert('edition', 'edition-cmp009-2026', { competition_id: 'event-cmp009', ordinal: 2, edition_name: '2026年全国大学生某某竞赛', edition_year: '2026', status: '已发布' });
    db.insert('source', 'source-cmp009-2026-1', { edition_id: 'edition-cmp009-2026', url: 'https://xh.org.cn/n/1', source_type: 'organizer_notice' });
    return db;
  };
  test('库里没有：新比赛；同一晚前面一条已决定新建：新一届，挂在那个新比赛下', async () => {
    const ctx = ctx装主库(主库());
    expect(await 对照主库(记录('全国大学生另一竞赛'), ctx, new Map())).toEqual({ kind: '新比赛' });
    const planned = new Map([[比赛编号('全国大学生另一竞赛'), { 下一个顺序: 2 }]]);
    expect(await 对照主库(记录('2027年全国大学生另一竞赛'), ctx, planned)).toEqual({ kind: '新一届', competitionId: 比赛编号('全国大学生另一竞赛'), 下一个顺序: 2, supersedes: [] });
  });
  test('名称或别名（规范化后）一样的是已有比赛：没有这一届就是新一届，比它早、还没归档的届次一起归档', async () => {
    const ctx = ctx装主库(有一个比赛());
    expect(await 对照主库(记录('2027年第三届某某赛'), ctx, new Map())).toEqual({ kind: '新一届', competitionId: 'event-cmp009', 下一个顺序: 3, supersedes: ['edition-cmp009-2025', 'edition-cmp009-2026'] });
  });
  test('待人工审核的旧届次不跟着归档：归档会公开，没审过的不能这样出去（2026-11-04）', async () => {
    const db = 主库();
    db.insert('competition', 'event-p', { name: '全国大学生待审竞赛', level: '国家级' });
    db.insert('edition', 'edition-p-2025', { competition_id: 'event-p', ordinal: 1, edition_name: '2025年全国大学生待审竞赛', edition_year: '2025', status: '待人工审核', status_reason: ['名录导入'] });
    db.insert('edition', 'edition-p-2026', { competition_id: 'event-p', ordinal: 2, edition_name: '2026年全国大学生待审竞赛', edition_year: '2026', status: '已发布' });
    expect(await 对照主库(记录('2027年全国大学生待审竞赛'), ctx装主库(db), new Map())).toEqual({ kind: '新一届', competitionId: 'event-p', 下一个顺序: 3, supersedes: ['edition-p-2026'] });
  });
  test('已有这一届：有新来源就补来源；来源都有了就是已处理过', async () => {
    const ctx = ctx装主库(有一个比赛());
    expect(await 对照主库({ ...记录('2026年全国大学生某某竞赛') }, ctx, new Map(), { 来源们: [来源('https://new.cn')] }))
      .toEqual({ kind: '补来源', competitionId: 'event-cmp009', editionId: 'edition-cmp009-2026', 已有来源数: 1, 新来源们: [来源('https://new.cn')] });
    expect(await 对照主库(记录('2026年全国大学生某某竞赛'), ctx, new Map(), { 来源们: [来源()] }))
      .toMatchObject({ kind: '已处理过', reason: '库里已有这一届（edition-cmp009-2026），来源也都有了' });
  });
});

describe('入库总管（流程里这一步）', () => {
  test('新比赛：比赛、届次、来源三条放进待写入，挂在这条候选下；届次直接是已发布', async () => {
    const ctx = ctx装主库(主库());
    const out = await ingest.run({ runId: '2026-11-01', items: [审过('https://xh.org.cn/n/1', 记录('2026年全国大学生某某竞赛'))] }, ctx);
    expect(out.changes.map(c => `${c.op} ${c.table}`)).toEqual(['insert competition', 'insert edition', 'insert source']);
    expect(out.changes.every(c => c.itemKey === 'https://xh.org.cn/n/1')).toBe(true);
    expect(out.changes[1].payload).toMatchObject({ status: '已发布', status_at: now.toISOString(), status_reason: null });
    expect(out.items[0]).toMatchObject({ status: '进行中', result: '新比赛', reason: '新比赛，审核通过，发布' });
  });
  test('发现时已截止的：过了发布门槛（归档那几项）就是已归档', async () => {
    const out = await ingest.run({ items: [审过('https://a.cn', 记录('全国大学生某某竞赛', { registration_end: '2026-10-01', registration_url: null }))] }, ctx装主库(主库()));
    expect(out.changes.find(c => c.table === 'edition').payload.status).toBe('已归档');
  });
  test('发布门槛没过：不放进待写入，标已丢弃写明“06 入库·发布门槛”', async () => {
    const 没核过 = [{ ...来源('https://a.cn'), validity_status: 'unchecked' }];
    const out = await ingest.run({ items: [审过('https://a.cn', 记录('全国大学生某某竞赛', { registration_url: null }), 没核过)] }, ctx装主库(主库()));
    expect(out.changes).toEqual([]);
    expect(out.items[0]).toMatchObject({ status: '已丢弃', reason: expect.stringMatching(/^06 入库·发布门槛：.*报名网址.*官方来源/) });
  });
  test('缺报名网址、有核验过的官方来源：照样发布，报名网址用这条官方通知页顶上（2026-11-12 用户定）', async () => {
    const out = await ingest.run({ items: [审过('https://a.cn', 记录('全国大学生某某竞赛', { registration_url: null }), [来源('https://xh.org.cn/n/9')])] }, ctx装主库(主库()));
    expect(out.changes.find(c => c.table === 'edition').payload).toMatchObject({ status: '已发布', registration_url: 'https://xh.org.cn/n/9' });
  });
  test('同一晚两条是同一个新比赛的不同届：第二条不再新建比赛；没审核通过、已入库过的不处理', async () => {
    const out = await ingest.run({ items: [审过('https://a.cn', 记录('2026年全国大学生某某竞赛')), 审过('https://b.cn', 记录('2027年全国大学生某某竞赛'), [来源('https://b.cn')]),
      { key: 'x', kind: 'candidate', status: '进行中', data: { name: 'x' } }] }, ctx装主库(主库()));
    expect(out.changes.filter(c => c.table === 'competition')).toHaveLength(1);
    expect(out.items.map(i => i.result)).toEqual(['新比赛', '新一届']);
    expect(out.changes.filter(c => c.table === 'edition').map(c => c.payload.ordinal)).toEqual([1, 2]);
  });
});

describe('写入主库（给总控调）', () => {
  // 跑一遍 06，再把结果写进小数据库，模拟总控
  async function 跑06(db, items) {
    const rundb = openRunDb(path.join(tempRoot(), 'run.db'), { runId: '2026-11-01' });
    rundb.写入结果('05-review', { items, changes: [], problems: [] });
    const out = await ingest.run({ runId: '2026-11-01', items: rundb.查找() }, ctx装主库(db));
    rundb.写入结果('06-ingest', out);
    return rundb;
  }
  const log = { info() {}, warn() {}, error() {} };

  test('把待写入的用主库的事务写进去，过得了比赛库的字段校验；每条结果写回小数据库', async () => {
    const db = 主库();
    const rundb = await 跑06(db, [审过('https://xh.org.cn/n/1', 记录('2026年全国大学生某某竞赛'))]);
    const r = 写入主库({ 小数据库: rundb, 主库: db, log });
    expect(r).toMatchObject({ total: 3, written: 3, conflicts: 0, rejected: 0, error: null });
    const 码 = 比赛编号('全国大学生某某竞赛').slice(6);
    expect(db.get('edition', `edition-${码}-2026`).data).toMatchObject({ status: '已发布', participation_format: '暂未明确', fee_type: '暂未公布' });
    expect(db.get('competition', `event-${码}`).data.professions).toEqual(['设计与艺术']);
    expect(rundb.changes().map(c => c.result)).toEqual(['已写入', '已写入', '已写入']);
  });
  test('一条候选的改动有一项过不了字段校验：这条候选的改动全都不写，候选标已丢弃写明原因；别的照写', async () => {
    const db = 主库();
    const rundb = await 跑06(db, [审过('https://a.cn', 记录('全国大学生甲竞赛')), 审过('https://b.cn', 记录('全国大学生乙竞赛'))]);
    // 模拟第二条的届次过不了校验（比如有人把字段改坏）
    const 坏 = rundb.changes().find(c => c.tbl === 'edition' && c.item_key === 'https://b.cn');
    rundb.db.prepare('UPDATE changes SET payload = ? WHERE id = ?').run(JSON.stringify({ ...坏.payload, ordinal: '第一' }), 坏.id);
    const r = 写入主库({ 小数据库: rundb, 主库: db, log });
    expect(r).toMatchObject({ written: 3, rejected: 3 });
    expect(db.list('competition').map(x => x.data.name)).toEqual(['全国大学生甲竞赛']);
    expect(rundb.item('https://b.cn')).toMatchObject({ status: '已丢弃' });
    expect(rundb.trailOf('https://b.cn').at(-1).reason).toMatch(/^06 入库·写入主库：字段不合格：.*ordinal/);
  });
  test('拒过的网址不看条目状态（本来就是丢弃的条目才记）；别的改动所属条目已丢弃就不写', async () => {
    const db = 主库();
    const rundb = openRunDb(path.join(tempRoot(), 'run.db'), { runId: '2026-11-01' });
    rundb.写入结果('03-filter', { items: [{ key: 'https://w.cn', kind: 'candidate', status: '已丢弃', data: {}, reason: '不是比赛' }], problems: [], changes: [
      { table: 'rejected_url', key: '2026-11-01:w.cn', op: 'insert', itemKey: 'https://w.cn', payload: { url: 'https://w.cn', url_key: 'w.cn', reason: '不是比赛', module: '03-filter', rejected_at: now.toISOString() } },
      { table: 'competition', key: 'event-x', op: 'insert', itemKey: 'https://w.cn', payload: { name: 'x', level: '国家级' } },
    ] });
    const r = 写入主库({ 小数据库: rundb, 主库: db, log });
    expect(r).toMatchObject({ written: 1, rejected: 1 });
    expect(db.get('rejected_url', '2026-11-01:w.cn')).not.toBeNull();
    expect(db.get('competition', 'event-x')).toBeNull();
  });
  test('试跑：一条都不写，交回可以写多少条', async () => {
    const db = 主库();
    const rundb = await 跑06(db, [审过('https://a.cn', 记录('全国大学生甲竞赛'))]);
    expect(写入主库({ 小数据库: rundb, 主库: db, log, 试跑: true })).toMatchObject({ wouldWrite: 3, written: 0 });
    expect(db.count('competition')).toBe(0);
  });
  test('流程开始后有人改过的行：版本对不上就跳过，不覆盖', async () => {
    const db = 主库();
    db.insert('competition', 'event-cmp009', { name: '全国大学生某某竞赛', level: '国家级' });
    db.insert('edition', 'edition-cmp009-2025', { competition_id: 'event-cmp009', ordinal: 1, edition_name: '2025年', edition_year: '2025', status: '已发布' });
    const rundb = await 跑06(db, [审过('https://a.cn', 记录('2026年全国大学生某某竞赛'))]);
    db.update('edition', 'edition-cmp009-2025', { time_note: '人工改的' }, 1);
    const r = 写入主库({ 小数据库: rundb, 主库: db, log });
    expect(r.conflicts).toBe(1);
    expect(db.get('edition', 'edition-cmp009-2025').data).toMatchObject({ status: '已发布', time_note: '人工改的' });
    expect(db.get('edition', 'edition-cmp009-2026')).not.toBeNull();
  });
});

// ---- 2026-11-08：给新维护核对已有比赛用的几项（更新已有、按已知比赛对照、同一次多条指向同一个新届次只建一次） ----
describe('对照主库：按已知比赛对照（条目带比赛编号）', () => {
  const 有一个比赛 = () => {
    const db = 主库();
    db.insert('competition', 'event-cmp009', { name: '全国大学生某某竞赛', level: '国家级' });
    db.insert('edition', 'edition-cmp009-2026', { competition_id: 'event-cmp009', ordinal: 1, edition_name: '2026年全国大学生某某竞赛', edition_year: '2026', status: '已发布' });
    db.insert('source', 'source-cmp009-2026-1', { edition_id: 'edition-cmp009-2026', url: 'https://xh.org.cn/n/1', source_type: 'organizer_notice' });
    return db;
  };
  test('名字写法不同也只在这个比赛下认届次：同一届补来源，新的一届挂在这个比赛下，绝不另建比赛', async () => {
    const ctx = ctx装主库(有一个比赛());
    expect(await 对照主库(记录('2026年中联杯'), ctx, new Map(), { 来源们: [来源('https://zl.cn/1')], 比赛编号: 'event-cmp009' }))
      .toMatchObject({ kind: '补来源', competitionId: 'event-cmp009', editionId: 'edition-cmp009-2026', 已有来源数: 1 });
    expect(await 对照主库(记录('2026年中联杯'), ctx, new Map(), { 来源们: [来源()], 比赛编号: 'event-cmp009' }))
      .toMatchObject({ kind: '已处理过', competitionId: 'event-cmp009', editionId: 'edition-cmp009-2026' });
    expect(await 对照主库(记录('2027年中联杯'), ctx, new Map(), { 来源们: [来源('https://zl.cn/1')], 比赛编号: 'event-cmp009' }))
      .toEqual({ kind: '新一届', competitionId: 'event-cmp009', 下一个顺序: 2, supersedes: ['edition-cmp009-2026'] });
  });
  test('指定的比赛主库里没有：报错，不按名字另建', async () => {
    await expect(对照主库(记录('2026年中联杯'), ctx装主库(主库()), new Map(), { 比赛编号: 'event-none' })).rejects.toThrow(/event-none/);
  });
});

describe('入库总管：同一次入库多条指向同一个新届次只建一次', () => {
  test('同一个新比赛的同一届（两个网址）：比赛、届次各建一次，第二条补来源，来源编号接着排', async () => {
    const out = await ingest.run({ items: [审过('https://a.cn', 记录('2026年全国大学生某某竞赛'), [来源('https://a.cn')]), 审过('https://b.cn', 记录('2026年全国大学生某某竞赛'), [来源('https://b.cn')])] }, ctx装主库(主库()));
    expect(out.changes.filter(c => c.table === 'competition')).toHaveLength(1);
    expect(out.changes.filter(c => c.table === 'edition')).toHaveLength(1);
    expect(out.changes.filter(c => c.table === 'source').map(c => c.key.split('-').at(-1))).toEqual(['1', '2']);
    expect(out.items.map(i => i.result)).toEqual(['新比赛', '补来源']);
  });
  test('已有比赛、没写年份只写第几届（中车杯）：同一届只建一次；同一个网址再来一条算已处理过', async () => {
    const db = 主库();
    db.insert('competition', 'event-cmp009', { name: '全国大学生某某竞赛', level: '国家级' });
    db.insert('edition', 'edition-cmp009-n1', { competition_id: 'event-cmp009', ordinal: 1, edition_name: '第九届全国大学生某某竞赛', edition_ordinal: '第九届', status: '已发布' });
    const r = 记录('第十届全国大学生某某竞赛');
    const out = await ingest.run({ items: [审过('https://a.cn', r, [来源('https://a.cn')]), 审过('https://b.cn', r, [来源('https://b.cn')]), 审过('https://c.cn', r, [来源('https://a.cn')])] }, ctx装主库(db));
    expect(out.changes.filter(c => c.table === 'edition' && c.op === 'insert')).toHaveLength(1);
    expect(out.items.map(i => [i.status, i.data.ingest?.decision ?? null])).toEqual([['进行中', '新一届'], ['进行中', '补来源'], ['已丢弃', '已处理过']]);
  });
  test('已有届次同一次补两条来源：编号不撞（-2、-3）', async () => {
    const db = 主库();
    db.insert('competition', 'event-cmp009', { name: '全国大学生某某竞赛', level: '国家级' });
    db.insert('edition', 'edition-cmp009-2026', { competition_id: 'event-cmp009', ordinal: 1, edition_name: '2026年全国大学生某某竞赛', edition_year: '2026', status: '已发布' });
    db.insert('source', 'source-cmp009-2026-1', { edition_id: 'edition-cmp009-2026', url: 'https://xh.org.cn/n/1', source_type: 'organizer_notice' });
    const r = 记录('2026年全国大学生某某竞赛');
    const out = await ingest.run({ items: [审过('https://a.cn', r, [来源('https://a.cn')]), 审过('https://b.cn', r, [来源('https://b.cn')])] }, ctx装主库(db));
    expect(out.changes.map(c => c.key)).toEqual(['source-cmp009-2026-2', 'source-cmp009-2026-3']);
  });
});

describe('入库总管：更新已有（对上已有届次时按这条通知改字段）', () => {
  // 库里这一届：有几处和通知不一样，有几处只是写法不同
  const 有旧届次 = (over = {}) => {
    const db = 主库();
    db.insert('competition', 'event-cmp009', { name: '全国大学生某某竞赛', level: '国家级', organizer: '中国某某学会' });
    db.insert('edition', 'edition-cmp009-2026', { competition_id: 'event-cmp009', ordinal: 2, edition_name: '2026年全国大学生某某竞赛', edition_year: '2026', status: '已发布',
      participants: '  全国普通高校在校本科生 ', format_and_rules: null, fees: '每队 100 元', registration_url: 'https://reg.xh.org.cn/',
      registration_start: '2026-11-01T00:00:00+08:00', registration_end: '2026-11-20', reward_highlights: ['实习或直通面试'], manual_fields: ['registration_end'], ...over });
    db.insert('source', 'source-cmp009-2026-1', { edition_id: 'edition-cmp009-2026', url: 'https://xh.org.cn/n/1', source_type: 'organizer_notice' });
    return db;
  };
  const 预期改动 = [
    { 届次: 'edition-cmp009-2026', 字段: 'format_and_rules', 改前: null, 改后: '提交作品，专家评审' },
    { 届次: 'edition-cmp009-2026', 字段: 'registration_end', 改前: '2026-11-20', 改后: '2026-12-01' },
  ];
  test('默认不开：已有这一届、来源都有了，照旧标已丢弃，不改字段（每晚流程行为不变）', async () => {
    const out = await ingest.run({ items: [审过('https://xh.org.cn/n/1', 记录('2026年全国大学生某某竞赛'))] }, ctx装主库(有旧届次()));
    expect(out.changes).toEqual([]);
    expect(out.items[0]).toMatchObject({ status: '已丢弃' });
    expect(out.items[0].data.ingest).toMatchObject({ decision: '已处理过', 改动: [] });
  });
  test('开着：确定事实不同就改（日期写法、网址结尾斜杠不算不同；人工改过的也改），长文字只补空（原来空着的赛制补上）；空值不覆盖；状态、顺序不动；留一条后台记录', async () => {
    const out = await ingest.run({ 更新已有: true, 来源: '新维护', items: [审过('https://xh.org.cn/n/1', 记录('2026年全国大学生某某竞赛'))] }, ctx装主库(有旧届次()));
    expect(out.items[0]).toMatchObject({ status: '进行中', result: '已处理过' });
    expect(out.items[0].data.ingest).toMatchObject({ decision: '已处理过', competitionId: 'event-cmp009', editionId: 'edition-cmp009-2026', 改动: 预期改动 });
    expect(out.changes.map(c => `${c.op} ${c.table}`)).toEqual(['update edition', 'insert audit_log']);
    const [改, 记] = out.changes;
    expect(改).toMatchObject({ key: 'edition-cmp009-2026', baseVersion: 1, itemKey: 'https://xh.org.cn/n/1' });
    expect(改.payload).toMatchObject({ format_and_rules: '提交作品，专家评审', registration_end: '2026-12-01', status: '已发布', ordinal: 2, fees: '每队 100 元',
      registration_url: 'https://reg.xh.org.cn/', manual_fields: ['registration_end'], edition_name: '2026年全国大学生某某竞赛' });
    expect(记.payload).toMatchObject({ action: '入库改届次', table_name: 'edition', record_id: 'edition-cmp009-2026', created_at: now.toISOString(),
      detail: { 依据网址: 'https://xh.org.cn/n/1', 来源: '新维护', 改动: 预期改动.map(({ 字段, 改前, 改后 }) => ({ 字段, 改前, 改后 })) } });
  });
  test('开着、有新来源：补来源，同时改字段', async () => {
    const out = await ingest.run({ 更新已有: true, items: [审过('https://new.cn', 记录('2026年全国大学生某某竞赛'), [来源('https://new.cn')])] }, ctx装主库(有旧届次()));
    expect(out.changes.map(c => `${c.op} ${c.table}`)).toEqual(['insert source', 'update edition', 'insert audit_log']);
    expect(out.items[0]).toMatchObject({ status: '进行中', result: '补来源' });
    expect(out.items[0].data.ingest.改动).toEqual(预期改动);
  });
  test('开着但没有不同：已有来源的照旧标已丢弃，改动为空', async () => {
    const out = await ingest.run({ 更新已有: true, items: [审过('https://xh.org.cn/n/1', 记录('2026年全国大学生某某竞赛'))] }, ctx装主库(有旧届次({ format_and_rules: '提交作品，专家评审', registration_end: '2026-12-01' })));
    expect(out.changes).toEqual([]);
    expect(out.items[0]).toMatchObject({ status: '已丢弃' });
    expect(out.items[0].data.ingest.改动).toEqual([]);
  });
  test('报名网址就是通知网址本身（抽取没抽到、拿通知网址顶上的）不拿来改', async () => {
    const out = await ingest.run({ 更新已有: true, items: [审过('https://xh.org.cn/n/1', 记录('2026年全国大学生某某竞赛', { registration_url: 'https://xh.org.cn/n/1' }))] }, ctx装主库(有旧届次()));
    expect(out.items[0].data.ingest.改动.map(x => x.字段)).toEqual(['format_and_rules', 'registration_end']);
  });
  test('同一次两条改同一届：第二条在第一条改过的基础上比，改动不互相覆盖', async () => {
    const out = await ingest.run({ 更新已有: true, items: [
      审过('https://xh.org.cn/n/1', 记录('2026年全国大学生某某竞赛')),
      审过('https://b.cn', 记录('2026年全国大学生某某竞赛', { registration_url: 'https://reg2.xh.org.cn/', format_and_rules: '提交作品，专家评审' }), [来源('https://b.cn')]),
    ] }, ctx装主库(有旧届次()));
    expect(out.items[1].data.ingest.改动).toEqual([{ 届次: 'edition-cmp009-2026', 字段: 'registration_url', 改前: 'https://reg.xh.org.cn/', 改后: 'https://reg2.xh.org.cn/' }]);
    const 改们 = out.changes.filter(c => c.table === 'edition');
    expect(改们.map(c => c.baseVersion)).toEqual([1, 1]);
    expect(改们[1].payload).toMatchObject({ registration_url: 'https://reg2.xh.org.cn/', format_and_rules: '提交作品，专家评审', registration_end: '2026-12-01' });
  });
  test('条目带比赛编号：名字写法不同也改的是这个比赛的届次，不另建比赛', async () => {
    const item = 审过('https://xh.org.cn/n/1', 记录('2026年中联杯'));
    item.data.比赛编号 = 'event-cmp009';
    const out = await ingest.run({ 更新已有: true, items: [item] }, ctx装主库(有旧届次()));
    expect(out.changes.some(c => c.table === 'competition')).toBe(false);
    expect(out.items[0].data.ingest).toMatchObject({ decision: '已处理过', editionId: 'edition-cmp009-2026' });
  });
});

describe('写入主库：更新已有的改动', () => {
  const log = { info() {}, warn() {}, error() {} };
  const 准备 = () => {
    const db = 主库();
    db.insert('competition', 'event-cmp009', { name: '全国大学生某某竞赛', level: '国家级' });
    db.insert('edition', 'edition-cmp009-2026', { competition_id: 'event-cmp009', ordinal: 1, edition_name: '2026年全国大学生某某竞赛', edition_year: '2026', status: '已发布', format_and_rules: '旧规则', manual_fields: ['format_and_rules'] });
    db.insert('source', 'source-cmp009-2026-1', { edition_id: 'edition-cmp009-2026', url: 'https://xh.org.cn/n/1', source_type: 'organizer_notice' });
    return db;
  };
  async function 跑(db) {
    const rundb = openRunDb(path.join(tempRoot(), 'run.db'), { runId: '2026-11-01' });
    rundb.写入结果('05-review', { items: [审过('https://xh.org.cn/n/1', 记录('2026年全国大学生某某竞赛'))], changes: [], problems: [] });
    rundb.写入结果('06-ingest', await ingest.run({ 更新已有: true, items: rundb.查找() }, ctx装主库(db)));
    return rundb;
  }
  test('改的字段写进主库（版本加一，状态不动），后台记录写明改了什么、依据哪个网址；人工改过、有值的赛制不动', async () => {
    const db = 准备();
    写入主库({ 小数据库: await 跑(db), 主库: db, log });
    const 届 = db.get('edition', 'edition-cmp009-2026');
    expect(届.version).toBe(2);
    expect(届.data).toMatchObject({ format_and_rules: '旧规则', registration_start: '2026-11-01', registration_end: '2026-12-01', status: '已发布', manual_fields: ['format_and_rules'] });
    const [记] = db.find('audit_log', { action: '入库改届次' });
    expect(记).toMatchObject({ record_id: 'edition-cmp009-2026', detail: { 依据网址: 'https://xh.org.cn/n/1' } });
    expect(记.detail.改动).toContainEqual({ 字段: 'registration_start', 改前: null, 改后: '2026-11-01' });
    expect(记.detail.改动.map(x => x.字段)).not.toContain('format_and_rules');
  });
  test('流程开始后这一届被人改过：不覆盖，后台记录也不写', async () => {
    const db = 准备();
    const rundb = await 跑(db);
    db.update('edition', 'edition-cmp009-2026', { time_note: '人工改的' }, 1);
    const r = 写入主库({ 小数据库: rundb, 主库: db, log });
    expect(r.conflicts).toBeGreaterThanOrEqual(1);
    expect(db.get('edition', 'edition-cmp009-2026').data.registration_start ?? null).toBe(null);
    expect(db.find('audit_log', { action: '入库改届次' })).toEqual([]);
  });
});

// ---- 2026-11-08 代码审查：认届次太严会重复建届；认届次用的字段不该被改 ----
describe('对照主库：届次、年份写法不同也认得是同一届', () => {
  const 有届次 = data => {
    const db = 主库();
    db.insert('competition', 'event-cmp009', { name: '全国大学生某某竞赛', level: '国家级' });
    db.insert('edition', 'edition-cmp009-x', { competition_id: 'event-cmp009', ordinal: 1, edition_name: '某届', status: '已发布', ...data });
    return db;
  };
  const 新来源 = { 来源们: [来源('https://new.cn')] };
  test('届次数：中文、阿拉伯数字都换成数', () => {
    expect([届次数('第十届'), 届次数('第10届'), 届次数('第二十一届'), 届次数('第一百零二届'), 届次数('第两届'), 届次数(null), 届次数('乱写')]).toEqual([10, 10, 21, 102, 2, null, null]);
  });
  test('第十届 = 第10届（两个方向都认），第十一届不是', async () => {
    expect(await 对照主库(记录('第十届全国大学生某某竞赛'), ctx装主库(有届次({ edition_ordinal: '第10届' })), new Map(), 新来源)).toMatchObject({ kind: '补来源', editionId: 'edition-cmp009-x' });
    expect(await 对照主库(记录('第10届全国大学生某某竞赛'), ctx装主库(有届次({ edition_ordinal: '第十届' })), new Map(), 新来源)).toMatchObject({ kind: '补来源', editionId: 'edition-cmp009-x' });
    expect(await 对照主库(记录('第十一届全国大学生某某竞赛'), ctx装主库(有届次({ edition_ordinal: '第十届' })), new Map(), 新来源)).toMatchObject({ kind: '新一届' });
  });
  test('年份区间取前一个年份比：2025—2026 和 2025 算同一年，和 2026 不算', async () => {
    expect(await 对照主库(记录('2025年全国大学生某某竞赛'), ctx装主库(有届次({ edition_year: '2025—2026' })), new Map(), 新来源)).toMatchObject({ kind: '补来源', editionId: 'edition-cmp009-x' });
    expect(await 对照主库(记录('全国大学生某某竞赛（2025-2026）'), ctx装主库(有届次({ edition_year: '2025' })), new Map(), 新来源)).toMatchObject({ kind: '补来源', editionId: 'edition-cmp009-x' });
    expect(await 对照主库(记录('2026年全国大学生某某竞赛'), ctx装主库(有届次({ edition_year: '2025—2026' })), new Map(), 新来源)).toMatchObject({ kind: '新一届' });
  });
  test('同一次入库两条新比赛，一条写第十届、一条写第10届：只建一届', async () => {
    const out = await ingest.run({ items: [审过('https://a.cn', 记录('第十届全国大学生某某竞赛'), [来源('https://a.cn')]), 审过('https://b.cn', 记录('第10届全国大学生某某竞赛'), [来源('https://b.cn')])] }, ctx装主库(主库()));
    expect(out.changes.filter(c => c.table === 'edition')).toHaveLength(1);
    expect(out.items.map(i => i.result)).toEqual(['新比赛', '补来源']);
  });
});

describe('对照主库：条目带届次编号就直接用这一届', () => {
  const 两个比赛 = () => {
    const db = 主库();
    db.insert('competition', 'event-cmp009', { name: '全国大学生某某竞赛', level: '国家级' });
    db.insert('edition', 'edition-cmp009-2026', { competition_id: 'event-cmp009', ordinal: 1, edition_name: '2026年全国大学生某某竞赛', edition_year: '2026', status: '已发布' });
    db.insert('source', 'source-cmp009-2026-1', { edition_id: 'edition-cmp009-2026', url: 'https://xh.org.cn/n/1', source_type: 'organizer_notice' });
    db.insert('competition', 'event-b', { name: '全国大学生乙竞赛', level: '国家级' });
    db.insert('edition', 'edition-b-2026', { competition_id: 'event-b', ordinal: 1, edition_name: '2026年全国大学生乙竞赛', edition_year: '2026', status: '已发布' });
    db.insert('edition', 'edition-b-del', { competition_id: 'event-b', ordinal: 2, edition_name: '删了的', status: '已发布', deleted_at: now.toISOString() });
    return db;
  };
  test('名字里的年份对不上也用这一届：有新来源补来源，没有就是已处理过', async () => {
    const ctx = ctx装主库(两个比赛());
    expect(await 对照主库(记录('2027年中联杯'), ctx, new Map(), { 来源们: [来源('https://zl.cn/1')], 比赛编号: 'event-cmp009', 届次编号: 'edition-cmp009-2026' }))
      .toEqual({ kind: '补来源', competitionId: 'event-cmp009', editionId: 'edition-cmp009-2026', 已有来源数: 1, 新来源们: [来源('https://zl.cn/1')] });
    expect(await 对照主库(记录('2027年中联杯'), ctx, new Map(), { 来源们: [来源()], 届次编号: 'edition-cmp009-2026' }))
      .toMatchObject({ kind: '已处理过', competitionId: 'event-cmp009', editionId: 'edition-cmp009-2026' });
  });
  test('这一届不存在、已删除、或不属于条目的比赛编号：报错写清楚', async () => {
    const ctx = ctx装主库(两个比赛());
    await expect(对照主库(记录('2026年中联杯'), ctx, new Map(), { 届次编号: 'edition-none' })).rejects.toThrow(/指定的届次 edition-none 主库里没有/);
    await expect(对照主库(记录('2026年中联杯'), ctx, new Map(), { 届次编号: 'edition-b-del' })).rejects.toThrow(/指定的届次 edition-b-del 主库里没有/);
    await expect(对照主库(记录('2026年中联杯'), ctx, new Map(), { 比赛编号: 'event-cmp009', 届次编号: 'edition-b-2026' })).rejects.toThrow(/指定的届次 edition-b-2026 不属于比赛 event-cmp009/);
  });
  test('入库总管：条目 data 带届次编号就按它走；不存在的这条标失败，原因写明', async () => {
    const 带 = (key, 届次编号) => { const i = 审过(key, 记录('2027年中联杯'), [来源(key)]); i.data.比赛编号 = 'event-cmp009'; i.data.届次编号 = 届次编号; return i; };
    const out = await ingest.run({ items: [带('https://zl.cn/1', 'edition-cmp009-2026'), 带('https://zl.cn/2', 'edition-none')] }, ctx装主库(两个比赛()));
    expect(out.changes.map(c => `${c.op} ${c.table} ${c.key}`)).toEqual(['insert source source-cmp009-2026-2']);
    expect(out.items[0]).toMatchObject({ status: '进行中', result: '补来源' });
    expect(out.items[1]).toMatchObject({ status: '失败', reason: expect.stringMatching(/^06 入库·出错：指定的届次 edition-none 主库里没有/) });
  });
});

// 2026-11-09 用户定“只改确定的事实”：美国试跑把 event-cmp002 的赛制改成只剩“（一）主体赛事”、参赛资格改窄，
// 本地实测报名截止从“12-04 23:59”变成“12-04”、主办方改成“参赛指南”。确定事实（日期、报名网址、费用）不同就改，其余只在库里空着时补。
describe('比对届次：确定事实直接改，长文字和其他字段只补空（2026-11-09）', () => {
  const 长赛制 = '一、作品类别：本届设四类作品。（一）主体赛事：……（二）专项赛：……（三）创意赛：……（四）实践赛：……二、评审：初赛网评、决赛现场答辩。';
  test('赛制已有长文字、新值是短片段 → 不改；原来空（null、空串）→ 补上', () => {
    expect(比对届次({ format_and_rules: 长赛制 }, { format_and_rules: '（一）主体赛事' })).toEqual([]);
    expect(比对届次({ format_and_rules: null }, { format_and_rules: '（一）主体赛事' })).toEqual([{ 字段: 'format_and_rules', 改前: null, 改后: '（一）主体赛事' }]);
    expect(比对届次({ format_and_rules: '  ' }, { format_and_rules: '提交作品' })).toEqual([{ 字段: 'format_and_rules', 改前: '  ', 改后: '提交作品' }]);
  });
  test('参赛对象、参赛资格、报名方式、团队人数有值 → 不改；空着 → 补', () => {
    const 旧 = { participants: '全国普通高校在校生', eligibility: '本科生、研究生均可', registration_method: '学校统一报名', team_size: '3-5人' };
    const 新 = { participants: '本科生', eligibility: '本科生', registration_method: '官网报名', team_size: '3人' };
    expect(比对届次(旧, 新)).toEqual([]);
    expect(比对届次({}, 新).map(x => x.字段)).toEqual(['participants', 'eligibility', 'team_size', 'registration_method']);
  });
  test('主办方已有值、新值“参赛指南” → 不改；届次空着但比赛有主办方 → 也不补；两边都空 → 补', () => {
    expect(比对届次({ organizer: '中国某某学会' }, { organizer: '参赛指南' })).toEqual([]);
    expect(比对届次({ organizer: null }, { organizer: '参赛指南' }, { 比赛: { organizer: '中国某某学会' } })).toEqual([]);
    expect(比对届次({ organizer: null }, { organizer: '中国某某学会' }, { 比赛: {} })).toEqual([{ 字段: 'organizer', 改前: null, 改后: '中国某某学会' }]);
  });
  test('奖励亮点：原来是空列表才补，有值不改', () => {
    expect(比对届次({ reward_highlights: ['证书荣誉'] }, { reward_highlights: ['现金奖金'] })).toEqual([]);
    expect(比对届次({ reward_highlights: [] }, { reward_highlights: ['现金奖金'] })).toEqual([{ 字段: 'reward_highlights', 改前: [], 改后: ['现金奖金'] }]);
  });
  test('报名截止：旧带时间、新同一天只有日期 → 不改（不把精确时间改粗）', () => {
    expect(比对届次({ registration_end: '2026-12-04T23:59:00+08:00' }, { registration_end: '2026-12-04' })).toEqual([]);
    expect(比对届次({ registration_end: '2026-12-04T15:59:00.000Z' }, { registration_end: '2026年12月4日' })).toEqual([]);
  });
  test('报名截止：新是不同日期 → 改（旧带时间也改）', () => {
    expect(比对届次({ registration_end: '2026-12-04T23:59:00+08:00' }, { registration_end: '2026-12-10' })).toEqual([
      { 字段: 'registration_end', 改前: '2026-12-04T23:59:00+08:00', 改后: '2026-12-10' }]);
    expect(比对届次({ registration_end: '2026-12-04' }, { registration_end: '2026-12-10' })).toEqual([{ 字段: 'registration_end', 改前: '2026-12-04', 改后: '2026-12-10' }]);
  });
  test('报名截止：旧只有日期、新同一天带时间 → 改（变精确）；同一天两个不同时间 → 改；北京时间零点算只有日期', () => {
    expect(比对届次({ registration_end: '2026-12-04' }, { registration_end: '2026-12-04T23:59:00+08:00' })).toEqual([
      { 字段: 'registration_end', 改前: '2026-12-04', 改后: '2026-12-04T23:59:00+08:00' }]);
    expect(比对届次({ registration_end: '2026-12-04T17:00:00+08:00' }, { registration_end: '2026-12-04T23:59:00+08:00' })).toEqual([
      { 字段: 'registration_end', 改前: '2026-12-04T17:00:00+08:00', 改后: '2026-12-04T23:59:00+08:00' }]);
    expect(比对届次({ registration_end: '2026-12-04T00:00:00+08:00' }, { registration_end: '2026-12-04' })).toEqual([]);
  });
  test('报名开始、比赛开始、比赛结束同样的日期规则', () => {
    expect(比对届次({ registration_start: '2026-11-01T09:00:00+08:00', competition_start: '2027-01-10T09:00:00+08:00', competition_end: '2027-01-12' },
      { registration_start: '2026-11-01', competition_start: '2027-01-10', competition_end: '2027-01-15' })).toEqual([
      { 字段: 'competition_end', 改前: '2027-01-12', 改后: '2027-01-15' }]);
    expect(比对届次({}, { competition_start: '2027-01-10' })).toEqual([{ 字段: 'competition_start', 改前: null, 改后: '2027-01-10' }]);
  });
  test('报名网址不同 → 改；新值空 → 不覆盖', () => {
    expect(比对届次({ registration_url: 'https://old.cn/reg', fees: '每队 100 元' }, { registration_url: 'https://new.cn/reg', fees: '每队 100 元' })).toEqual([
      { 字段: 'registration_url', 改前: 'https://old.cn/reg', 改后: 'https://new.cn/reg' }]);
    expect(比对届次({ registration_url: 'https://old.cn/reg', fees: '每队 100 元' }, { registration_url: null, fees: ' ' })).toEqual([]);
  });
  test('费用只补空（2026-11-13 用户定：两次实测把完整费用说明换成截断的“…其中：”、丢了缴费截止）', () => {
    const 完整 = '每队报名费 300 元，其中：初赛 100 元、决赛 200 元；缴费截止 2026-12-01';
    expect(比对届次({ fees: 完整 }, { fees: '每队报名费 300 元，其中：' })).toEqual([]);
    expect(比对届次({ fees: null }, { fees: '免费' })).toEqual([{ 字段: 'fees', 改前: null, 改后: '免费' }]);
    expect(比对届次({ fees: '  ' }, { fees: '免费' })).toEqual([{ 字段: 'fees', 改前: '  ', 改后: '免费' }]);
  });
  test('人工改过的字段（manual_fields）照同样规则：确定事实照改，长文字和费用只补空', () => {
    const 旧 = { format_and_rules: 长赛制, eligibility: null, fees: '每队 100 元', registration_end: '2026-12-04', manual_fields: ['format_and_rules', 'eligibility', 'fees', 'registration_end'] };
    const 新 = { format_and_rules: '（一）主体赛事', eligibility: '本科生', fees: '免费', registration_end: '2026-12-10' };
    expect(比对届次(旧, 新)).toEqual([
      { 字段: 'eligibility', 改前: null, 改后: '本科生' },
      { 字段: 'registration_end', 改前: '2026-12-04', 改后: '2026-12-10' }]);
  });
});

describe('比对届次：只补空（高校转发用，2026-11-13）', () => {
  test('给了 只补空：确定事实（日期、报名网址）也只在库里空着时补，有值不改', () => {
    const 旧 = { registration_end: '2026-12-01', registration_url: 'https://reg.a.cn/', registration_start: null };
    const 新 = { registration_end: '2026-12-20', registration_url: 'https://reg.b.cn/', registration_start: '2026-11-10' };
    expect(比对届次(旧, 新, { 只补空: true })).toEqual([{ 字段: 'registration_start', 改前: null, 改后: '2026-11-10' }]);
    expect(比对届次(旧, 新).map(x => x.字段).sort()).toEqual(['registration_end', 'registration_start', 'registration_url'].sort());
  });
});

describe('比对届次：认届次用的年份、届次不改，只在库里空着时补', () => {
  test('库里有值：年份、届次不同也不改', () => {
    expect(比对届次({ edition_year: '2025', edition_ordinal: '第九届' }, { edition_year: '2026', edition_ordinal: '第十届' })).toEqual([]);
  });
  test('库里空着：补上', () => {
    expect(比对届次({ edition_year: null, edition_ordinal: ' ' }, { edition_year: '2026', edition_ordinal: '第十届' })).toEqual([
      { 字段: 'edition_year', 改前: null, 改后: '2026' }, { 字段: 'edition_ordinal', 改前: ' ', 改后: '第十届' }]);
  });
  test('入库总管带届次编号 + 更新已有：名字里的年份和这一届不同，年份不改，空着的届次补上；有值的赛制不改，空着的报名时间补上', async () => {
    const db = 主库();
    db.insert('competition', 'event-cmp009', { name: '全国大学生某某竞赛', level: '国家级' });
    db.insert('edition', 'edition-cmp009-2025', { competition_id: 'event-cmp009', ordinal: 1, edition_name: '2025年全国大学生某某竞赛', edition_year: '2025', status: '已发布', format_and_rules: '旧规则' });
    const item = 审过('https://zl.cn/1', 记录('2026年第十届全国大学生某某竞赛'), [来源('https://zl.cn/1')]);
    item.data.届次编号 = 'edition-cmp009-2025';
    const out = await ingest.run({ 更新已有: true, items: [item] }, ctx装主库(db));
    const 字段们 = out.items[0].data.ingest.改动.map(x => x.字段);
    expect(字段们).not.toContain('format_and_rules');
    expect(字段们).toContain('registration_end');
    expect(字段们).toContain('edition_ordinal');
    expect(字段们).not.toContain('edition_year');
    expect(out.changes.find(c => c.table === 'edition').payload).toMatchObject({ edition_year: '2025', edition_ordinal: '第十届' });
  });
});

// 2026-11-08 用户定：“进行维护的时候不需要审核”“发现新的一届直接进行调换”。入库指定网址 给新维护传 不审核: true 时不跑 05，
// 04 读详情抽取完的候选直接交 06：记录用 合成记录 合成，这条通知网址（和 04 补读到的正式通知）当官方来源写；新的一届直接发布、不卡发布门槛，
// 原来最新的那一届归档；维护不新建比赛。
describe('入库总管：不审核（新维护用，2026-11-08）', () => {
  const 有一个比赛 = () => {
    const db = 主库();
    db.insert('competition', 'event-cmp009', { name: '全国大学生某某竞赛', level: '国家级' });
    db.insert('edition', 'edition-cmp009-2025', { competition_id: 'event-cmp009', ordinal: 1, edition_name: '2025年全国大学生某某竞赛', edition_year: '2025', status: '已归档' });
    db.insert('edition', 'edition-cmp009-2026', { competition_id: 'event-cmp009', ordinal: 2, edition_name: '2026年全国大学生某某竞赛', edition_year: '2026', status: '已发布', format_and_rules: '旧规则' });
    db.insert('source', 'source-cmp009-2026-1', { edition_id: 'edition-cmp009-2026', url: 'https://xh.org.cn/n/1', source_type: 'organizer_notice' });
    return db;
  };
  const 字段 = (value, quote = value) => ({ value, quote });
  // 04 抽取完、没经过 05 的候选（没有 data.review）；新维护带比赛编号
  const 抽过 = (key, { 名 = '2027年全国大学生某某竞赛', 字段们 = {}, 补读 = null, data = {} } = {}) => ({ key, kind: 'candidate', status: '进行中', data: {
    url: key, title: `关于举办${名}的通知`, name: '全国大学生某某竞赛', snippet: '', 渠道们: ['新维护'], 路线们: ['新维护'], 搜索词们: [], 比赛编号: 'event-cmp009', ...data,
    extraction: { fields: { competition_name: 字段(名), organizer: 字段('中国某某学会', '由中国某某学会主办'), registration_start: 字段('2026-11-10', '11月10日开始报名'),
      registration_end: 字段('2026-12-20', '12月20日截止'), format_and_rules: 字段('新规则', '提交作品，专家评审'), ...字段们 }, ...(补读 ? { supplement: 补读 } : {}) } } });
  const 跑 = (db, items, over = {}) => ingest.run({ runId: 'x', items, 不审核: true, 更新已有: true, 来源: '新维护', ...over }, ctx装主库(db));

  test('新的一届：直接新建并发布，原来最新的那一届（已发布）归档；来源写成核验过的官方来源（通知 + 04 补读到的正式通知）', async () => {
    const db = 有一个比赛();
    const out = await 跑(db, [抽过('https://xh.org.cn/n/2', { 补读: { used: true, noticeUrl: 'https://xh.org.cn/n/9', missingBefore: [], missingAfter: [] } })]);
    expect(out.items[0]).toMatchObject({ status: '进行中', result: '新一届', data: { ingest: { decision: '新一届', competitionId: 'event-cmp009', editionId: 'edition-cmp009-2027', status: '已发布', 改动: [] } } });
    expect(out.items[0].reason).toContain('维护不审核');
    expect(out.changes.map(c => `${c.op} ${c.table} ${c.key}`)).toEqual([
      'insert edition edition-cmp009-2027', 'insert source source-cmp009-2027-1', 'insert source source-cmp009-2027-2', 'update edition edition-cmp009-2026']);
    expect(out.changes[0].payload).toMatchObject({ competition_id: 'event-cmp009', ordinal: 3, edition_year: '2027', status: '已发布', organizer: '中国某某学会',
      registration_start: '2026-11-10', registration_end: '2026-12-20', format_and_rules: '新规则', pending_announcement: false, registration_url: 'https://xh.org.cn/n/2' });
    expect(out.changes[3].payload).toMatchObject({ status: '已归档' });
    const 来源们 = out.changes.filter(c => c.table === 'source').map(c => c.payload);
    expect(来源们.map(s => s.url)).toEqual(['https://xh.org.cn/n/2', 'https://xh.org.cn/n/9']);
    for (const s of 来源们) {
      expect(s).toMatchObject({ edition_id: 'edition-cmp009-2027', source_type: 'organizer_notice', is_official: true, validity_status: 'valid', last_verified_at: now.toISOString() });
      expect(s.review_reason).toBe('新维护：出自已判断为官网的页面，维护不审核（2026-11-08 用户定）');
      expect(s.supports_fields).toEqual(expect.arrayContaining(['name', 'organizer', 'registration_start', 'registration_end']));
      expect(s.evidence_excerpt).toContain('由中国某某学会主办');
      expect(s.content_summary).toBeTruthy();
    }
    expect(来源们[0].title).toBe('关于举办2027年全国大学生某某竞赛的通知');
    // 程序审核认得它们是核验过的官方来源（后台、发布门槛不会当成没核验的）
    expect(有核验过的官方来源({ id: 'edition-cmp009-2027', sources: out.changes.filter(c => c.table === 'source').map(c => ({ id: c.key, ...c.payload })) })).toBe(true);
  });
  test('新的一届不卡发布门槛：门槛会挡的（报名开始晚于截止）照样新建发布', async () => {
    const db = 有一个比赛();
    const out = await 跑(db, [抽过('https://xh.org.cn/n/2', { 字段们: { registration_start: 字段('2026-12-25', '12月25日开始报名') } })]);
    expect(out.items[0]).toMatchObject({ status: '进行中', result: '新一届' });
    expect(out.changes.find(c => c.table === 'edition' && c.op === 'insert').payload.status).toBe('已发布');
  });
  test('报名截止没抽到：届次写“时间待公布”；已截止的照旧归档', async () => {
    const 没截止 = await 跑(有一个比赛(), [抽过('https://xh.org.cn/n/2', { 字段们: { registration_start: 字段('', ''), registration_end: 字段('', '') } })]);
    expect(没截止.changes[0].payload).toMatchObject({ registration_end: null, pending_announcement: true, status: '已发布' });
    const 截止了 = await 跑(有一个比赛(), [抽过('https://xh.org.cn/n/2', { 字段们: { registration_start: 字段('2026-09-01', '9月1日'), registration_end: 字段('2026-10-01', '10月1日') } })]);
    expect(截止了.changes[0].payload.status).toBe('已归档');
  });
  test('对上已有届次：照更新已有比字段、改字段，补来源（官方来源）', async () => {
    const db = 有一个比赛();
    const out = await 跑(db, [抽过('https://xh.org.cn/n/2', { 名: '2026年全国大学生某某竞赛', data: { 届次编号: 'edition-cmp009-2026' } })]);
    expect(out.items[0]).toMatchObject({ status: '进行中', result: '补来源', data: { ingest: { decision: '补来源', editionId: 'edition-cmp009-2026' } } });
    expect(out.items[0].data.ingest.改动.map(x => x.字段).sort()).toEqual(['organizer', 'registration_end', 'registration_start'].sort());
    const 来源 = out.changes.find(c => c.table === 'source');
    expect(来源).toMatchObject({ key: 'source-cmp009-2026-2', payload: { url: 'https://xh.org.cn/n/2', is_official: true, validity_status: 'valid', review_reason: expect.stringContaining('维护不审核') } });
    expect(out.changes.find(c => c.table === 'edition').payload).toMatchObject({ format_and_rules: '旧规则', organizer: '中国某某学会', registration_end: '2026-12-20', status: '已发布' });
    expect(out.changes.find(c => c.table === 'audit_log').payload.detail).toMatchObject({ 来源: '新维护', 依据网址: 'https://xh.org.cn/n/2' });
  });
  test('对上已有届次、来源都有了、也没有要改的：已处理过，标已丢弃（和以前一样）', async () => {
    const db = 有一个比赛();
    db.update('edition', 'edition-cmp009-2026', { organizer: '中国某某学会', registration_start: '2026-11-10', registration_end: '2026-12-20', format_and_rules: '新规则' }, 1);
    const out = await 跑(db, [抽过('https://xh.org.cn/n/1', { 名: '2026年全国大学生某某竞赛' })]);
    expect(out.items[0]).toMatchObject({ status: '已丢弃', reason: expect.stringContaining('来源也都有了') });
    expect(out.changes).toEqual([]);
  });
  // 2026-11-13 用户定：官网打不开时新维护改用高校转发的通知（来源类型 school_repost）。对上已有届次时高校转发不覆盖已有值，只补空
  test('高校转发对上已有届次：确定事实也只补空（库里有值的报名截止不改，空着的报名开始补上）；来源写成高校转发、不算官方', async () => {
    const db = 有一个比赛();
    db.update('edition', 'edition-cmp009-2026', { registration_end: '2026-12-01' }, 1);
    const out = await 跑(db, [抽过('https://jwc.abc.edu.cn/info/1/2.htm', { 名: '2026年全国大学生某某竞赛', data: { 届次编号: 'edition-cmp009-2026', 来源类型: 'school_repost', 核对说明: '新维护：官网打不开，用高校转发' } })]);
    expect(out.items[0]).toMatchObject({ status: '进行中', result: '补来源' });
    const 改 = out.items[0].data.ingest.改动;
    expect(改.map(x => x.字段).sort()).toEqual(['organizer', 'registration_start'].sort());
    expect(out.changes.find(c => c.table === 'edition').payload).toMatchObject({ registration_end: '2026-12-01', registration_start: '2026-11-10', format_and_rules: '旧规则', status: '已发布' });
    expect(out.changes.find(c => c.table === 'source').payload).toMatchObject({ url: 'https://jwc.abc.edu.cn/info/1/2.htm', source_type: 'school_repost', is_official: false, validity_status: 'valid', review_reason: '新维护：官网打不开，用高校转发' });
  });
  test('官方通知对上已有届次（对照）：确定事实照旧不同就改', async () => {
    const db = 有一个比赛();
    db.update('edition', 'edition-cmp009-2026', { registration_end: '2026-12-01' }, 1);
    const out = await 跑(db, [抽过('https://xh.org.cn/n/2', { 名: '2026年全国大学生某某竞赛', data: { 届次编号: 'edition-cmp009-2026' } })]);
    expect(out.changes.find(c => c.table === 'edition').payload).toMatchObject({ registration_end: '2026-12-20' });
  });
  test('维护不新建比赛：没带比赛编号、名字也对不上已有比赛的，丢弃并写明原因', async () => {
    const db = 有一个比赛();
    const out = await 跑(db, [抽过('https://other.cn/n/1', { 名: '2027年全国大学生另一竞赛', data: { 比赛编号: undefined, name: '全国大学生另一竞赛' } })]);
    expect(out.items[0]).toMatchObject({ status: '已丢弃', reason: '06 入库·对照主库：维护不新建比赛（没对上已有比赛，不审核模式不新建）' });
    expect(out.changes).toEqual([]);
  });
  test('不审核只处理 04 抽取过的；不开不审核时没有 data.review 的照旧不处理', async () => {
    const db = 有一个比赛();
    const 没抽 = { key: 'https://xh.org.cn/n/3', kind: 'candidate', status: '进行中', data: { url: 'https://xh.org.cn/n/3', name: 'x', 比赛编号: 'event-cmp009' } };
    expect((await 跑(db, [没抽])).items).toEqual([]);
    const 夜里 = await ingest.run({ runId: 'x', items: [抽过('https://xh.org.cn/n/2')] }, ctx装主库(db));
    expect(夜里).toMatchObject({ items: [], changes: [] });
  });
});
