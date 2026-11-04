// 届次对照：每一届属于哪个比赛（含已删除的），给北京搬旧用户数据时把旧收藏（挂届次）改挂比赛用（2026-11-02）。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../test/复用/样例数据.mjs';
import { 届次 } from '../../../index.mjs';
import { 届次对照 } from '../../届次对照.mjs';

describe('届次对照', () => {
  test('全部届次 → 比赛编号，回收站里的也算（旧收藏可能挂在后来删掉的届次上）', () => {
    const db = open(); seed(db);
    届次.删除(db, 'ed-art-next', { 操作人: '测试', at: '2026-11-02T00:00:00.000Z' });
    expect(届次对照(db)).toEqual({ 'ed-math-2025': 'event-math', 'ed-math-2026': 'event-math', 'ed-art-2026': 'event-art', 'ed-art-next': 'event-art' });
  });
});
