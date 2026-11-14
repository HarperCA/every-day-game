// 组队服务（2026-11-08 粗版本，11-09 按用户定的规则改）：比赛里建队 → 转发卡片 → 点卡片发申请（专业、年级必填）→ 给队长发订阅消息 → 队长通过/拒绝 → 通过即入队。
// 11-09：去掉队员意见；队长能改名、改人数、转让、踢人；解散直接删；队员看得到队友昵称头像；非队员只看到比赛名、队伍名、人数上限、已有几人。用内存库跑。
import { describe, expect, test } from 'vitest';
import { openMainDb, 同步 } from '../../../../主数据库/index.mjs';
import { openUserDb, 用户, 校赛 } from '../../../../副数据库/index.mjs';
import { handle, 读通知模板 } from '../../index.mjs';

const NOW = new Date('2026-11-08T02:00:00Z');
const 模板 = { id: 'tpl-team-apply', 字段: { 比赛: 'thing1', 队伍: 'thing2', 申请人: 'thing3', 时间: 'time4' } };
// 发订阅消息是“发出去不等结果”，测结果要等它跑完
const 等发完 = () => new Promise(resolve => setImmediate(resolve));

function 环境({ 发送结果 = { errcode: 0 }, 通知模板 = 模板 } = {}) {
  const 主库 = openMainDb({ file: ':memory:', now: () => NOW });
  同步.收下(主库, { 比赛们: [{ id: 'event-math', version: 1, name: '全国大学生数学建模竞赛', level: '国家级', data: {} }], 届次们: [] });
  const 用户库 = openUserDb({ file: ':memory:', now: () => NOW });
  const 账号 = {};
  for (const openid of ['o-长', 'o-甲', 'o-乙', 'o-丙']) 账号[openid] = 用户.新建或登录(用户库, { openid }, { now: NOW });
  const 发过 = [];
  const 日志 = [];
  const 发订阅消息 = async payload => { 发过.push(payload); return typeof 发送结果 === 'function' ? 发送结果(payload) : 发送结果; };
  // 谁(openid) 做 action
  const 做 = (openid, action, 参数 = {}) => handle({ action, ...参数 }, { 主库, 用户库, openid, now: () => NOW, 发订阅消息, 通知模板, log: (...x) => 日志.push(x.join(' ')) });
  return { 主库, 用户库, 账号, 做, 发过, 日志 };
}
const 建队 = (做, 改 = {}) => 做('o-长', 'createTeam', { competitionId: 'event-math', maxMembers: 3, wechat: 'wx_leader', name: '冲国一', ...改 });
const 申请 = (做, openid, teamId, 改 = {}) => 做(openid, 'applyToTeam', { teamId, major: '计算机科学与技术', grade: '大二', ...改 });
// 让 openid 入队：申请 + 队长通过
async function 入队(做, openid, teamId) {
  const 申 = (await 申请(做, openid, teamId)).data.application;
  return 做('o-长', 'decideApplication', { applicationId: 申.id, decision: 'approve' });
}

describe('身份和动作', () => {
  test('没登录 unauthenticated；不认识的动作 unsupported_action；队员意见（reviewApplication）已删', async () => {
    const { 做 } = 环境();
    expect(await 做('', 'listMyTeams')).toEqual({ ok: false, message: 'unauthenticated' });
    expect(await 做('o-陌生', 'listMyTeams')).toEqual({ ok: false, message: 'unauthenticated' });
    expect(await 做('o-长', 'dropTable')).toEqual({ ok: false, message: 'unsupported_action' });
    expect(await 做('o-长', 'reviewApplication', { applicationId: 'x', opinion: 'recommend' })).toEqual({ ok: false, message: 'unsupported_action' });
  });
});

describe('建队', () => {
  test('比赛要在主数据库；人数 2–15；微信号必填、名称可选，都有长度上限', async () => {
    const { 做 } = 环境();
    expect((await 建队(做, { competitionId: 'event-none' })).message).toBe('competition_not_found');
    for (const n of [1, 16, 2.5, '3']) expect((await 建队(做, { maxMembers: n })).message).toBe('invalid_max_members');
    expect((await 建队(做, { wechat: ' ' })).message).toBe('invalid_wechat');
    expect((await 建队(做, { wechat: 'w'.repeat(51) })).message).toBe('invalid_wechat');
    expect((await 建队(做, { name: '名'.repeat(51) })).message).toBe('invalid_name');
    const r = await 建队(做, { name: undefined });
    expect(r).toMatchObject({ ok: true, data: { team: { competitionId: 'event-math', competitionName: '全国大学生数学建模竞赛', maxMembers: 3, memberCount: 1,
      isLeader: true, isMember: true, wechat: 'wx_leader', name: '' } } });
    expect(r.data.team).not.toHaveProperty('status');
  });
});

