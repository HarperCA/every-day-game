// 届次.归档：每日归档用的比赛库写入（2026-11-03）。状态改成已归档、记状态时间和理由、存下一届预计，留一条“自动归档”后台记录；带读到的版本号。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../test/复用/样例数据.mjs';
import { 届次 } from '../../../index.mjs';

const 选项 = { 操作人: '每日归档', at: '2026-11-03T18:00:00.000Z' };

describe('届次.归档', () => {
  test('已发布 → 已归档：状态时间、理由、下一届预计都写上，留一条后台记录', () => {
    const db = open(); seed(db);
    const 原 = db.get('edition', 'ed-math-2026');
    届次.归档(db, 'ed-math-2026', 原.version, { 下一届预计: '2027-09-01T00:00:00.000Z' }, 选项);
    const 后 = db.get('edition', 'ed-math-2026');
    expect(后.data).toMatchObject({ status: '已归档', status_at: 选项.at, status_reason: ['报名已截止，每日归档自动归档'], next_edition_estimate: '2027-09-01T00:00:00.000Z', updated_by: '每日归档' });
    expect(后.version).toBe(原.version + 1);
    expect(db.find('audit_log', { action: '自动归档' })[0]).toMatchObject({ table_name: 'edition', record_id: 'ed-math-2026', detail: { 名称: '2026 年数学建模', 下一届预计: '2027-09-01T00:00:00.000Z', 操作人: '每日归档' } });
  });
  test('算不出下一届的存空；只归已发布的；版本号对不上不改', () => {
    const db = open(); seed(db);
    const 原 = db.get('edition', 'ed-math-2026');
    届次.归档(db, 'ed-math-2026', 原.version, { 下一届预计: null }, 选项);
    expect(db.get('edition', 'ed-math-2026').data.next_edition_estimate).toBeNull();
    expect(() => 届次.归档(db, 'ed-math-2025', db.get('edition', 'ed-math-2025').version, { 下一届预计: null }, 选项)).toThrow('只归档已发布的');
    const 再 = db.get('edition', 'ed-art-2026');
    expect(() => 届次.归档(db, 'ed-art-2026', 再.version + 5, { 下一届预计: null }, 选项)).toThrow();
  });
});

// 届次.待审归档：批量归档用（维护/批量归档/，2026-11-12）。待人工审核 → 已归档，理由接在原来的后面，留一条“批量归档”后台记录；
// 人工定过状态的（manual_fields 含 status）不动；带读到的版本号。哪些要归由维护/批量归档/定。
describe('届次.待审归档', () => {
  const 批量 = { 操作人: '批量归档', at: '2026-11-12T10:00:00.000Z' };
  const 理由 = '2026-11-12 批量归档：报名已截止';
  test('待人工审核 → 已归档：状态时间、理由（接在原来的后面）、操作人都写上，版本加一，留一条“批量归档”后台记录', () => {
    const db = open(); seed(db);
    const 先 = db.get('edition', 'ed-math-2025');
    db.update('edition', 'ed-math-2025', { status_reason: ['名录导入', '发布前还缺：该届已结束'] }, 先.version);
    const 原 = db.get('edition', 'ed-math-2025');
    expect(原.data.status).toBe('待人工审核');
    届次.待审归档(db, 'ed-math-2025', 原.version, { 理由 }, 批量);
    const 后 = db.get('edition', 'ed-math-2025');
    expect(后.data).toMatchObject({ status: '已归档', status_at: 批量.at, status_reason: ['名录导入', '发布前还缺：该届已结束', 理由], updated_by: '批量归档' });
    expect(后.version).toBe(原.version + 1);
    expect(db.find('audit_log', { action: '批量归档' })).toEqual([expect.objectContaining({ table_name: 'edition', record_id: 'ed-math-2025', created_at: 批量.at,
      detail: { 名称: '2025 年数学建模', 从: '待人工审核', 改成: '已归档', 理由, 操作人: '批量归档' } })]);
  });
  test('只归待人工审核的；人工定过状态的不动；没写理由、版本号对不上都不改', () => {
    const db = open(); seed(db);
    expect(() => 届次.待审归档(db, 'ed-math-2026', db.get('edition', 'ed-math-2026').version, { 理由 }, 批量)).toThrow('只归档待人工审核的');
    const 人工 = db.get('edition', 'ed-art-2026');
    db.update('edition', 'ed-art-2026', { manual_fields: ['status'] }, 人工.version);
    expect(() => 届次.待审归档(db, 'ed-art-2026', 人工.version + 1, { 理由 }, 批量)).toThrow('人工定的');
    const 原 = db.get('edition', 'ed-math-2025');
    expect(() => 届次.待审归档(db, 'ed-math-2025', 原.version, {}, 批量)).toThrow('理由');
    expect(() => 届次.待审归档(db, 'ed-math-2025', 原.version + 5, { 理由 }, 批量)).toThrow();
    expect(db.get('edition', 'ed-math-2025').data.status).toBe('待人工审核');
    expect(db.find('audit_log', { action: '批量归档' })).toEqual([]);
  });
});
