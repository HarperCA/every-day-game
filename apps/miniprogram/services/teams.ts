// 组队数据（2026-11-12 接北京后端，不再带手机内存里的假队伍；开发版也连真实后端）。
// 全部调 POST /api/team（北京/服务/组队，动作和报错词见那里的 README），令牌、过期重登录走 cloudSession.ts，和收藏、提醒同一套。
// 用户定的规则（11-09、11-12）：
//   建队选比赛、队名、人数 2–15、队长微信号（11-12 改必填），没有急缺岗位；
//   申请专业、年级必填，介绍、擅长方向选填，没有角色、没有微信号；只有队长审核；
//   队员看得到队友和队长的昵称头像，外人只看简版（比赛名、队名、人数上限、已有几人）；
//   队长改队名、改人数（不能小于现有人数）、转让（新队长补微信号）、踢人、补微信号、解散（直接删除）；队员退出、复制队长微信。
import { TEAM_APPLY_TEMPLATE_ID } from '../config/cloud';
import { callTeam, ensureLoggedIn, getCurrentUserId, isCloudSessionReady } from './cloudSession';

export type TeamRole = 'captain' | 'member' | 'pending' | 'rejected' | 'visitor';
type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

// 后端交回的格式（北京/服务/组队/README.md）
interface ApiMember { userId: string; role: 'leader' | 'member'; joinedAt: string; isMe: boolean; nickname: string; avatarUrl: string }
interface ApiTeam {
  id: string; competitionId: string; competitionName: string | null; name: string; maxMembers: number; memberCount: number; createdAt: string;
  isMember: boolean; isLeader: boolean; version?: number; wechat?: string; members?: ApiMember[];
}
interface ApiApplication {
  id: string; teamId: string; applicantId: string; major: string; grade: string; intro: string; strengths: string;
  status: ApplicationStatus; createdAt: string; updatedAt: string; handledAt: string | null; isMine: boolean;
  applicant?: { nickname: string; avatarUrl: string };
}

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 15;
const NAME_LIMIT = 20;        // 后端收 50 字；转发卡片和列表只放得下 20 字左右，前端按 20 限
const WECHAT_LIMIT = 50;
const MAJOR_LIMIT = 30;
const GRADE_LIMIT = 20;
const INTRO_LIMIT = 200;
const STRENGTHS_LIMIT = 50;
const UNNAMED = '未命名队伍';
const DAY = 86400000;

const lengthOf = (text: string) => Array.from(text).length;
const initialOf = (name: string) => Array.from(name)[0] || '';
const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

// 校赛也用（schoolContests.ts）
export function deadlineOf(registrationEnd: string) {
  const end = new Date(registrationEnd || '');
  if (!registrationEnd || Number.isNaN(end.getTime())) return { deadlineText: '', deadlineUrgent: false };
  const now = new Date();
  const days = Math.round((new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / DAY);
  if (days < 0) return { deadlineText: '已截止', deadlineUrgent: false };
  if (days === 0) return { deadlineText: '今天截止', deadlineUrgent: true };
  return { deadlineText: `还剩 ${days} 天`, deadlineUrgent: false };
}

// ---- 后端报错词 → 中文（README 的列表；网络问题等本来就是中文的原样交回） ----
const ERROR_TEXT: Record<string, string> = {
  unauthenticated: '登录已失效，请重新打开小程序',
  user_session_expired: '登录已失效，请重新打开小程序',
  user_account_disabled: '账号已停用',
  unsupported_action: '小程序版本过旧，请更新后再试',
  invalid_competition_id: '请选择比赛',
  invalid_max_members: `队伍人数要在 ${MIN_MEMBERS} 到 ${MAX_MEMBERS} 人之间`,
  invalid_wechat: '请填写微信号（最多 50 个字）',
  invalid_name: '队伍名称最多 50 个字',
  invalid_major: `请填写专业（最多 ${MAJOR_LIMIT} 个字）`,
  invalid_grade: `请填写年级（最多 ${GRADE_LIMIT} 个字）`,
  invalid_intro: `介绍最多 ${INTRO_LIMIT} 个字`,
  invalid_strengths: `擅长方向最多 ${STRENGTHS_LIMIT} 个字`,
  invalid_team_id: '队伍已解散或不存在',
  invalid_application_id: '这条申请不存在或已撤回',
  invalid_user_id: '这位队员已不在队伍里',
  invalid_decision: '操作无效，请刷新后再试',
  not_school_member: '只有本校学生或管理员可以参加校赛组队',
  content_not_allowed: '内容含有不合规信息，请修改后再提交',
  competition_not_found: '这场比赛找不到了，换一场试试',
  team_not_found: '队伍已解散或不存在',
  application_not_found: '这条申请不存在或已撤回',
  member_not_found: '这位队员已不在队伍里',
  team_full: '队伍已满员',
  already_member: '你已经在这支队伍里',
  already_leader: '你已经是队长',
  duplicate_application: '已经申请过了，等队长审核',
  application_not_pending: '这条申请已经处理过了',
  not_team_member: '你不在这支队伍里',
  not_team_leader: '只有队长可以操作',
  leader_cannot_leave: '队长不能直接退出，请先转让队长或解散队伍',
  cannot_remove_self: '队长不能移出自己',
  max_members_below_current: '人数不能少于现在的队员数',
  team_limit_exceeded: '最多同时当 20 支队伍的队长',
  application_limit_exceeded: '待审核的申请最多 30 条，先撤回一些再申请',
  team_conflict: '队伍刚被改过，请刷新后再试',
  team_failed: '组队服务出了点问题，请稍后再试',
  internal_error: '组队服务出了点问题，请稍后再试',
};

export function teamErrorText(message: string): string {
  if (Object.prototype.hasOwnProperty.call(ERROR_TEXT, message)) return ERROR_TEXT[message];
  if (/^invalid_[a-z_]+$/.test(message)) return '填写的内容不符合要求，请检查后再试';
  if (/^[a-z][a-z0-9_]*$/.test(message)) return '操作失败，请稍后再试';
  return message || '操作失败，请稍后再试';
}

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  await ensureLoggedIn();
  try {
    return await callTeam<T>(action, payload);
  } catch (error) {
    throw new Error(teamErrorText(error instanceof Error ? error.message : String(error)));
  }
}