describe('转发卡片落地：队伍详情', () => {
  test('非队员只看到比赛名、队伍名、人数、已有几人，看不到微信号和队员；队员看得到队友的昵称头像', async () => {
    const { 做, 用户库, 账号 } = 环境();
    用户.改资料(用户库, 账号['o-长'].id, { nickname: '老黄', avatar_url: 'https://thirdwx.qlogo.cn/leader.png' }, { now: NOW });
    const 队 = (await 建队(做)).data.team;
    const 外人看 = (await 做('o-甲', 'getTeam', { teamId: 队.id })).data.team;
    expect(外人看).toMatchObject({ id: 队.id, competitionName: '全国大学生数学建模竞赛', name: '冲国一', maxMembers: 3, memberCount: 1, isMember: false });
    expect(外人看.wechat).toBeUndefined();
    expect(外人看.members).toBeUndefined();
    expect(JSON.stringify(外人看)).not.toContain('老黄');
    await 入队(做, 'o-乙', 队.id);
    const 乙看 = (await 做('o-乙', 'getTeam', { teamId: 队.id })).data.team;
    expect(乙看).toMatchObject({ wechat: 'wx_leader', members: [
      { userId: 账号['o-长'].id, role: 'leader', isMe: false, nickname: '老黄', avatarUrl: 'https://thirdwx.qlogo.cn/leader.png' },
      { userId: 账号['o-乙'].id, role: 'member', isMe: true, nickname: '', avatarUrl: '' },
    ] });
    expect((await 做('o-甲', 'getTeam', { teamId: 'team-none' })).message).toBe('team_not_found');
  });
});

