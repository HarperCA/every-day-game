// 组队（2026-11-08，11-09 改）：队伍、队员、组队申请、组队通知次数四张表的存取。只管存取，谁能做什么（只有队长能处理、满员不能再加……）在 服务/组队/。
// 第一个参数可以是库，也可以是 db.transaction(tx => …) 里的 tx：服务把“先查再写”放在一个事务里。选项 { now }。
//   建队(db, 队长id, { competition_id, max_members, leader_wechat, name }, 选项)  建队伍，队长同时记成队员（角色 leader）→ 队伍
//   读队(db, 队id)                     → 队伍（带 version）或 null
//   改队(db, 队id, 改动, 版本号)        要带读到的版本号，对不上报“版本冲突” → 队伍
//   换队长(db, 队id, 新队长id, 版本号)   队伍挂到新队长名下、队长微信号清空，两人角色互换；新队长不是本队队员报错 → 队伍
//   解散(db, 队id)                      队伍、队员、申请一起删掉（按描述里的“指向”连带删）→ { 连带 }
//   队员们(db, 队id)                    按加入先后
//   是队员(db, 队id, 用户id)            → 队员记录或 null
//   我参加的(db, 用户id)                我在里面的队伍（含当队长的），新建的在前
//   加队员(db, 队id, 用户id, 选项)       角色 member；同一人同一队只能一条（数据库唯一约束）
//   删队员(db, 队id, 用户id)            → { 删了 }
//   新申请(db, 队id, 申请人id, { major, grade, intro, strengths }, 选项)  待审；介绍、擅长方向空的存 null → 申请
//   读申请(db, 申请id)                  → 申请或 null
//   改申请(db, 申请id, 改动, 选项)        改状态、处理人 → 申请
//   申请们(db, 条件)                    按条件（team_id、status、user_id）列，早申请的在前
//   我发出的(db, 用户id)                新申请的在前
//   通知次数(db, 用户id)                “有人申请入队”的订阅消息还能发几条，没记过是 0
//   加通知次数(db, 用户id, 上限, 选项)   加一次，到上限不再加 → 现在的次数
//   扣通知次数(db, 用户id, 选项)         有次数扣一次 → true；没有 → false
//   清零通知次数(db, 用户id, 选项)       微信说用户没授权时清零
import { randomUUID } from 'node:crypto';

export function 建队(db, 队长id, { competition_id, max_members, leader_wechat, name = null }, { now = new Date() } = {}) {
  const at = now.toISOString();
  return db.transaction(tx => {
    const 队 = tx.insert('team', `team-${randomUUID()}`, { competition_id, user_id: 队长id, max_members, leader_wechat, name, created_at: at, updated_at: at }).data;
    tx.insert('team_member', `team-member-${randomUUID()}`, { team_id: 队.id, user_id: 队长id, role: 'leader', joined_at: at });
    return 队;
  });
}

export const 读队 = (db, 队id) => db.get('team', 队id)?.data ?? null;
export const 改队 = (db, 队id, 改动, 版本号) => db.update('team', 队id, 改动, 版本号).data;

export function 换队长(db, 队id, 新队长id, 版本号) {
  return db.transaction(tx => {
    const 新 = 是队员(tx, 队id, 新队长id);
    if (!新) throw new Error('新队长不是本队队员');
    const 队 = 改队(tx, 队id, { user_id: 新队长id, leader_wechat: null }, 版本号);
    for (const m of 队员们(tx, 队id)) {
      const role = m.user_id === 新队长id ? 'leader' : 'member';
      if (m.role !== role) tx.update('team_member', m.id, { role });
    }
    return 队;
  });
}

export function 解散(db, 队id) {
  const { 连带 } = db.彻底删除('team', 队id);
  return { 连带 };
}

export const 队员们 = (db, 队id) => db.find('team_member', { team_id: 队id }, { orderBy: 'joined_at' });
export const 是队员 = (db, 队id, 用户id) => db.find('team_member', { team_id: 队id, user_id: 用户id })[0] ?? null;

export function 我参加的(db, 用户id) {
  return db.find('team_member', { user_id: 用户id }).map(m => 读队(db, m.team_id)).filter(Boolean)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function 加队员(db, 队id, 用户id, { now = new Date() } = {}) {
  return db.insert('team_member', `team-member-${randomUUID()}`, { team_id: 队id, user_id: 用户id, role: 'member', joined_at: now.toISOString() }).data;
}

export function 删队员(db, 队id, 用户id) {
  return db.transaction(tx => {
    const 要删 = tx.find('team_member', { team_id: 队id, user_id: 用户id });
    for (const m of 要删) tx.remove('team_member', m.id);
    return { 删了: 要删.length };
  });
}

export function 新申请(db, 队id, 申请人id, { major, grade, intro = null, strengths = null }, { now = new Date() } = {}) {
  const at = now.toISOString();
  return db.insert('team_application', `team-application-${randomUUID()}`, {
    team_id: 队id, user_id: 申请人id, major, grade, intro: intro || null, strengths: strengths || null, created_at: at, updated_at: at,
  }).data;
}

export const 读申请 = (db, 申请id) => db.get('team_application', 申请id)?.data ?? null;

export function 改申请(db, 申请id, 改动, { now = new Date() } = {}) {
  return db.update('team_application', 申请id, { ...改动, updated_at: now.toISOString() }).data;
}

export const 申请们 = (db, 条件) => db.find('team_application', 条件, { orderBy: 'created_at' });
export const 我发出的 = (db, 用户id) => db.find('team_application', { user_id: 用户id }, { orderBy: '-created_at' });

// ---- 组队通知次数 ----
export const 通知次数 = (db, 用户id) => db.get('team_notify_quota', 用户id)?.data.apply_quota ?? 0;

function 存通知次数(db, 用户id, 次数, now) {
  const at = now.toISOString();
  if (db.get('team_notify_quota', 用户id)) db.update('team_notify_quota', 用户id, { apply_quota: 次数, updated_at: at });
  else db.insert('team_notify_quota', 用户id, { user_id: 用户id, apply_quota: 次数, updated_at: at });
  return 次数;
}

export function 加通知次数(db, 用户id, 上限, { now = new Date() } = {}) {
  return db.transaction(tx => 存通知次数(tx, 用户id, Math.min(上限, 通知次数(tx, 用户id) + 1), now));
}

export function 扣通知次数(db, 用户id, { now = new Date() } = {}) {
  return db.transaction(tx => {
    const 有 = 通知次数(tx, 用户id);
    if (有 <= 0) return false;
    存通知次数(tx, 用户id, 有 - 1, now);
    return true;
  });
}

export function 清零通知次数(db, 用户id, { now = new Date() } = {}) {
  return 存通知次数(db, 用户id, 0, now);
}
