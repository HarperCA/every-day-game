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