describe('申请和处理', () => {
  test('完整一轮：申请（专业、年级、介绍、擅长）→ 队长在待我处理里看到 → 通过 → 入队，能看到微信号和队友', async () => {
    const { 做, 用户库, 账号 } = 环境();
    用户.改资料(用户库, 账号['o-甲'].id, { nickname: '小甲', avatar_url: 'https://thirdwx.qlogo.cn/jia.png' }, { now: NOW });
    const 队 = (await 建队(做)).data.team;
    const 甲申 = (await 申请(做, 'o-甲', 队.id, { grade: ' 研一 ', intro: '会 Python', strengths: '建模' })).data.application;
    expect(甲申).toMatchObject({ teamId: 队.id, major: '计算机科学与技术', grade: '研一', intro: '会 Python', strengths: '建模', status: 'pending', isMine: true });
    expect(甲申).not.toHaveProperty('reviews');
    // 队长：待我处理里看到申请的全部字段，以及申请人的昵称头像
    const 队长待办 = (await 做('o-长', 'listPendingForMe')).data.items;
    expect(队长待办).toEqual([{ team: expect.objectContaining({ id: 队.id, isLeader: true }), application: expect.objectContaining({ id: 甲申.id, major: '计算机科学与技术', grade: '研一',
      intro: '会 Python', strengths: '建模', applicant: { nickname: '小甲', avatarUrl: 'https://thirdwx.qlogo.cn/jia.png' } }) }]);
    // 申请人自己的列表
    const 我发的 = (await 做('o-甲', 'listMyApplications')).data.items;
    expect(我发的[0]).toMatchObject({ id: 甲申.id, status: 'pending', team: { name: '冲国一', isMember: false } });
    // 队长通过 → 甲入队
    const 过 = (await 做('o-长', 'decideApplication', { applicationId: 甲申.id, decision: 'approve' })).data;
    expect(过).toMatchObject({ application: { status: 'approved' }, team: { memberCount: 2 } });
    const 甲的队 = (await 做('o-甲', 'listMyTeams')).data.teams;
    expect(甲的队).toEqual([expect.objectContaining({ id: 队.id, wechat: 'wx_leader', isLeader: false, memberCount: 2 })]);
    expect(甲的队[0].members.map(m => m.nickname)).toEqual(['', '小甲']);
  });
  test('队员调 listPendingForMe 交回空列表（只有队长审申请）', async () => {
    const { 做 } = 环境();
    const 队 = (await 建队(做)).data.team;
    await 入队(做, 'o-乙', 队.id);
    await 申请(做, 'o-甲', 队.id);
    expect((await 做('o-乙', 'listPendingForMe')).data).toEqual({ items: [] });
    expect((await 做('o-丙', 'listPendingForMe')).data).toEqual({ items: [] });
    expect((await 做('o-长', 'listPendingForMe')).data.items).toHaveLength(1);
  });
  test('专业、年级必填；四项都有长度上限', async () => {
    const { 做 } = 环境();
    const 队 = (await 建队(做)).data.team;
    expect((await 申请(做, 'o-甲', 队.id, { major: ' ' })).message).toBe('invalid_major');
    expect((await 申请(做, 'o-甲', 队.id, { major: undefined })).message).toBe('invalid_major');
    expect((await 申请(做, 'o-甲', 队.id, { grade: '' })).message).toBe('invalid_grade');
    expect((await 申请(做, 'o-甲', 队.id, { major: '专'.repeat(31) })).message).toBe('invalid_major');
    expect((await 申请(做, 'o-甲', 队.id, { grade: '年'.repeat(21) })).message).toBe('invalid_grade');
    expect((await 申请(做, 'o-甲', 队.id, { intro: '介'.repeat(201) })).message).toBe('invalid_intro');
    expect((await 申请(做, 'o-甲', 队.id, { strengths: '擅'.repeat(51) })).message).toBe('invalid_strengths');
    expect((await 申请(做, 'o-甲', 队.id, { major: '专'.repeat(30), grade: '年'.repeat(20), intro: '介'.repeat(200), strengths: '擅'.repeat(50) })).ok).toBe(true);
  });
  test('申请的限制：不能重复待审、已是队员不行、满员不行；满员后已有的待审也不能通过', async () => {
    const { 做 } = 环境();
    const 队 = (await 建队(做, { maxMembers: 2 })).data.team;
    expect((await 申请(做, 'o-长', 队.id)).message).toBe('already_member');
    const 甲申 = (await 申请(做, 'o-甲', 队.id)).data.application;
    expect((await 申请(做, 'o-甲', 队.id)).message).toBe('duplicate_application');
    const 乙申 = (await 申请(做, 'o-乙', 队.id)).data.application;
    await 做('o-长', 'decideApplication', { applicationId: 甲申.id, decision: 'approve' });
    expect((await 申请(做, 'o-丙', 队.id)).message).toBe('team_full');
    expect((await 做('o-长', 'decideApplication', { applicationId: 乙申.id, decision: 'approve' })).message).toBe('team_full');
    expect((await 做('o-长', 'decideApplication', { applicationId: 乙申.id, decision: 'reject' })).data.application.status).toBe('rejected');
    expect((await 做('o-长', 'decideApplication', { applicationId: 乙申.id, decision: 'approve' })).message).toBe('application_not_pending');
  });
  test('只有队长能处理；处理的选项只有通过、拒绝', async () => {
    const { 做 } = 环境();
    const 队 = (await 建队(做)).data.team;
    await 入队(做, 'o-乙', 队.id);
    const 甲申 = (await 申请(做, 'o-甲', 队.id)).data.application;
    expect((await 做('o-乙', 'decideApplication', { applicationId: 甲申.id, decision: 'approve' })).message).toBe('not_team_leader');
    expect((await 做('o-长', 'decideApplication', { applicationId: 甲申.id, decision: 'maybe' })).message).toBe('invalid_decision');
  });
  test('撤回：只有申请人、只能撤待审的；撤回后可以重新申请', async () => {
    const { 做 } = 环境();
    const 队 = (await 建队(做)).data.team;
    const 甲申 = (await 申请(做, 'o-甲', 队.id)).data.application;
    expect((await 做('o-乙', 'withdrawApplication', { applicationId: 甲申.id })).message).toBe('application_not_found');
    expect((await 做('o-甲', 'withdrawApplication', { applicationId: 甲申.id })).data.application.status).toBe('withdrawn');
    expect((await 做('o-甲', 'withdrawApplication', { applicationId: 甲申.id })).message).toBe('application_not_pending');
    expect((await 做('o-长', 'listPendingForMe')).data.items).toEqual([]);
    expect((await 申请(做, 'o-甲', 队.id)).ok).toBe(true);
  });
});