// ---- 交给页面的样子 ----
function viewOf(team: ApiTeam, myApplication: ApiApplication | null = null) {
  const isMember = Boolean(team.isMember);
  const isLeader = Boolean(team.isLeader);
  const full = team.memberCount >= team.maxMembers;
  let role: TeamRole = 'visitor';
  if (isLeader) role = 'captain';
  else if (isMember) role = 'member';
  else if (myApplication?.status === 'pending') role = 'pending';
  else if (myApplication?.status === 'rejected') role = 'rejected';
  const wechat = isMember ? (team.wechat || '') : '';   // 队长微信号只有队员拿得到，后端也只给队员
  const members = isMember ? (team.members || []).map(person => {
    const name = person.nickname || (person.isMe ? '我' : '队员');
    return { id: person.userId, name, avatarUrl: person.avatarUrl || '', initial: initialOf(name), isCaptain: person.role === 'leader', isMe: Boolean(person.isMe) };
  }) : [];
  return {
    id: team.id, competitionId: team.competitionId, competitionName: team.competitionName || '',
    name: team.name || UNNAMED, rawName: team.name || '',
    role, isLeader, isMember, full,
    memberCount: team.memberCount, maxMembers: team.maxMembers,
    captainWechat: wechat,
    needWechat: isLeader && !wechat,   // 转让过来（后端清空了微信号）或 11-12 以前建队时没填：提示队长补
    members,
    canApply: !isMember && !full && role !== 'pending',
    applicationId: role === 'pending' ? myApplication!.id : '',
  };
}
export type TeamView = ReturnType<typeof viewOf>;

// 我参加的队伍缓存：详情页的“我的队伍”入口要知道这场比赛我有没有队，不用每次都问后端
let myTeamsCache: { owner: string; at: number; teams: TeamView[] } | null = null;
const CACHE_MS = 30000;
const forgetMyTeams = () => { myTeamsCache = null; };

