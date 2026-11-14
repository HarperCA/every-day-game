// 批量归档（2026-11-12 用户定）：每个比赛最新一届、还是待人工审核、报名已截止的，一次改成已归档。
// 报名截止按北京时间（只写日期的算当天 23:59:59）；没写报名截止看比赛结束；两个都没有不动。人工定过状态的不动。
// 归档要过发布门槛的归档那几项（标题、范围、名称），过不了的不动、记下原因。可以只挑最后一条理由是某个开头的（--理由前缀）。
import { describe, expect, test } from 'vitest';
import { openDb } from '../../../../index.mjs';
import { 批量归档, 截止依据 } from '../../index.mjs';

const NOW = new Date('2026-11-12T10:00:00.000Z');   // 北京时间 11-12 18:00
const 结束了 = '发布前还缺：该届已结束：只能作为历史届归档';
const 比赛 = (id, name, over = {}) => ({ name, level: '国家级', organizer: '中国某某学会', professions: ['计算机类'], ...over });
const 届 = (competition_id, ordinal, over = {}) => ({ competition_id, ordinal, edition_name: `${competition_id} 第 ${ordinal} 届`, participants: '全国普通高校在校本科生',
  format_and_rules: '提交作品，专家评审', status_reason: ['名录导入', 结束了], ...over });

function 准备() {
  const db = openDb({ file: ':memory:', now: () => NOW });
  db.transaction(tx => {
    const 加 = (cid, name, 届们, 比赛改 = {}) => {
      tx.insert('competition', cid, 比赛(cid, name, 比赛改));
      届们.forEach((e, i) => tx.insert('edition', `${cid}-${i + 1}`, 届(cid, i + 1, e)));
    };
    加('c-reg', '全国大学生甲竞赛', [{ registration_end: '2025-09-01' }]);                                       // 报名截止已过 → 归
    加('c-comp', '全国大学生乙竞赛', [{ competition_end: '2025-10-01' }]);                                       // 没写报名截止、比赛已结束 → 归
    加('c-none', '全国大学生丙竞赛', [{}]);                                                                       // 两个都没有 → 不动
    加('c-future', '全国大学生丁竞赛', [{ registration_end: '2026-12-01', competition_end: '2025-01-01' }]);       // 报名还没截止（比赛结束不看）→ 不动
    加('c-today', '全国大学生戊竞赛', [{ registration_end: '2026-11-12' }]);                                      // 截止当天不算截止 → 不动
    加('c-manual', '全国大学生庚竞赛', [{ registration_end: '2025-09-01', manual_fields: ['status'] }]);         // 人工定过状态 → 不动
    加('c-gate', '全国大学生辛竞赛报名通知', [{ registration_end: '2025-09-01' }]);                                // 名称是通知 → 门槛不过
    加('c-old', '全国大学生壬竞赛', [{ registration_end: '2024-09-01' }, { registration_end: '2025-09-01', status: '已发布' }]);   // 最新一届已发布，旧的不动
    加('c-other', '全国大学生癸竞赛', [{ registration_end: '2025-09-01', status_reason: ['旧系统的草稿，未审核'] }]);  // 理由不是“该届已结束”
    加('c-pub', '全国大学生子竞赛', [{ registration_end: '2025-09-01', status: '已发布' }]);                     // 已发布的不归（每日归档管）
    加('c-del', '全国大学生丑竞赛', [{ registration_end: '2025-09-01' }]);
  });
  db.transaction(tx => tx.标记删除('competition', 'c-del', { by: '测试', at: NOW.toISOString() }));
  return db;
}

describe('截止依据：报名截止按北京时间，没有看比赛结束，两个都没有不动', () => {
  test.each([
    [{ registration_end: '2025-09-01' }, '报名截止'],
    [{ registration_end: '2026-11-12' }, '没截止'],
    [{ registration_end: '2026-11-12T17:59:00+08:00' }, '报名截止'],
    [{ registration_end: '2026-11-12T18:01:00+08:00' }, '没截止'],
    [{ competition_end: '2025-10-01' }, '比赛结束'],
    [{ registration_end: '2026-12-01', competition_end: '2025-01-01' }, '没截止'],
    [{ registration_end: '2025/09/01' }, '日期写坏了'],   // 比赛库的校验本来就挡写坏的日期，这里只是兜底
    [{ registration_end: '', competition_end: null }, '没有日期'],
  ])('%j → %s', (e, 依据) => expect(截止依据(e, NOW)).toBe(依据));
});

describe('批量归档', () => {
  test('只挑理由开头对得上的：报名截止已过（或没写截止、比赛已结束）的最新一届归档，过不了门槛的、人工定过的、没截止的、没日期的不动并分别列出', () => {
    const db = 准备();
    const 结果 = 批量归档(db, { now: NOW, 理由前缀: '发布前还缺：该届已结束' });
    expect(结果.看了).toBe(7);
    expect(结果.归档了.map(x => [x.id, x.依据])).toEqual([['c-comp-1', '比赛结束'], ['c-reg-1', '报名截止']]);
    expect(结果.没过门槛).toEqual([{ id: 'c-gate-1', 名称: 'c-gate 第 1 届', 原因们: [expect.stringContaining('通知')] }]);
    expect(结果.人工定过.map(x => x.id)).toEqual(['c-manual-1']);
    expect(Object.fromEntries(Object.entries(结果.不动).map(([k, v]) => [k, v.map(x => x.id)]))).toEqual({ 没截止: ['c-future-1', 'c-today-1'], 日期写坏了: [], 没有日期: ['c-none-1'] });
    expect(结果.失败).toEqual([]);

    const 后 = db.get('edition', 'c-reg-1').data;
    expect(后).toMatchObject({ status: '已归档', status_at: NOW.toISOString(), updated_by: '批量归档', status_reason: ['名录导入', 结束了, '2026-11-12 批量归档：报名已截止'] });
    expect(db.get('edition', 'c-comp-1').data.status_reason.at(-1)).toBe('2026-11-12 批量归档：报名已截止（没写报名截止，按比赛结束算）');
    for (const id of ['c-none-1', 'c-future-1', 'c-today-1', 'c-manual-1', 'c-gate-1', 'c-old-1', 'c-other-1']) expect(db.get('edition', id).data.status, id).toBe('待人工审核');
    expect(db.get('edition', 'c-pub-1').data.status).toBe('已发布');
    expect(db.get('edition', 'c-del-1', { 包括已删除: true }).data.status).toBe('待人工审核');
    expect(db.find('audit_log', { action: '批量归档' }).map(r => r.record_id).sort()).toEqual(['c-comp-1', 'c-reg-1']);

    expect(批量归档(db, { now: NOW, 理由前缀: '发布前还缺：该届已结束' }).归档了).toEqual([]);   // 再跑一次没有要归的
  });
  test('不给理由前缀：所有比赛最新一届的待人工审核都看', () => {
    const db = 准备();
    const 结果 = 批量归档(db, { now: NOW, 试跑: true });
    expect(结果.看了).toBe(8);
    expect(结果.归档了.map(x => x.id)).toEqual(['c-comp-1', 'c-other-1', 'c-reg-1']);
  });
  test('试跑：只算不写', () => {
    const db = 准备();
    const 结果 = 批量归档(db, { now: NOW, 试跑: true, 理由前缀: '发布前还缺：该届已结束' });
    expect(结果.归档了.map(x => x.id)).toEqual(['c-comp-1', 'c-reg-1']);
    expect(db.get('edition', 'c-reg-1').data.status).toBe('待人工审核');
    expect(db.find('audit_log', { action: '批量归档' })).toEqual([]);
  });
});