describe('队长管理队伍', () => {
  test('改队名：只有队长；可以清空；有长度上限', async () => {
    const { 做 } = 环境();
    const 队 = (await 建队(做)).data.team;
    await 入队(做, 'o-乙', 队.id);
    expect((await 做('o-乙', 'renameTeam', { teamId: 队.id, name: '乙的队' })).message).toBe('not_team_leader');
    expect((await 做('o-长', 'renameTeam', { teamId: 队.id, name: '名'.repeat(51) })).message).toBe('invalid_name');
    expect((await 做('o-长', 'renameTeam', { teamId: 队.id, name: ' 冲国奖 ' })).data.team).toMatchObject({ name: '冲国奖' });
    expect((await 做('o-长', 'renameTeam', { teamId: 队.id, name: '' })).data.team).toMatchObject({ name: '' });
  });
  test('改人数：只有队长；2–15 的整数；不能小于现在的人数', async () => {
    const { 做 } = 环境();
    const 队 = (await 建队(做, { maxMembers: 4 })).data.team;
    await 入队(做, 'o-甲', 队.id);
    await 入队(做, 'o-乙', 队.id);
    expect((await 做('o-甲', 'setMaxMembers', { teamId: 队.id, maxMembers: 5 })).message).toBe('not_team_leader');
    for (const n of [1, 16, 3.5, '5']) expect((await 做('o-长', 'setMaxMembers', { teamId: 队.id, maxMembers: n })).message).toBe('invalid_max_members');
    expect((await 做('o-长', 'setMaxMembers', { teamId: 队.id, maxMembers: 2 })).message).toBe('max_members_below_current');
    expect((await 做('o-长', 'setMaxMembers', { teamId: 队.id, maxMembers: 3 })).data.team).toMatchObject({ maxMembers: 3, memberCount: 3 });
    expect((await 做('o-长', 'setMaxMembers', { teamId: 队.id, maxMembers: 15 })).data.team.maxMembers).toBe(15);
  });
  test('转让队长：只能转给本队队员；原队长变队员；微信号清空，新队长用 setWechat 补上前队员看到的是空', async () => {
    const { 做, 账号 } = 环境();
    const 队 = (await 建队(做)).data.team;
    await 入队(做, 'o-甲', 队.id);
    expect((await 做('o-甲', 'transferCaptain', { teamId: 队.id, userId: 账号['o-长'].id })).message).toBe('not_team_leader');
    expect((await 做('o-长', 'transferCaptain', { teamId: 队.id, userId: 账号['o-丙'].id })).message).toBe('member_not_found');
    expect((await 做('o-长', 'transferCaptain', { teamId: 队.id, userId: 账号['o-长'].id })).message).toBe('already_leader');
    const 转后 = (await 做('o-长', 'transferCaptain', { teamId: 队.id, userId: 账号['o-甲'].id })).data.team;
    expect(转后).toMatchObject({ isLeader: false, isMember: true, wechat: '' });
    const 甲看 = (await 做('o-甲', 'getTeam', { teamId: 队.id })).data.team;
    expect(甲看).toMatchObject({ isLeader: true, wechat: '' });
    expect(甲看.members.find(m => m.userId === 账号['o-长'].id).role).toBe('member');
    // 原队长不能再管，新队长能补微信号、能退的是原队长
    expect((await 做('o-长', 'renameTeam', { teamId: 队.id, name: 'x' })).message).toBe('not_team_leader');
    expect((await 做('o-长', 'setWechat', { teamId: 队.id, wechat: 'wx_old' })).message).toBe('not_team_leader');
    expect((await 做('o-甲', 'setWechat', { teamId: 队.id, wechat: ' ' })).message).toBe('invalid_wechat');
    expect((await 做('o-甲', 'setWechat', { teamId: 队.id, wechat: 'wx_jia' })).data.team.wechat).toBe('wx_jia');
    expect((await 做('o-长', 'getTeam', { teamId: 队.id })).data.team.wechat).toBe('wx_jia');
    expect((await 做('o-长', 'leaveTeam', { teamId: 队.id })).data).toEqual({ left: true });
  });
  test('转让后新队长审待审的申请', async () => {
    const { 做, 账号 } = 环境();
    const 队 = (await 建队(做)).data.team;
    await 入队(做, 'o-甲', 队.id);
    const 乙申 = (await 申请(做, 'o-乙', 队.id)).data.application;
    await 做('o-长', 'transferCaptain', { teamId: 队.id, userId: 账号['o-甲'].id });
    expect((await 做('o-长', 'listPendingForMe')).data.items).toEqual([]);
    expect((await 做('o-甲', 'listPendingForMe')).data.items.map(i => i.application.id)).toEqual([乙申.id]);
    expect((await 做('o-长', 'decideApplication', { applicationId: 乙申.id, decision: 'approve' })).message).toBe('not_team_leader');
    expect((await 做('o-甲', 'decideApplication', { applicationId: 乙申.id, decision: 'approve' })).data.team.memberCount).toBe(3);
  });
  test('踢人：只有队长；不能踢自己；被踢的不在队里了，可以重新申请', async () => {
    const { 做, 账号 } = 环境();
    const 队 = (await 建队(做)).data.team;
    await 入队(做, 'o-甲', 队.id);
    await 入队(做, 'o-乙', 队.id);
    expect((await 做('o-甲', 'removeMember', { teamId: 队.id, userId: 账号['o-乙'].id })).message).toBe('not_team_leader');
    expect((await 做('o-长', 'removeMember', { teamId: 队.id, userId: 账号['o-长'].id })).message).toBe('cannot_remove_self');
    expect((await 做('o-长', 'removeMember', { teamId: 队.id, userId: 账号['o-丙'].id })).message).toBe('member_not_found');
    expect((await 做('o-长', 'removeMember', { teamId: 队.id, userId: 账号['o-乙'].id })).data.team.memberCount).toBe(2);
    expect((await 做('o-乙', 'listMyTeams')).data.teams).toEqual([]);
    expect((await 做('o-乙', 'getTeam', { teamId: 队.id })).data.team.isMember).toBe(false);
    expect((await 申请(做, 'o-乙', 队.id)).ok).toBe(true);
  });
});

