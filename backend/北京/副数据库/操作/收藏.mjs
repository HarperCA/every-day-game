// 收藏：只存比赛编号。选项 { now }。
//   加(db, 用户id, 比赛id, 选项)    已收藏的不重复存 → { 收藏了: true }
//   取消(db, 用户id, 比赛id)        没收藏的也不报错 → { 收藏了: false }
//   编号们(db, 用户id)              收藏的比赛编号，新收藏的在前（排序第 ④ 条用）
//   列出(db, 用户id)                收藏记录，新收藏的在前
import { randomUUID } from 'node:crypto';

export function 加(db, 用户id, 比赛id, { now = new Date() } = {}) {
  db.transaction(tx => {
    if (tx.find('favorite', { user_id: 用户id, competition_id: 比赛id }).length) return;
    tx.insert('favorite', `favorite-${randomUUID()}`, { user_id: 用户id, competition_id: 比赛id, created_at: now.toISOString() });
  });
  return { 收藏了: true };
}

export function 取消(db, 用户id, 比赛id) {
  db.transaction(tx => {
    for (const f of tx.find('favorite', { user_id: 用户id, competition_id: 比赛id })) tx.remove('favorite', f.id);
  });
  return { 收藏了: false };
}

export const 列出 = (db, 用户id) => db.find('favorite', { user_id: 用户id }, { orderBy: '-created_at' });
export const 编号们 = (db, 用户id) => 列出(db, 用户id).map(f => f.competition_id);
