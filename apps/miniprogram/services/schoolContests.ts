import { callSchool, ensureLoggedIn } from './cloudSession';

export interface ContestView {
  id: string;
  school: string;
  title: string;
  content: string;
  signup: string;
  startDate: string;
  endDate: string;
  status?: string;
  reviewNote?: string;
}

export interface SchoolApplication {
  id: string;
  school: string;
  status: string;
  reviewNote: string;
}

export interface SchoolMember {
  id: string;
  school: string;
  realName: string;
  college: string;
  major: string;
  studentNo: string;
}

export interface SchoolStatus {
  adminSchools: string[];
  applications: SchoolApplication[];
  memberships: SchoolMember[];
}

const errors: Record<string, string> = {
  unauthenticated: '请先登录',
  user_session_expired: '登录已失效，请重新打开小程序',
  user_account_disabled: '账号已停用',
  unsupported_action: '请更新小程序后重试',
  not_school_admin: '只有本校通过审核的管理员可以操作',
  invite_invalid: '邀请已失效，请找管理员索取新邀请',
  school_admin_already_applied: '该学校已有你提交的申请，请在校赛页查看状态',
  school_contest_not_found: '校赛已下架或不存在',
  invalid_date_range: '结束日期不能早于开始日期',
  content_not_allowed: '内容含有不合规信息，请修改后再提交',
};
const fields: Record<string, string> = {
  school: '学校', real_name: '真实姓名', contact: '联系方式', proof: '证明说明', college: '所属学院',
  major: '专业', student_no: '学号', title: '校赛名称', content: '校赛简介', signup: '报名方式',
  start_date: '开始日期', end_date: '结束日期',
};

export function schoolError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (Object.hasOwnProperty.call(errors, message)) return errors[message];
  const invalid = /^invalid_(.+)$/.exec(message);
  const tooLong = /^(.+)_too_long$/.exec(message);
  if (invalid && fields[invalid[1]]) return `请检查${fields[invalid[1]]}`;
  if (tooLong && fields[tooLong[1]]) return `${fields[tooLong[1]]}太长，请缩短后再试`;
  return /[一-龥]/.test(message) ? message : '校赛服务暂不可用，请稍后再试';
}

async function request<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  await ensureLoggedIn();
  return callSchool<T>(action, payload);
}

export const isCampusContest = (id: string) => id.startsWith('school-contest-');
export const getSchoolStatus = () => request<SchoolStatus>('myStatus');
export const listContests = async () => (await request<{ items: ContestView[] }>('listSchoolContests')).items;
export async function getContestView(id: string): Promise<ContestView | null> {
  return (await listContests()).find(contest => contest.id === id) ?? null;
}
export const applyManager = (input: { school: string; realName: string; contact: string; proof: string }) =>
  request<{ application: SchoolApplication }>('applyAdmin', input);
export const createContest = (input: Omit<ContestView, 'id' | 'status' | 'reviewNote'>) =>
  request<{ contest: ContestView }>('publishContest', input);
export const listManagedContests = async (school: string) =>
  (await request<{ items: ContestView[] }>('myContests', { school })).items;
export const withdrawContest = (contestId: string) => request('withdrawContest', { contestId });
export const createInvite = (school: string, renew = false) =>
  request<{ inviteCode: string; school: string }>(renew ? 'renewInvite' : 'createInvite', { school });
export const invitePath = (code: string) => `/pages/school-pick/school-pick?code=${encodeURIComponent(code)}`;
export const listMembers = async (school: string) =>
  (await request<{ items: SchoolMember[] }>('listMembers', { school })).items;
export const removeMember = (school: string, memberId: string) => request('removeMember', { school, memberId });
export const leaveSchool = (school: string) => request('leaveSchool', { school });
export function joinSchool(inviteCode: string, input: Pick<SchoolMember, 'realName' | 'college' | 'major' | 'studentNo'>) {
  if (!inviteCode) throw new Error('invite_invalid');
  const fields = { realName: input.realName.trim(), college: input.college.trim(), major: input.major.trim(), studentNo: input.studentNo.trim() };
  if (!fields.realName) throw new Error('invalid_real_name');
  if (!fields.college) throw new Error('invalid_college');
  if (!fields.major) throw new Error('invalid_major');
  if (!fields.studentNo) throw new Error('invalid_student_no');
  return request<{ membership: SchoolMember }>('joinSchool', { inviteCode, ...fields });
}

export function confirmSchoolAction(content: string): Promise<boolean> {
  return new Promise(resolve => wx.showModal({
    title: '请确认', content, success: result => resolve(result.confirm), fail: () => resolve(false),
  }));
}