describe('解散和退出', () => {
  test('队长不能退出，队员可以', async () => {
    const { 做 } = 环境();
    const 队 = (await 建队(做)).data.team;
    await 入队(做, 'o-乙', 队.id);
    expect((await 做('o-长', 'leaveTeam', { teamId: 队.id })).message).toBe('leader_cannot_leave');
    expect((await 做('o-乙', 'leaveTeam', { teamId: 队.id })).data).toEqual({ left: true });
    expect((await 做('o-乙', 'listMyTeams')).data.teams).toEqual([]);
    expect((await 做('o-乙', 'leaveTeam', { teamId: 队.id })).message).toBe('not_team_member');
  });
  test('只有队长能解散；解散后队伍、队员、申请都删掉，再查是 team_not_found', async () => {
    const { 做, 用户库 } = 环境();
    const 队 = (await 建队(做)).data.team;
    await 入队(做, 'o-乙', 队.id);
    const 甲申 = (await 申请(做, 'o-甲', 队.id)).data.application;
    expect((await 做('o-乙', 'disbandTeam', { teamId: 队.id })).message).toBe('not_team_leader');
    expect((await 做('o-长', 'disbandTeam', { teamId: 队.id })).data).toEqual({ disbanded: true });
    expect([用户库.count('team'), 用户库.count('team_member'), 用户库.count('team_application')]).toEqual([0, 0, 0]);
    expect((await 做('o-乙', 'listMyTeams')).data.teams).toEqual([]);
    expect((await 做('o-甲', 'listMyApplications')).data.items.find(a => a.id === 甲申.id)).toBeUndefined();
    expect((await 做('o-丙', 'getTeam', { teamId: 队.id })).message).toBe('team_not_found');
    expect((await 申请(做, 'o-丙', 队.id)).message).toBe('team_not_found');
    expect((await 做('o-长', 'disbandTeam', { teamId: 队.id })).message).toBe('team_not_found');
  });
});

