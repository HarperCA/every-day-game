// 校赛（2026-11-08 粗版本）：管理员申请、邀请码、本校学生、校赛的存取。选项 { now }。
// 只管存取；谁能做什么（是不是本校已通过的管理员、邀请码有没有效、长度）在 服务/校赛/ 检查。
//
// 管理员申请（school_admin，美国审核）
//   申请管理员(db, 用户id, { school, real_name, contact, proof }, 选项)   → 待审核的申请；同一用户同一学校待审核、已通过的已有就报 school_admin_already_applied
//   我的申请(db, 用户id)                    新的在前
//   是管理员(db, 用户id, 学校)               有已通过的申请 → true
//   管理的学校(db, 用户id)                   已通过的学校名
//   处理管理员申请(db, 编号, { status, review_note }, { 读到的更新时间, now })   美国审核结果写回（沟通/审核结果回传调）→ 改好的那一行
//     status 只能 已通过、已拒绝；读到的更新时间对不上报 feedback_conflict、找不到报 feedback_not_found（和 纠错.处理 一样，回传那边照样回 409、404）
// 邀请（school_invite，编号就是邀请码）
//   有效邀请(db, 管理员id, 学校, 选项)        这个管理员在这个学校没作废的邀请，没有就新建一个 → 邀请
//   换邀请(db, 管理员id, 学校, 选项)          旧的记作废时间，新建一个 → 新邀请
//   读邀请(db, 邀请码)                        → 邀请或 null
// 本校学生（school_member，不传美国）
//   加入(db, 用户id, { school, real_name, college, major, student_no, invite_code }, 选项)   同一用户同一学校只一行，再加入就更新信息（加入时间不变）
//   我的学校(db, 用户id)                      我是哪些学校的学生
//   学生名单(db, 学校)                        按加入时间先后
//   移出(db, 学校, 学生记录编号)              → { 删了 }（不是这个学校的不删）
//   退出(db, 用户id, 学校)                    → { 删了 }
// 校赛（school_contest，美国审核）
//   发布(db, 管理员id, 学校, { title, content, signup, start_date, end_date }, 选项)   → 待审核的校赛
//   读校赛(db, 编号)、学校的校赛(db, 学校)     后者新的在前，全部状态（管理员看）
//   已发布的(db, 学校们)                      这些学校里已发布的，新的在前（学生看）
//   下架(db, 编号)                             管理员自己下架 → 改好的那一行
//   处理校赛(db, 编号, { status, review_note }, { 读到的更新时间, now })   美国审核结果写回 → 改好的那一行；status 只能 已发布、已拒绝、已下架
import { randomBytes, randomUUID } from 'node:crypto';

// ---- 管理员申请 ----
export function 申请管理员(db, 用户id, { school, real_name, contact, proof }, { now = new Date() } = {}) {
  const at = now.toISOString();
  return db.transaction(tx => {
    if (tx.count('school_admin', { user: 用户id, school, status: { in: ['待审核', '已通过'] } })) throw new Error('school_admin_already_applied');
    return tx.insert('school_admin', `school-admin-${randomUUID()}`, { user: 用户id, school, real_name, contact, proof, created_at: at, updated_at: at }).data;
  });
}

export const 我的申请 = (db, 用户id) => db.find('school_admin', { user: 用户id }, { orderBy: '-created_at' });
export const 是管理员 = (db, 用户id, 学校) => db.count('school_admin', { user: 用户id, school: 学校, status: '已通过' }) > 0;
export const 管理的学校 = (db, 用户id) => [...new Set(db.find('school_admin', { user: 用户id, status: '已通过' }, { orderBy: 'created_at' }).map(a => a.school))];

// 美国审核结果写回：照 纠错.处理，读到的更新时间对不上说明别人刚改过，不覆盖
function 写回审核(db, 表, 编号, { status, review_note }, 读到的更新时间) {
  return db.transaction(tx => {
    const 原 = tx.get(表, 编号);
    if (!原) throw new Error('feedback_not_found');
    if (原.data.updated_at !== 读到的更新时间) throw new Error('feedback_conflict');
    const 改动 = { status };
    if (review_note !== undefined) 改动.review_note = review_note || null;
    return tx.update(表, 编号, 改动, 原.version).data;
  });
}

