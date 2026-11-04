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
import { 整理字段, 拆名称, 已截止, 比赛编号 } from '../../整理字段/index.mjs';
import { 写入主库 } from '../../写入主库/index.mjs';

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
    const out = await ingest.run({ items: [审过('https://a.cn', 记录('全国大学生某某竞赛', { registration_url: null }))] }, ctx装主库(主库()));
    expect(out.changes).toEqual([]);
    expect(out.items[0]).toMatchObject({ status: '已丢弃', reason: expect.stringMatching(/^06 入库·发布门槛：.*报名网址/) });
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
