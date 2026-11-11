// 校赛服务（2026-11-08 粗版本，后续再细化）：说明见同目录 README.md。存取全部调副数据库的 校赛.*。
// 身份：入口校验令牌后交进 openid，这里按 openid 找账号；请求里自己写的 openid 不认。
//
//   handle({ action, ...参数 }, { 用户库, openid, now }) → { ok: true, data } 或 { ok: false, message }
import { 用户, 校赛 } from '../../副数据库/index.mjs';

// ---- 输入校验 ----
const 上限 = { school: 100, realName: 50, contact: 100, proof: 1000, college: 100, major: 100, studentNo: 40, title: 100, content: 2000, signup: 500 };
const 蛇形 = 字段 => 字段.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);   // realName → real_name，报错名照 invalid_real_name

function 必填(值, 字段) {
  if (typeof 值 !== 'string' || !值.trim()) throw new Error(`invalid_${蛇形(字段)}`);
  return 限长(值.trim(), 字段);
}
function 选填(值, 字段) {
  if (值 == null || 值 === '') return null;
  if (typeof 值 !== 'string') throw new Error(`invalid_${蛇形(字段)}`);
  return 值.trim() ? 限长(值.trim(), 字段) : null;
}
function 限长(文字, 字段) {
  if ([...文字].length > 上限[字段]) throw new Error(`${蛇形(字段)}_too_long`);
  return 文字;
}
function 日期(值, 字段) {
  if (值 == null || 值 === '') return null;
  if (typeof 值 !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(值) || Number.isNaN(Date.parse(值))) throw new Error(`invalid_${蛇形(字段)}`);
  return 值;
}

// ---- 交回小程序的格式 ----
const 申请给小程序 = a => ({ id: a.id, school: a.school, realName: a.real_name, contact: a.contact, proof: a.proof, status: a.status,
  reviewNote: a.review_note || '', createdAt: a.created_at, updatedAt: a.updated_at });
const 学生给小程序 = m => ({ id: m.id, school: m.school, realName: m.real_name, college: m.college, major: m.major, studentNo: m.student_no, joinedAt: m.joined_at });
const 校赛给管理员 = c => ({ id: c.id, school: c.school, title: c.title, content: c.content, signup: c.signup || '', startDate: c.start_date || '', endDate: c.end_date || '',
  status: c.status, reviewNote: c.review_note || '', createdAt: c.created_at, updatedAt: c.updated_at });
const 校赛给学生 = c => ({ id: c.id, school: c.school, title: c.title, content: c.content, signup: c.signup || '', startDate: c.start_date || '', endDate: c.end_date || '' });

// ---- 身份 ----
function 当前用户(用户库, openid) {
  if (!openid) throw new Error('unauthenticated');
  const 账号 = 用户.按openid(用户库, openid);
  if (!账号) throw new Error('unauthenticated');
  if (账号.status !== 'active') throw new Error('user_account_disabled');
  return 账号.id;
}
// 本校已通过的管理员才行 → 学校名
function 要管理员(用户库, userId, school) {
  const 学校 = 必填(school, 'school');
  if (!校赛.是管理员(用户库, userId, 学校)) throw new Error('not_school_admin');
  return 学校;
}

