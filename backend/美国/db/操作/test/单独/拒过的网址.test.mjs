// 拒过的网址：读 30 天内拒过的、清掉超过 30 天的。用内存里的库跑，不碰任何真实库文件。
import { describe, expect, test } from 'vitest';
import { open } from '../../../test/复用/样例数据.mjs';
import { 拒过的网址 } from '../../../index.mjs';

const 天 = 86400000;
const now = new Date('2026-10-29T12:00:00.000Z');
const 天前 = n => new Date(now.getTime() - n * 天).toISOString();

function 放几条(db) {
  db.transaction(tx => {
    tx.insert('rejected_url', 'r1', { url: 'https://a.cn/1', url_key: 'a.cn/1', title: '无关页面', reason: '不是比赛', module: '03-filter', run_id: '2026-10-28', rejected_at: 天前(1) });
    tx.insert('rejected_url', 'r2', { url: 'https://b.cn/2', url_key: 'b.cn/2', reason: '审核没通过', module: '05-review', rejected_at: 天前(29) });
    tx.insert('rejected_url', 'r3', { url: 'https://c.cn/3', url_key: 'c.cn/3', reason: '不是比赛', module: '03-filter', rejected_at: 天前(31) });
  });
}

describe('拒过的网址', () => {
  test(`保留 ${拒过的网址.保留天数} 天`, () => {
    expect(拒过的网址.保留天数).toBe(30);
  });
  test('近期：只取 30 天内拒过的，新的在前', () => {
    const db = open(); 放几条(db);
    expect(拒过的网址.近期(db, { now }).map(r => r.url_key)).toEqual(['a.cn/1', 'b.cn/2']);
  });
  test('清理过期：删掉超过 30 天的，交回删了几条', () => {
    const db = open(); 放几条(db);
    expect(拒过的网址.清理过期(db, { now })).toBe(1);
    expect(db.count('rejected_url')).toBe(2);
    expect(db.get('rejected_url', 'r3')).toBeNull();
  });
});