describe('订阅消息：有人申请时通知队长', () => {
  test('记次数：每调一次加一次，上限 50；getSubscribeQuota 交回次数和模板编号', async () => {
    const { 做 } = 环境();
    expect((await 做('o-长', 'getSubscribeQuota')).data).toEqual({ quota: 0, templateId: 'tpl-team-apply' });
    expect((await 做('o-长', 'addSubscribeQuota')).data).toEqual({ quota: 1 });
    for (let i = 0; i < 60; i += 1) await 做('o-长', 'addSubscribeQuota');
    expect((await 做('o-长', 'getSubscribeQuota')).data.quota).toBe(50);
  });
  test('队长有次数：申请成功后给队长发一条，扣一次；内容是比赛、队伍、申请人、时间，点开到申请页', async () => {
    const { 做, 发过 } = 环境();
    const 队 = (await 建队(做)).data.team;
    await 做('o-长', 'addSubscribeQuota');
    await 做('o-长', 'addSubscribeQuota');
    expect((await 申请(做, 'o-甲', 队.id, { grade: '大二', major: '软件工程' })).ok).toBe(true);
    await 等发完();
    expect(发过).toEqual([{
      touser: 'o-长', template_id: 'tpl-team-apply', page: 'pages/team-applications/team-applications', miniprogram_state: 'formal', lang: 'zh_CN',
      data: { thing1: { value: '全国大学生数学建模竞赛' }, thing2: { value: '冲国一' }, thing3: { value: '大二 软件工程' }, time4: { value: '2026年11月08日 10:00' } },
    }]);
    expect((await 做('o-长', 'getSubscribeQuota')).data.quota).toBe(1);
  });
  test('长文字截到 20 字；没起队名写“未命名队伍”', async () => {
    const { 做, 发过 } = 环境();
    const 队 = (await 建队(做, { name: '' })).data.team;
    await 做('o-长', 'addSubscribeQuota');
    await 申请(做, 'o-甲', 队.id, { major: '专'.repeat(30), grade: '研一' });
    await 等发完();
    expect(发过[0].data.thing2.value).toBe('未命名队伍');
    expect([...发过[0].data.thing3.value]).toHaveLength(20);
  });
  test('没次数不发；没配模板不发、只记日志；两种情况申请都照常成功、不扣次数', async () => {
    const 没次数 = 环境();
    const 队1 = (await 建队(没次数.做)).data.team;
    expect((await 申请(没次数.做, 'o-甲', 队1.id)).ok).toBe(true);
    await 等发完();
    expect(没次数.发过).toEqual([]);

    const 没模板 = 环境({ 通知模板: null });
    const 队2 = (await 建队(没模板.做)).data.team;
    await 没模板.做('o-长', 'addSubscribeQuota');
    expect((await 没模板.做('o-长', 'getSubscribeQuota')).data).toEqual({ quota: 1, templateId: null });
    expect((await 申请(没模板.做, 'o-甲', 队2.id)).ok).toBe(true);
    await 等发完();
    expect(没模板.发过).toEqual([]);
    expect(没模板.日志.join('\n')).toContain('TEAM_APPLY_TEMPLATE_ID');
    expect((await 没模板.做('o-长', 'getSubscribeQuota')).data.quota).toBe(1);
  });
  test('发送失败不影响申请：微信说用户没授权（43101）次数清零；别的明确失败退回这一次；结果不明不退', async () => {
    for (const [结果, 剩] of [[{ errcode: 43101, errmsg: 'user refuse to accept the msg' }, 0], [{ errcode: 47003, errmsg: 'argument invalid' }, 3], [{ uncertain: true, error: 'send_no_response' }, 2]]) {
      const { 做, 发过 } = 环境({ 发送结果: 结果 });
      const 队 = (await 建队(做)).data.team;
      for (let i = 0; i < 3; i += 1) await 做('o-长', 'addSubscribeQuota');
      expect((await 申请(做, 'o-甲', 队.id)).ok, JSON.stringify(结果)).toBe(true);
      await 等发完();
      expect(发过).toHaveLength(1);
      expect((await 做('o-长', 'getSubscribeQuota')).data.quota, JSON.stringify(结果)).toBe(剩);
    }
  });
  test('发送函数抛错也不影响申请，记日志、退回这一次', async () => {
    const { 做, 日志 } = 环境({ 发送结果: () => { throw new Error('网络断了'); } });
    const 队 = (await 建队(做)).data.team;
    await 做('o-长', 'addSubscribeQuota');
    expect((await 申请(做, 'o-甲', 队.id)).ok).toBe(true);
    await 等发完();
    expect(日志.join('\n')).toContain('网络断了');
    expect((await 做('o-长', 'getSubscribeQuota')).data.quota).toBe(1);
  });
  test('读通知模板：没配编号是 null；字段用“比赛=thing1,队伍=thing2”的写法，没配字段也是 null', () => {
    expect(读通知模板({})).toBeNull();
    expect(读通知模板({ TEAM_APPLY_TEMPLATE_ID: 'tpl' })).toBeNull();
    expect(读通知模板({ TEAM_APPLY_TEMPLATE_ID: ' tpl ', TEAM_APPLY_TEMPLATE_FIELDS: '比赛=thing1, 申请人=thing3 ,时间=time4,乱写=x1,坏' }))
      .toEqual({ id: 'tpl', 字段: { 比赛: 'thing1', 申请人: 'thing3', 时间: 'time4' } });
  });
});

