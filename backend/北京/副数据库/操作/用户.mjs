// 用户（一级）的新建、读取、停用、删除，以及一次读出一个用户的全部记录。选项 { now }。
//   新建或登录(db, { openid, appid, unionid }, 选项)  有账号就记登录时间，没有就建一个 → 账号；停用的报错
//   读取(db, id)、按openid(db, openid)                 → 账号或 null
//   停用(db, id, 选项)
//   改资料(db, id, { nickname, avatar_url }, 选项)     昵称、头像网址（2026-11-09，组队里给队友看）；给 null 清掉；只改给了的键 → 账号
//   资料们(db, 编号们)                                 → Map(编号 → { nickname, avatarUrl })，没有的编号不出现（队员列表一次取）
//   全部(db, id)                                       → { 账号, 收藏, 提醒, 意见反馈, 纠错, 偏好 }
//   删除(db, id)                                       注销：账号和它下面五张表的记录一起删 → { 连带: { 表: 条数 } }
// openid 只能由服务端向微信换来后传进来，不收客户端传的。
import { randomUUID } from 'node:crypto';
import * as 收藏 from './收藏.mjs';
import * as 提醒 from './提醒.mjs';
import * as 意见反馈 from './意见反馈.mjs';
import * as 纠错 from './纠错.mjs';
import * as 偏好 from './偏好.mjs';

export function 新建或登录(db, { openid, appid = null, unionid = null }, { now = new Date() } = {}) {
  const at = now.toISOString();
  return db.transaction(tx => {
    const [已有] = tx.find('user_account', { openid });
    if (已有) {
      if (已有.status !== 'active') throw new Error('账号已停用');
      return tx.update('user_account', 已有.id, { last_login_at: at, updated_at: at }).data;
    }
    return tx.insert('user_account', `user-${randomUUID()}`, { openid, appid, unionid, created_at: at, updated_at: at, last_login_at: at }).data;
  });
}

export const 读取 = (db, id) => db.get('user_account', id)?.data ?? null;
export const 按openid = (db, openid) => db.find('user_account', { openid })[0] ?? null;

export function 停用(db, id, { now = new Date() } = {}) {
  return db.update('user_account', id, { status: 'disabled', updated_at: now.toISOString() }).data;
}

export function 改资料(db, id, 资料, { now = new Date() } = {}) {
  const 改动 = Object.fromEntries(['nickname', 'avatar_url'].filter(k => k in 资料).map(k => [k, 资料[k] || null]));
  return db.update('user_account', id, { ...改动, updated_at: now.toISOString() }).data;
}

export function 资料们(db, 编号们) {
  const 资料 = new Map();
  for (const id of new Set(编号们)) {
    const 账号 = 读取(db, id);
    if (账号) 资料.set(id, { nickname: 账号.nickname ?? null, avatarUrl: 账号.avatar_url ?? null });
  }
  return 资料;
}

export function 全部(db, id) {
  return {
    账号: 读取(db, id),
    收藏: 收藏.列出(db, id),
    提醒: 提醒.列出(db, id),
    意见反馈: 意见反馈.列出(db, id),
    纠错: 纠错.列出(db, id),
    偏好: 偏好.读取(db, id),
  };
}

export function 删除(db, id) {
  const { 连带 } = db.彻底删除('user_account', id);
  return { 连带 };
}