export function 处理管理员申请(db, 编号, { status, review_note } = {}, { 读到的更新时间 } = {}) {
  if (!['已通过', '已拒绝'].includes(status)) throw new Error('invalid_school_admin_status');
  return 写回审核(db, 'school_admin', 编号, { status, review_note }, 读到的更新时间);
}

// ---- 邀请 ----
const 新邀请码 = () => randomBytes(12).toString('base64url');   // 16 位，96 位随机，猜不到

function 新建邀请(tx, 管理员id, 学校, at) {
  return tx.insert('school_invite', 新邀请码(), { school: 学校, admin: 管理员id, created_at: at, revoked_at: null }).data;
}

export function 有效邀请(db, 管理员id, 学校, { now = new Date() } = {}) {
  return db.transaction(tx => {
    const [已有] = tx.find('school_invite', { admin: 管理员id, school: 学校, revoked_at: null }, { orderBy: '-created_at', limit: 1 });
    return 已有 || 新建邀请(tx, 管理员id, 学校, now.toISOString());
  });
}

export function 换邀请(db, 管理员id, 学校, { now = new Date() } = {}) {
  const at = now.toISOString();
  return db.transaction(tx => {
    for (const 旧 of tx.find('school_invite', { admin: 管理员id, school: 学校, revoked_at: null })) tx.update('school_invite', 旧.id, { revoked_at: at });
    return 新建邀请(tx, 管理员id, 学校, at);
  });
}

export const 读邀请 = (db, 邀请码) => db.get('school_invite', 邀请码)?.data ?? null;

// ---- 本校学生 ----
export function 加入(db, 用户id, { school, real_name, college, major, student_no, invite_code }, { now = new Date() } = {}) {
  const 信息 = { real_name, college, major, student_no, invite_code };
  return db.transaction(tx => {
    const [已有] = tx.find('school_member', { school, user: 用户id });
    if (已有) return tx.update('school_member', 已有.id, 信息).data;
    return tx.insert('school_member', `school-member-${randomUUID()}`, { school, user: 用户id, ...信息, joined_at: now.toISOString() }).data;
  });
}

export const 我的学校 = (db, 用户id) => db.find('school_member', { user: 用户id }, { orderBy: 'joined_at' });
export const 学生名单 = (db, 学校) => db.find('school_member', { school: 学校 }, { orderBy: 'joined_at' });

export function 移出(db, 学校, 学生记录编号) {
  return db.transaction(tx => {
    const 行 = tx.get('school_member', 学生记录编号)?.data;
    if (!行 || 行.school !== 学校) return { 删了: 0 };
    tx.remove('school_member', 学生记录编号);
    return { 删了: 1 };
  });
}

export function 退出(db, 用户id, 学校) {
  return db.transaction(tx => {
    const 行们 = tx.find('school_member', { school: 学校, user: 用户id });
    for (const 行 of 行们) tx.remove('school_member', 行.id);
    return { 删了: 行们.length };
  });
}

// ---- 校赛 ----
export function 发布(db, 管理员id, 学校, { title, content, signup = null, start_date = null, end_date = null }, { now = new Date() } = {}) {
  const at = now.toISOString();
  return db.insert('school_contest', `school-contest-${randomUUID()}`, {
    school: 学校, admin: 管理员id, title, content, signup: signup || null, start_date: start_date || null, end_date: end_date || null, created_at: at, updated_at: at,
  }).data;
}

export const 读校赛 = (db, 编号) => db.get('school_contest', 编号)?.data ?? null;
export const 学校的校赛 = (db, 学校) => db.find('school_contest', { school: 学校 }, { orderBy: '-created_at' });
export const 已发布的 = (db, 学校们) => (学校们.length
  ? db.find('school_contest', { school: { in: 学校们 }, status: '已发布' }, { orderBy: '-created_at' }) : []);

export function 下架(db, 编号) {
  return db.transaction(tx => {
    const 原 = tx.get('school_contest', 编号);
    if (!原) throw new Error('school_contest_not_found');
    return tx.update('school_contest', 编号, { status: '已下架' }, 原.version).data;
  });
}

export function 处理校赛(db, 编号, { status, review_note } = {}, { 读到的更新时间 } = {}) {
  if (!['已发布', '已拒绝', '已下架'].includes(status)) throw new Error('invalid_school_contest_status');
  return 写回审核(db, 'school_contest', 编号, { status, review_note }, 读到的更新时间);
}
