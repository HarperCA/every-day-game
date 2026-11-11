// 组队（2026-11-08 粗版本，11-09 按用户定的规则改）。说明见同目录 README.md。
// 流程：比赛里建队 → 转发卡片 → 别人点卡片发申请（专业、年级必填）→ 给队长发订阅消息 → 队长在“待我处理”里看到申请 → 通过即入队。
// 队长的微信号、队员列表（含昵称头像）只给队员看；非队员打开卡片只看到比赛名、队伍名、人数上限、已有几人。同步靠小程序每次打开组队页调 listMyTeams、listPendingForMe。
// 队伍一直保留，队长手动解散；解散直接删掉队伍、队员、申请。
//
//   handle({ action, ...参数 }, { 用户库, 主库, openid, now, 发订阅消息, 通知模板, log }) → { ok: true, data } 或 { ok: false, message }
//     发订阅消息(payload) → 微信的回复（{ errcode: 0 } 算成功；{ uncertain } 是请求发出但没拿到结果）；北京入口用 发提醒/调度.mjs 的 createWeChatSender
//     通知模板：{ id, 字段 }，默认按环境变量读（读通知模板）；null 就不发
//   动作（参数 → data）：
//     createTeam          { competitionId, maxMembers(2–15), wechat, name? }  → { team }
//     getTeam             { teamId }                       → { team }（非队员看简版）
//     listMyTeams         {}                               → { teams }（我参加的，含当队长的）
//     applyToTeam         { teamId, major, grade, intro?, strengths? } → { application }（成功后给队长发订阅消息，发不发、发没发成都不影响申请）
//     withdrawApplication { applicationId }                → { application }
//     listMyApplications  {}                               → { items }（我发出的，带队伍简版）
//     listPendingForMe    {}                               → { items: [{ team, application }] }（只有队长：本队全部待审；不是队长交回空列表）
//     decideApplication   { applicationId, decision: approve|reject } → { application, team }（只有队长；满员不能通过）
//     renameTeam          { teamId, name }                 → { team }（只有队长；可以清空）
//     setMaxMembers       { teamId, maxMembers(2–15) }     → { team }（只有队长；不能小于现在的人数）
//     setWechat           { teamId, wechat }               → { team }（只有队长；转让后新队长补微信号用）
//     transferCaptain     { teamId, userId }               → { team }（只有队长；转给本队队员，原队长变队员，队长微信号清空）
//     removeMember        { teamId, userId }               → { team }（只有队长；不能踢自己）
//     disbandTeam         { teamId }                       → { disbanded: true }（只有队长；队伍、队员、申请都删掉）
//     leaveTeam           { teamId }                       → { left: true }（队员；队长要退请先转让或解散）
//     addSubscribeQuota   {}                               → { quota }（小程序 wx.requestSubscribeMessage 用户接受后调，记一次可发次数，上限 50）
//     getSubscribeQuota   {}                               → { quota, templateId }（templateId 没配是 null，小程序据此决定要不要弹订阅）
import { createRequire } from 'node:module';
import { 公开 } from '../../主数据库/index.mjs';
import { 用户, 组队 } from '../../副数据库/index.mjs';

const require = createRequire(import.meta.url);
// 北京时间格式和提醒的订阅消息共用（“2026年11月08日 10:00”）
const { formatShanghaiTime } = require('../发提醒/reminderDelivery.js');

// 长度上限（按字数）。表描述里也有同样的上限兜底
const 上限 = { wechat: 50, name: 50, major: 30, grade: 20, intro: 200, strengths: 50 };
const 人数 = { 最少: 2, 最多: 15 };
const 每人最多当队长的队 = 20;
const 每人最多待审申请 = 30;
const 通知次数上限 = 50;
// 订阅消息点开到小程序的“申请”页（new-apps/miniprogram/app.json 里有这一页）
const 通知落地页 = 'pages/team-applications/team-applications';
const 通知字段们 = ['比赛', '队伍', '申请人', '时间'];