test('校赛组队要求已发布和本校身份；下架后保留队伍，跨校访客只看简版', async () => {
  const { 用户库, 账号, 做 } = 环境({ 通知模板: null });
  const 学校 = '测试大学';
  const 管 = 账号['o-长'].id;
  const 申请记录 = 校赛.申请管理员(用户库, 管, { school: 学校, real_name: '测试', contact: '测试', proof: '测试' }, { now: NOW });
  校赛.处理管理员申请(用户库, 申请记录.id, { status: '已通过' }, { 读到的更新时间: 申请记录.updated_at });
  const 赛 = 校赛.发布(用户库, 管, 学校, { title: '本校选拔', content: '校内通知' }, { now: NOW });
  expect((await 建队(做, { competitionId: 赛.id })).message).toBe('competition_not_found');
  校赛.处理校赛(用户库, 赛.id, { status: '已发布' }, { 读到的更新时间: 赛.updated_at });
  const 队 = (await 建队(做, { competitionId: 赛.id })).data.team;
  expect(队.competitionName).toBe('本校选拔');
  const 建队资料 = { competitionId: 赛.id, maxMembers: 3, wechat: 'wx_test' };
  expect((await 做('o-甲', 'createTeam', 建队资料)).message).toBe('not_school_member');
  expect((await 做('o-甲', 'getTeam', { teamId: 队.id })).data.team).not.toHaveProperty('wechat');
  expect((await 申请(做, 'o-甲', 队.id)).message).toBe('not_school_member');
  const 邀请 = 校赛.有效邀请(用户库, 管, 学校, { now: NOW });
  校赛.加入(用户库, 账号['o-甲'].id, { school: 学校, real_name: '学生', college: '学院', major: '专业', student_no: '1', invite_code: 邀请.id }, { now: NOW });
  expect((await 入队(做, 'o-甲', 队.id)).ok).toBe(true);
  校赛.下架(用户库, 赛.id);
  expect((await 做('o-甲', 'getTeam', { teamId: 队.id })).data.team).toMatchObject({ competitionName: '校赛已下架', isMember: true });
  expect((await 申请(做, 'o-乙', 队.id)).message).toBe('competition_not_found');
});

test('微信拦截队名、入队介绍和擅长方向时不写入', async () => {
  const { 主库, 用户库, 做 } = 环境();
  const 调用 = [];
  const 微信 = { msgSecCheck: async payload => { 调用.push(payload); return { result: { suggest: 'risky' } }; } };
  const 审 = (openid, action, event) => handle({ action, ...event }, { 主库, 用户库, openid, 微信 });
  expect((await 建队(审)).message).toBe('content_not_allowed');
  expect(用户库.count('team', {})).toBe(0);
  const 队 = (await 建队(做)).data.team;
  expect((await 申请(审, 'o-甲', 队.id, { intro: '介绍', strengths: '擅长' })).message).toBe('content_not_allowed');
  expect((await 审('o-长', 'renameTeam', { teamId: 队.id, name: '新队名' })).message).toBe('content_not_allowed');
  expect(用户库.count('team_application', {})).toBe(0);
  expect(调用[1]).toMatchObject({ openid: 'o-甲', content: '介绍\n擅长' });
});