// 同一支队我可能申请过好几次（撤回、被拒后重申），取最新的一条
function latestApplicationFor(teamId: string, applications: ApiApplication[]): ApiApplication | null {
  return applications.filter(item => item.teamId === teamId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
}

async function myApplications(): Promise<(ApiApplication & { team: ApiTeam | null })[]> {
  return (await call<{ items: (ApiApplication & { team: ApiTeam | null })[] }>('listMyApplications')).items || [];
}

// 打开队伍页（含点转发卡片进来）：从后端读；不是队员再查一下我对这支队的申请，决定显示审核中、未通过还是申请表
export async function getTeamView(id: string): Promise<TeamView | null> {
  if (!id) return null;
  let team: ApiTeam;
  try {
    team = (await call<{ team: ApiTeam }>('getTeam', { teamId: id })).team;
  } catch (error) {
    if (error instanceof Error && error.message === ERROR_TEXT.team_not_found) return null;
    throw error;
  }
  if (team.isMember) return viewOf(team);
  return viewOf(team, latestApplicationFor(team.id, await myApplications()));
}

// 我参加的队伍：我带的在前，我加入的在后
export async function listMyTeams(): Promise<TeamView[]> {
  const { teams } = await call<{ teams: ApiTeam[] }>('listMyTeams');
  const views = (teams || []).map(team => viewOf(team));
  const sorted = [...views.filter(view => view.role === 'captain'), ...views.filter(view => view.role === 'member')];
  myTeamsCache = { owner: getCurrentUserId(), at: Date.now(), teams: sorted };
  return sorted;
}

// 详情页、校赛页的组队入口用。没登录不为这个去登录，当作没有队伍；查不到也当没有
export async function findMyTeamForCompetition(competitionId: string): Promise<TeamView | null> {
  if (!competitionId || !isCloudSessionReady()) return null;
  const fresh = myTeamsCache && myTeamsCache.owner === getCurrentUserId() && Date.now() - myTeamsCache.at < CACHE_MS;
  const teams = fresh ? myTeamsCache!.teams : await listMyTeams().catch(() => [] as TeamView[]);
  return teams.find(team => team.competitionId === competitionId) || null;
}

// 待我审批：只有我当队长的队（后端对队员交回空列表）
export async function listInboundApplications() {
  const { items } = await call<{ items: { team: ApiTeam; application: ApiApplication }[] }>('listPendingForMe');
  return (items || []).map(({ team, application }) => {
    const name = application.applicant?.nickname || '微信用户';
    return {
      id: application.id, teamId: team.id, teamName: team.name || UNNAMED, competitionName: team.competitionName || '',
      name, avatarUrl: application.applicant?.avatarUrl || '', initial: initialOf(name),
      major: application.major, grade: application.grade, strengths: application.strengths || '', intro: application.intro || '',
    };
  });
}

// 我发出的：审核中在前，未通过在后；同一支队只留最新一条；撤回的、已通过的、队伍解散了的不显示
export async function listOutboundApplications() {
  const items = await myApplications();
  const seen = new Set<string>();
  const latest = [...items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).filter(item => {
    if (seen.has(item.teamId)) return false;
    seen.add(item.teamId);
    return true;
  });
  const view = (item: ApiApplication & { team: ApiTeam | null }) => ({
    id: item.id, teamId: item.teamId, teamName: item.team?.name || UNNAMED, competitionName: item.team?.competitionName || '',
    status: item.status, statusText: item.status === 'pending' ? '审核中' : '未通过', statusClass: item.status === 'pending' ? 'status-wait' : 'status-plain',
    major: item.major, grade: item.grade, canWithdraw: item.status === 'pending',
  });
  const of = (status: ApplicationStatus) => latest.filter(item => item.status === status && item.team).map(view);
  return [...of('pending'), ...of('rejected')];
}

// ---- 建队 ----
export interface CreateTeamInput { competitionId: string; name: string; maxMembers: number; wechat?: string }

// 页面提交前先查（查出问题直接提示，不用等登录、不弹昵称面板）
export function checkCreateInput(input: CreateTeamInput): string {
  const name = clean(input.name);
  if (!input.competitionId) return '请选择比赛';
  if (!name) return '请填写队伍名称';
  if (lengthOf(name) > NAME_LIMIT) return `队伍名称最多 ${NAME_LIMIT} 个字`;
  if (!Number.isInteger(input.maxMembers) || input.maxMembers < MIN_MEMBERS || input.maxMembers > MAX_MEMBERS) return `队伍人数要在 ${MIN_MEMBERS} 到 ${MAX_MEMBERS} 人之间`;
  const wechat = clean(input.wechat);
  if (!wechat) return '请填写微信号';   // 11-12 用户定：建队时必填（后端也要求）
  if (lengthOf(wechat) > WECHAT_LIMIT) return `微信号最多 ${WECHAT_LIMIT} 个字`;
  return '';
}

export async function createTeam(input: CreateTeamInput): Promise<TeamView> {
  const problem = checkCreateInput(input);
  if (problem) throw new Error(problem);
  const { team } = await call<{ team: ApiTeam }>('createTeam', {
    competitionId: input.competitionId, name: clean(input.name), maxMembers: input.maxMembers, wechat: clean(input.wechat),
  });
  forgetMyTeams();
  return viewOf(team);
}

// ---- 申请 ----
export interface ApplyInput { major: string; grade: string; intro?: string; strengths?: string }

export function checkApplyInput(input: ApplyInput): string {
  const major = clean(input.major);
  const grade = clean(input.grade);
  if (!major) return '请填写专业';
  if (lengthOf(major) > MAJOR_LIMIT) return `专业最多 ${MAJOR_LIMIT} 个字`;
  if (!grade) return '请填写年级';
  if (lengthOf(grade) > GRADE_LIMIT) return `年级最多 ${GRADE_LIMIT} 个字`;
  if (lengthOf(clean(input.strengths)) > STRENGTHS_LIMIT) return `擅长方向最多 ${STRENGTHS_LIMIT} 个字`;
  if (lengthOf(clean(input.intro)) > INTRO_LIMIT) return `介绍最多 ${INTRO_LIMIT} 个字`;
  return '';
}

export async function applyToTeam(teamId: string, input: ApplyInput): Promise<void> {
  const problem = checkApplyInput(input);
  if (problem) throw new Error(problem);
  await call('applyToTeam', { teamId, major: clean(input.major), grade: clean(input.grade), intro: clean(input.intro), strengths: clean(input.strengths) });
}

export async function withdrawApplication(applicationId: string): Promise<void> {
  await call('withdrawApplication', { applicationId });
}

// 只有队长：通过即入队
export async function decideApplication(applicationId: string, decision: 'approve' | 'reject'): Promise<void> {
  await call('decideApplication', { applicationId, decision });
  forgetMyTeams();
}

// ---- 队长管理 ----
async function changeTeam(action: string, payload: Record<string, unknown>): Promise<TeamView> {
  const { team } = await call<{ team: ApiTeam }>(action, payload);
  forgetMyTeams();
  return viewOf(team);
}

export async function renameTeam(teamId: string, name: string): Promise<TeamView> {
  const value = clean(name);
  if (!value) throw new Error('请填写队伍名称');
  if (lengthOf(value) > NAME_LIMIT) throw new Error(`队伍名称最多 ${NAME_LIMIT} 个字`);
  return changeTeam('renameTeam', { teamId, name: value });
}

export async function setMaxMembers(teamId: string, maxMembers: number): Promise<TeamView> {
  if (!Number.isInteger(maxMembers) || maxMembers < MIN_MEMBERS || maxMembers > MAX_MEMBERS) throw new Error(`队伍人数要在 ${MIN_MEMBERS} 到 ${MAX_MEMBERS} 人之间`);
  return changeTeam('setMaxMembers', { teamId, maxMembers });
}

export async function setWechat(teamId: string, wechat: string): Promise<TeamView> {
  const value = clean(wechat);
  if (!value) throw new Error('请填写微信号');
  if (lengthOf(value) > WECHAT_LIMIT) throw new Error(`微信号最多 ${WECHAT_LIMIT} 个字`);
  return changeTeam('setWechat', { teamId, wechat: value });
}

// 转让后我变队员；队长微信号后端会清空，新队长打开队伍页时提示他补
export async function transferCaptain(teamId: string, userId: string): Promise<TeamView> {
  return changeTeam('transferCaptain', { teamId, userId });
}

export async function removeMember(teamId: string, userId: string): Promise<TeamView> {
  return changeTeam('removeMember', { teamId, userId });
}

// 解散直接删除：队伍、队员、申请都没了，转发出去的卡片打开显示已解散
export async function disbandTeam(teamId: string): Promise<void> {
  await call('disbandTeam', { teamId });
  forgetMyTeams();
}

export async function leaveTeam(teamId: string): Promise<void> {
  await call('leaveTeam', { teamId });
  forgetMyTeams();
}

// ---- 订阅消息：有人申请时通知队长 ----
// 模板编号在 config/cloud.ts，现在为空，为空就什么都不做。填了以后：弹订阅，用户接受就调 addSubscribeQuota 记一次可发次数。
// 微信要求 wx.requestSubscribeMessage 在点按里调用（await 之后再调会被拒），所以调用处放在点按事件开头、不等别的请求。
export async function requestApplyNotice(): Promise<boolean> {
  const templateId = TEAM_APPLY_TEMPLATE_ID;
  if (!templateId) return false;
  try {
    const result: any = await new Promise((resolve, reject) => wx.requestSubscribeMessage({ tmplIds: [templateId], success: resolve, fail: reject }));
    if (result?.[templateId] !== 'accept') return false;
    await call('addSubscribeQuota');
    return true;
  } catch (_error) {
    return false;   // 用户关了订阅、网络不好：都不影响组队
  }
}