// 订阅消息模板：TEAM_APPLY_TEMPLATE_ID 是模板编号；TEAM_APPLY_TEMPLATE_FIELDS 写模板里每项的键，例如 “比赛=thing1,队伍=thing2,申请人=thing3,时间=time4”
// （模板还没申请，键要按申请到的模板填）。两个都配了才发，缺一个交回 null（不发、只记日志）
export function 读通知模板(env = process.env) {
  const id = String(env.TEAM_APPLY_TEMPLATE_ID || '').trim();
  const 字段 = {};
  for (const 段 of String(env.TEAM_APPLY_TEMPLATE_FIELDS || '').split(',')) {
    const [名, 键] = 段.split('=').map(x => (x || '').trim());
    if (通知字段们.includes(名) && /^[a-z_]+\d+$/.test(键)) 字段[名] = 键;
  }
  if (!id || !Object.keys(字段).length) return null;
  return { id, 字段 };
}

// ---- 输入检查 ----
function 文字(value, field, { 必填 = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  const v = value.trim();
  if ((必填 && !v) || [...v].length > 上限[field]) throw new Error(`invalid_${field}`);
  return v;
}
function 编号(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new Error(`invalid_${field}`);
  return value.trim();
}
function 人数上限(value) {
  if (!Number.isInteger(value) || value < 人数.最少 || value > 人数.最多) throw new Error('invalid_max_members');
  return value;
}

function 当前用户(用户库, openid) {
  if (!openid) throw new Error('unauthenticated');
  const 账号 = 用户.按openid(用户库, openid);
  if (!账号) throw new Error('unauthenticated');
  if (账号.status !== 'active') throw new Error('user_account_disabled');
  return 账号.id;
}

// ---- 交回小程序的格式 ----
const 比赛名 = (主库, id) => 公开.比赛(主库, id)?.name ?? null;

// 队伍：队员看全部（微信号、队员列表带昵称头像）；非队员只看简版
function 队伍给看(env, 队, userId) {
  const 队员 = 组队.队员们(env.用户库, 队.id);
  const 我 = 队员.find(m => m.user_id === userId);
  const 简版 = {
    id: 队.id, competitionId: 队.competition_id, competitionName: 比赛名(env.主库, 队.competition_id), name: 队.name || '',
    maxMembers: 队.max_members, memberCount: 队员.length, createdAt: 队.created_at,
    isMember: Boolean(我), isLeader: 我?.role === 'leader',
  };
  if (!我) return 简版;
  const 资料 = 用户.资料们(env.用户库, 队员.map(m => m.user_id));
  // 队长排第一，其余按加入先后
  const 排好 = [...队员].sort((a, b) => Number(b.role === 'leader') - Number(a.role === 'leader'));
  return { ...简版, version: 队.version, wechat: 队.leader_wechat || '',
    members: 排好.map(m => ({ userId: m.user_id, role: m.role, joinedAt: m.joined_at, isMe: m.user_id === userId,
      nickname: 资料.get(m.user_id)?.nickname || '', avatarUrl: 资料.get(m.user_id)?.avatarUrl || '' })) };
}

// 申请：给队长看时带申请人的昵称头像（申请人主动申请，队长要知道是谁）
function 申请给看(env, 申, userId, { 给队长 = false } = {}) {
  const 看 = { id: 申.id, teamId: 申.team_id, applicantId: 申.user_id, major: 申.major, grade: 申.grade, intro: 申.intro || '', strengths: 申.strengths || '',
    status: 申.status, createdAt: 申.created_at, updatedAt: 申.updated_at, handledAt: 申.handled_at || null, isMine: 申.user_id === userId };
  if (给队长) {
    const 资料 = 用户.资料们(env.用户库, [申.user_id]).get(申.user_id);
    看.applicant = { nickname: 资料?.nickname || '', avatarUrl: 资料?.avatarUrl || '' };
  }
  return 看;
}

// ---- 查找 ----
function 找队(db, teamId) {
  const 队 = 组队.读队(db, 编号(teamId, 'team_id'));
  if (!队) throw new Error('team_not_found');
  return 队;
}
function 找申请(db, applicationId) {
  const 申 = 组队.读申请(db, 编号(applicationId, 'application_id'));
  if (!申) throw new Error('application_not_found');
  return 申;
}
const 待审 = 申 => { if (申.status !== 'pending') throw new Error('application_not_pending'); };
// 只有队长能做：找到队、核对我是队长
function 我当队长的队(db, teamId, userId) {
  const 队 = 找队(db, teamId);
  if (队.user_id !== userId) throw new Error('not_team_leader');
  return 队;
}

// ---- 订阅消息：有人申请时通知队长 ----
// 发出去不等结果（微信慢时申请不跟着卡）。先扣一次再发：并发的两条申请不会用同一次授权；
// 微信说用户没授权（43101）→ 次数清零；别的明确失败 → 退回这一次；结果不明（uncertain）→ 不退（微信可能已经发了）
function 通知队长(env, 队, 申) {
  const { 用户库, 发订阅消息, 通知模板, log } = env;
  if (!通知模板) { log('[组队] 没配 TEAM_APPLY_TEMPLATE_ID / TEAM_APPLY_TEMPLATE_FIELDS，新申请不发订阅消息', 队.id); return; }
  if (typeof 发订阅消息 !== 'function') { log('[组队] 没接微信发送，新申请不发订阅消息', 队.id); return; }
  const 队长 = 用户.读取(用户库, 队.user_id);
  if (!队长?.openid || 队长.status !== 'active') return;
  if (!组队.扣通知次数(用户库, 队长.id, { now: env.now })) return;
  const 截 = (v, n = 20) => [...String(v || '')].slice(0, n).join('');
  const 值 = { 比赛: 截(比赛名(env.主库, 队.competition_id) || '大学生竞赛'), 队伍: 截(队.name || '未命名队伍'),
    申请人: 截(`${申.grade} ${申.major}`), 时间: formatShanghaiTime(申.created_at) };
  const payload = {
    touser: 队长.openid, template_id: 通知模板.id, page: 通知落地页, miniprogram_state: process.env.MINIPROGRAM_STATE || 'formal', lang: 'zh_CN',
    data: Object.fromEntries(Object.entries(通知模板.字段).map(([名, 键]) => [键, { value: 值[名] }])),
  };
  const 退回 = () => 组队.加通知次数(用户库, 队长.id, 通知次数上限, { now: env.now });
  Promise.resolve().then(() => 发订阅消息(payload)).then(结果 => {
    if (结果?.errcode === 0) return;
    if (结果?.uncertain) { log('[组队] 订阅消息结果不明', 队.id, 结果.error || ''); return; }
    log('[组队] 订阅消息没发成', 队.id, 结果?.errcode ?? '', 结果?.errmsg || '');
    if (结果?.errcode === 43101) 组队.清零通知次数(用户库, 队长.id, { now: env.now });
    else 退回();
  }).catch(error => {
    log('[组队] 订阅消息出错', 队.id, String(error?.message || error));
    try { 退回(); } catch { /* 队长这时注销了之类，不管 */ }
  });
}

// ---- 动作 ----
const 动作 = {
  createTeam(event, env) {
    const competitionId = 编号(event.competitionId, 'competition_id');
    if (!公开.比赛(env.主库, competitionId)) throw new Error('competition_not_found');
    const n = 人数上限(event.maxMembers);
    const wechat = 文字(event.wechat, 'wechat', { 必填: true });
    const name = 文字(event.name, 'name');
    if (env.用户库.count('team', { user_id: env.userId }) >= 每人最多当队长的队) throw new Error('team_limit_exceeded');
    const 队 = 组队.建队(env.用户库, env.userId, { competition_id: competitionId, max_members: n, leader_wechat: wechat, name: name || null }, { now: env.now });
    return { team: 队伍给看(env, 队, env.userId) };
  },

  getTeam(event, env) {
    return { team: 队伍给看(env, 找队(env.用户库, event.teamId), env.userId) };
  },

  listMyTeams(event, env) {
    return { teams: 组队.我参加的(env.用户库, env.userId).map(队 => 队伍给看(env, 队, env.userId)) };
  },

  applyToTeam(event, env) {
    const 内容 = { major: 文字(event.major, 'major', { 必填: true }), grade: 文字(event.grade, 'grade', { 必填: true }),
      intro: 文字(event.intro, 'intro'), strengths: 文字(event.strengths, 'strengths') };
    const { 申, 队 } = env.用户库.transaction(db => {
      const 队 = 找队(db, event.teamId);
      if (组队.是队员(db, 队.id, env.userId)) throw new Error('already_member');
      if (组队.队员们(db, 队.id).length >= 队.max_members) throw new Error('team_full');
      if (组队.申请们(db, { team_id: 队.id, user_id: env.userId, status: 'pending' }).length) throw new Error('duplicate_application');
      if (db.count('team_application', { user_id: env.userId, status: 'pending' }) >= 每人最多待审申请) throw new Error('application_limit_exceeded');
      return { 申: 组队.新申请(db, 队.id, env.userId, 内容, { now: env.now }), 队 };
    });
    // 通知出任何错都不影响申请本身
    try { 通知队长(env, 队, 申); } catch (error) { env.log('[组队] 通知队长出错', 队.id, String(error?.message || error)); }
    return { application: 申请给看(env, 申, env.userId) };
  },

  withdrawApplication(event, env) {
    const 申 = env.用户库.transaction(db => {
      const 原 = 找申请(db, event.applicationId);
      if (原.user_id !== env.userId) throw new Error('application_not_found');   // 别人的申请当作没有
      待审(原);
      return 组队.改申请(db, 原.id, { status: 'withdrawn', handled_at: env.now.toISOString() }, { now: env.now });
    });
    return { application: 申请给看(env, 申, env.userId) };
  },

  listMyApplications(event, env) {
    const items = 组队.我发出的(env.用户库, env.userId).map(申 => {
      const 队 = 组队.读队(env.用户库, 申.team_id);
      return { ...申请给看(env, 申, env.userId), team: 队 ? 队伍给看(env, 队, env.userId) : null };
    });
    return { items };
  },

  // 只有队长审申请（11-09 去掉了队员意见）：不是队长的队不出现，队员调用交回空列表
  listPendingForMe(event, env) {
    const items = [];
    for (const 队 of 组队.我参加的(env.用户库, env.userId)) {
      if (队.user_id !== env.userId) continue;
      const 队看 = 队伍给看(env, 队, env.userId);
      for (const 申 of 组队.申请们(env.用户库, { team_id: 队.id, status: 'pending' })) {
        items.push({ team: 队看, application: 申请给看(env, 申, env.userId, { 给队长: true }) });
      }
    }
    return { items };
  },

  decideApplication(event, env) {
    const decision = event.decision;
    if (!['approve', 'reject'].includes(decision)) throw new Error('invalid_decision');
    const { 申, 队 } = env.用户库.transaction(db => {
      const 原 = 找申请(db, event.applicationId);
      const 队 = 我当队长的队(db, 原.team_id, env.userId);
      待审(原);
      if (decision === 'approve') {
        if (组队.队员们(db, 队.id).length >= 队.max_members) throw new Error('team_full');
        if (!组队.是队员(db, 队.id, 原.user_id)) 组队.加队员(db, 队.id, 原.user_id, { now: env.now });
      }
      const 申 = 组队.改申请(db, 原.id, { status: decision === 'approve' ? 'approved' : 'rejected', handled_by: env.userId, handled_at: env.now.toISOString() }, { now: env.now });
      return { 申, 队 };
    });
    return { application: 申请给看(env, 申, env.userId, { 给队长: true }), team: 队伍给看(env, 队, env.userId) };
  },

  renameTeam(event, env) {
    const name = 文字(event.name, 'name');
    const 队 = env.用户库.transaction(db => {
      const 原 = 我当队长的队(db, event.teamId, env.userId);
      return 组队.改队(db, 原.id, { name: name || null }, 原.version);
    });
    return { team: 队伍给看(env, 队, env.userId) };
  },

  setMaxMembers(event, env) {
    const n = 人数上限(event.maxMembers);
    const 队 = env.用户库.transaction(db => {
      const 原 = 我当队长的队(db, event.teamId, env.userId);
      if (n < 组队.队员们(db, 原.id).length) throw new Error('max_members_below_current');
      return 组队.改队(db, 原.id, { max_members: n }, 原.version);
    });
    return { team: 队伍给看(env, 队, env.userId) };
  },

  setWechat(event, env) {
    const wechat = 文字(event.wechat, 'wechat', { 必填: true });
    const 队 = env.用户库.transaction(db => {
      const 原 = 我当队长的队(db, event.teamId, env.userId);
      return 组队.改队(db, 原.id, { leader_wechat: wechat }, 原.version);
    });
    return { team: 队伍给看(env, 队, env.userId) };
  },

  // 转让：旧队长的微信号不该挂在新队长名下，所以清空；新队长在队伍页用 setWechat 补（team.wechat 为空、isLeader 为真时小程序提示他填）
  transferCaptain(event, env) {
    const 新队长 = 编号(event.userId, 'user_id');
    const 队 = env.用户库.transaction(db => {
      const 原 = 我当队长的队(db, event.teamId, env.userId);
      if (新队长 === env.userId) throw new Error('already_leader');
      if (!组队.是队员(db, 原.id, 新队长)) throw new Error('member_not_found');
      if (db.count('team', { user_id: 新队长 }) >= 每人最多当队长的队) throw new Error('team_limit_exceeded');
      return 组队.换队长(db, 原.id, 新队长, 原.version);
    });
    return { team: 队伍给看(env, 队, env.userId) };
  },

  removeMember(event, env) {
    const 谁 = 编号(event.userId, 'user_id');
    const 队 = env.用户库.transaction(db => {
      const 原 = 我当队长的队(db, event.teamId, env.userId);
      if (谁 === env.userId) throw new Error('cannot_remove_self');
      if (!组队.是队员(db, 原.id, 谁)) throw new Error('member_not_found');
      组队.删队员(db, 原.id, 谁);
      return 原;
    });
    return { team: 队伍给看(env, 队, env.userId) };
  },

  disbandTeam(event, env) {
    env.用户库.transaction(db => {
      const 原 = 我当队长的队(db, event.teamId, env.userId);
      组队.解散(db, 原.id);
    });
    return { disbanded: true };
  },

  leaveTeam(event, env) {
    env.用户库.transaction(db => {
      const 队 = 找队(db, event.teamId);
      const 我 = 组队.是队员(db, 队.id, env.userId);
      if (!我) throw new Error('not_team_member');
      if (我.role === 'leader') throw new Error('leader_cannot_leave');
      组队.删队员(db, 队.id, env.userId);
    });
    return { left: true };
  },

  // 小程序调 wx.requestSubscribeMessage、用户接受（或“总是保持”后静默接受）后调一次。后端核实不了，所以设上限
  addSubscribeQuota(event, env) {
    return { quota: 组队.加通知次数(env.用户库, env.userId, 通知次数上限, { now: env.now }) };
  },

  getSubscribeQuota(event, env) {
    return { quota: 组队.通知次数(env.用户库, env.userId), templateId: env.通知模板?.id ?? null };
  },
};

// 这些是正常的业务拒绝，不记日志
const 业务拒绝 = /^(unauthenticated|user_account_disabled|unsupported_action|invalid_\w+|\w+_not_found|team_\w+|application_\w+|already_\w+|duplicate_application|not_team_\w+|leader_\w+|max_members_below_current|cannot_remove_self)$/;

export async function handle(request = {}, { 用户库, 主库, openid, now = () => new Date(), 发订阅消息 = null, 通知模板 = 读通知模板(), log = console.log } = {}) {
  const { action, ...event } = request;
  try {
    const userId = 当前用户(用户库, openid);
    if (!Object.hasOwn(动作, action)) throw new Error('unsupported_action');
    return { ok: true, data: 动作[action](event, { 用户库, 主库, userId, now: now(), 发订阅消息, 通知模板, log }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'team_failed';
    // 同时改同一个队（版本冲突）也交回固定的词，不把数据库细节给小程序
    if (error?.kind === '版本冲突') return { ok: false, message: 'team_conflict' };
    if (!业务拒绝.test(message)) {
      console.error('[组队] 出错', { action, error: message });
      return { ok: false, message: 'team_failed' };
    }
    return { ok: false, message };
  }
}
