// 每日归档（2026-11-03 用户定：放在维护文件夹里，但自己每天跑一次，不走“每次一个比赛”的轮流）：
// 把报名已截止、还挂着已发布的届次全部改成已归档，并算出下一届大概什么时候报名。
// 规则照旧系统线上的 adminData/archiveSchedule.js、registrationSchedule.js、publicCache.js 的 registrationStatus；
// 金值是旧代码在同样输入上跑出来的（test/复用/旧代码金值.json，11-03 从美国服务器拷下的线上代码）。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../../test/复用/样例数据.mjs';
import { 要归档吗, 下一届预计, 每日归档 } from '../../index.mjs';
import 金值 from '../复用/旧代码金值.json' with { type: 'json' };

const 新状态 = { published: '已发布', archived: '已归档', draft: '待人工审核' };
// 旧记录 → 新比赛库的届次（字段名换成新的）
const 换成届次 = r => ({ id: r.id, edition_name: r.name, status: 新状态[r.dataStatus], ...r.schedule });
const NOW = new Date(金值.now);

describe('判断和推算：和旧代码一样', () => {
  test.each(金值.例子们.map((r, i) => [r.id, r, 金值.结果[i]]))('%s', (_名, 旧, 结果) => {
    const 届 = 换成届次(旧);
    expect(要归档吗(届, NOW)).toBe(结果.归档);
    if (结果.归档) expect(下一届预计(届)).toBe(结果.下一届预计);
  });
});

describe('每日归档（写比赛库）', () => {
  function 准备() {
    const db = open(); seed(db);
    db.transaction(tx => {
      tx.update('edition', 'ed-math-2026', { status: '已发布', registration_start: '2026-09-01', registration_end: '2026-10-31' }, tx.get('edition', 'ed-math-2026').version);
      tx.update('edition', 'ed-art-2026', { status: '已发布', registration_start: '2026-10-01', registration_end: '2026-12-01' }, tx.get('edition', 'ed-art-2026').version);
    });
    return db;
  }
  test('报名已截止的已发布届次全部归档，带下一届预计；没截止的不动', () => {
    const db = 准备();
    const 结果 = 每日归档(db, { now: NOW });
    expect(结果.归档了).toEqual([{ id: 'ed-math-2026', 名称: '2026 年数学建模', 下一届预计: '2027-09-01T00:00:00.000Z' }]);
    expect(结果.检查了).toBe(2);
    expect(db.get('edition', 'ed-math-2026').data).toMatchObject({ status: '已归档', next_edition_estimate: '2027-09-01T00:00:00.000Z', updated_by: '每日归档' });
    expect(db.get('edition', 'ed-art-2026').data.status).toBe('已发布');
    expect(每日归档(db, { now: NOW }).归档了).toEqual([]);   // 再跑一次没有要归的
  });
  test('试跑：只算不写', () => {
    const db = 准备();
    expect(每日归档(db, { now: NOW, 试跑: true }).归档了.map(x => x.id)).toEqual(['ed-math-2026']);
    expect(db.get('edition', 'ed-math-2026').data.status).toBe('已发布');
  });
});