const 动作 = {
  // 申请管理员 → 待审核（同步到美国审核）
  applyAdmin(e, { 用户库, userId, now }) {
    const 申请 = 校赛.申请管理员(用户库, userId, {
      school: 必填(e.school, 'school'), real_name: 必填(e.realName, 'realName'), contact: 必填(e.contact, 'contact'), proof: 必填(e.proof, 'proof'),
    }, { now });
    return { application: 申请给小程序(申请) };
  },
  myStatus(e, { 用户库, userId }) {
    return {
      adminSchools: 校赛.管理的学校(用户库, userId),
      applications: 校赛.我的申请(用户库, userId).map(申请给小程序),
      memberships: 校赛.我的学校(用户库, userId).map(学生给小程序),
    };
  },

  // ---- 管理员 ----
  createInvite(e, { 用户库, userId, now }) {
    const 学校 = 要管理员(用户库, userId, e.school);
    return { inviteCode: 校赛.有效邀请(用户库, userId, 学校, { now }).id, school: 学校 };
  },
  renewInvite(e, { 用户库, userId, now }) {
    const 学校 = 要管理员(用户库, userId, e.school);
    return { inviteCode: 校赛.换邀请(用户库, userId, 学校, { now }).id, school: 学校 };
  },
  listMembers(e, { 用户库, userId }) {
    const items = 校赛.学生名单(用户库, 要管理员(用户库, userId, e.school)).map(学生给小程序);
    return { items, total: items.length };
  },
  removeMember(e, { 用户库, userId }) {
    const 学校 = 要管理员(用户库, userId, e.school);
    return { removed: 校赛.移出(用户库, 学校, 必填(e.memberId, 'memberId')).删了 };
  },
  publishContest(e, { 用户库, userId, now }) {
    const 学校 = 要管理员(用户库, userId, e.school);
    const start_date = 日期(e.startDate, 'startDate');
    const end_date = 日期(e.endDate, 'endDate');
    if (start_date && end_date && end_date < start_date) throw new Error('invalid_date_range');
    const 赛 = 校赛.发布(用户库, userId, 学校, {
      title: 必填(e.title, 'title'), content: 必填(e.content, 'content'), signup: 选填(e.signup, 'signup'), start_date, end_date,
    }, { now });
    return { contest: 校赛给管理员(赛) };
  },
  myContests(e, { 用户库, userId }) {
    return { items: 校赛.学校的校赛(用户库, 要管理员(用户库, userId, e.school)).map(校赛给管理员) };
  },
  withdrawContest(e, { 用户库, userId }) {
    const 赛 = 校赛.读校赛(用户库, 必填(e.contestId, 'contestId'));
    if (!赛) throw new Error('school_contest_not_found');
    要管理员(用户库, userId, 赛.school);
    if (赛.status === '已下架') return { contest: 校赛给管理员(赛) };
    return { contest: 校赛给管理员(校赛.下架(用户库, 赛.id)) };
  },

  // ---- 学生 ----
  joinSchool(e, { 用户库, userId, now }) {
    const 码 = 必填(e.inviteCode, 'inviteCode').slice(0, 64);
    const 信息 = { real_name: 必填(e.realName, 'realName'), college: 必填(e.college, 'college'), major: 必填(e.major, 'major'), student_no: 必填(e.studentNo, 'studentNo') };
    const 邀请 = 校赛.读邀请(用户库, 码);
    // 作废的、发邀请的人已不是本校管理员的，都不认
    if (!邀请 || 邀请.revoked_at || !校赛.是管理员(用户库, 邀请.admin, 邀请.school)) throw new Error('invite_invalid');
    const 行 = 校赛.加入(用户库, userId, { school: 邀请.school, ...信息, invite_code: 邀请.id }, { now });
    return { membership: 学生给小程序(行) };
  },
  leaveSchool(e, { 用户库, userId }) {
    return { left: 校赛.退出(用户库, userId, 必填(e.school, 'school')).删了 };
  },

  // ---- 本校校赛：所在学校（作为学生或管理员）里已发布的 ----
  listSchoolContests(e, { 用户库, userId }) {
    const 学校们 = [...new Set([...校赛.我的学校(用户库, userId).map(m => m.school), ...校赛.管理的学校(用户库, userId)])];
    return { items: 校赛.已发布的(用户库, 学校们).map(校赛给学生) };
  },
};

const 不记日志 = ['unauthenticated', 'user_account_disabled', 'unsupported_action', 'not_school_admin', 'invite_invalid', 'school_admin_already_applied'];

export async function handle(request = {}, { 用户库, openid, now = () => new Date() } = {}) {
  const { action, ...event } = request;
  try {
    const userId = 当前用户(用户库, openid);
    const 这个 = Object.hasOwn(动作, action) ? 动作[action] : null;
    if (!这个) throw new Error('unsupported_action');
    return { ok: true, data: 这个(event, { 用户库, userId, now: now() }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'school_failed';
    if (!不记日志.includes(message) && !/^invalid_|_too_long$/.test(message)) console.error('[校赛] 出错', { action, error: message });
    // 数据库报错（校验不通过等）不把细节回给小程序
    return { ok: false, message: error?.kind ? 'school_failed' : message };
  }
}
