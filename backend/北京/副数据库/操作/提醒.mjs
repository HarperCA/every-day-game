// 提醒：挂届次，提醒编号由小程序生成。选项 { now }。
//   保存(db, 用户id, 内容, 选项)       没有就加（发送状态、授权状态、时间变动有默认值），有就改；别人的提醒报错
//   删除(db, 用户id, 提醒id)           → { 删了 }
//   删届次的(db, 用户id, 届次id)        这一届的全部提醒 → { 删了 }
//   列出(db, 用户id)                   按提醒时间先后
//   届次编号们(db, 用户id)              设了提醒的届次编号，不重复（排序第 ④ 条用）
//   到期(db, now)                      到时间、还待发送的，按时间先后（发提醒服务用）
export function 保存(db, 用户id, 内容, { now = new Date() } = {}) {
  const at = now.toISOString();
  const { id, created_at: _c, user_id: _u, ...其余 } = 内容;
  return db.transaction(tx => {
    const 已有 = tx.get('reminder', id)?.data;
    if (已有 && 已有.user_id !== 用户id) throw new Error(`不是这个用户的提醒：${id}`);
    if (已有) return tx.update('reminder', id, { ...其余, updated_at: at }).data;
    return tx.insert('reminder', id, { ...其余, user_id: 用户id, created_at: at, updated_at: at }).data;
  });
}

function 删掉(db, 条件) {
  return db.transaction(tx => {
    const 要删 = tx.find('reminder', 条件);
    for (const r of 要删) tx.remove('reminder', r.id);
    return { 删了: 要删.length };
  });
}
export const 删除 = (db, 用户id, 提醒id) => 删掉(db, { user_id: 用户id, id: 提醒id });
export const 删届次的 = (db, 用户id, 届次id) => 删掉(db, { user_id: 用户id, edition_id: 届次id });

export const 列出 = (db, 用户id) => db.find('reminder', { user_id: 用户id }, { orderBy: 'remind_at' });
export const 届次编号们 = (db, 用户id) => [...new Set(列出(db, 用户id).map(r => r.edition_id))];
export const 到期 = (db, now = new Date()) => db.find('reminder', { delivery_status: 'pending', remind_at: { lte: now.toISOString() } }, { orderBy: 'remind_at' });
