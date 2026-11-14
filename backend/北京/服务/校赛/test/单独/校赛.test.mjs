// 校赛服务（2026-11-08 粗版本）：申请管理员 → 美国审核通过 → 生成邀请码发给学生 → 学生填信息加入 → 管理员发校赛 → 美国审核发布 → 本校看得到。
// 身份由入口校验令牌后交进 openid；美国审核这里用 校赛.处理管理员申请、校赛.处理校赛 直接模拟（真的经 沟通/审核结果回传 调）。
import { describe, expect, test } from 'vitest';
import { openUserDb, 用户, 校赛 } from '../../../../副数据库/index.mjs';
import { handle } from '../../index.mjs';

const NOW = new Date('2026-11-08T04:00:00Z');
function 环境() {
  const 用户库 = openUserDb({ file: ':memory:', now: () => NOW });
  for (const openid of ['o-admin', 'o-stu', 'o-other']) 用户.新建或登录(用户库, { openid }, { now: NOW });
  return { 用户库, now: () => NOW };
}
const 做 = (env, openid, action, 参数 = {}) => handle({ action, ...参数 }, { ...env, openid });
const 申请 = { school: '浙江大学', realName: '张老师', contact: '13800000000', proof: '计算机学院团委老师' };
const 学生信息 = { realName: '李同学', college: '计算机学院', major: '软件工程', studentNo: '3220001' };
const 一场校赛 = { school: '浙江大学', title: '校程序设计大赛', content: '面向全校本科生', signup: '团委公众号报名', startDate: '2026-12-01', endDate: '2026-12-10' };

// 申请并由“美国”审核通过
async function 当上管理员(env, openid = 'o-admin') {
  const r = await 做(env, openid, 'applyAdmin', 申请);
  const 行 = 校赛.处理管理员申请(env.用户库, r.data.application.id, { status: '已通过' }, { 读到的更新时间: r.data.application.updatedAt, now: NOW });
  return 行;
}

describe('身份', () => {
  test('没身份 unauthenticated；不认识的动作 unsupported_action', async () => {
    const env = 环境();
    expect(await 做(env, '', 'myStatus')).toEqual({ ok: false, message: 'unauthenticated' });
    expect(await 做(env, 'o-陌生', 'myStatus')).toEqual({ ok: false, message: 'unauthenticated' });
    expect(await 做(env, 'o-admin', 'dropAll')).toEqual({ ok: false, message: 'unsupported_action' });
  });
});

describe('申请管理员', () => {
  test('填学校、姓名、联系方式、证明说明 → 待审核；重复申请拒绝；必填、长度上限', async () => {
    const env = 环境();
    const r = await 做(env, 'o-admin', 'applyAdmin', 申请);
    expect(r).toMatchObject({ ok: true, data: { application: { school: '浙江大学', realName: '张老师', status: '待审核', reviewNote: '' } } });
    expect(await 做(env, 'o-admin', 'applyAdmin', 申请)).toEqual({ ok: false, message: 'school_admin_already_applied' });
    expect(await 做(env, 'o-other', 'applyAdmin', { ...申请, proof: ' ' })).toEqual({ ok: false, message: 'invalid_proof' });
    expect(await 做(env, 'o-other', 'applyAdmin', { ...申请, school: '大'.repeat(101) })).toEqual({ ok: false, message: 'school_too_long' });
  });
  test('我的身份：申请状态、管理的学校、我是哪个学校的学生', async () => {
    const env = 环境();
    expect((await 做(env, 'o-admin', 'myStatus')).data).toEqual({ adminSchools: [], applications: [], memberships: [] });
    await 当上管理员(env);
    const 我 = (await 做(env, 'o-admin', 'myStatus')).data;
    expect(我.adminSchools).toEqual(['浙江大学']);
    expect(我.applications.map(a => a.status)).toEqual(['已通过']);
  });
});

describe('管理员：只有已通过的才能做', () => {
  test('没通过（待审核、别的学校）报 not_school_admin', async () => {
    const env = 环境();
    await 做(env, 'o-admin', 'applyAdmin', 申请);
    for (const [action, 参数] of [['createInvite', { school: '浙江大学' }], ['listMembers', { school: '浙江大学' }], ['publishContest', 一场校赛], ['myContests', { school: '浙江大学' }]]) {
      expect(await 做(env, 'o-admin', action, 参数), action).toEqual({ ok: false, message: 'not_school_admin' });
    }
  });
  test('生成邀请交回同一个码，换邀请旧码作废', async () => {
    const env = 环境();
    await 当上管理员(env);
    const 码 = (await 做(env, 'o-admin', 'createInvite', { school: '浙江大学' })).data;
    expect(码).toMatchObject({ school: '浙江大学' });
    expect(码.inviteCode).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect((await 做(env, 'o-admin', 'createInvite', { school: '浙江大学' })).data.inviteCode).toBe(码.inviteCode);
    const 新码 = (await 做(env, 'o-admin', 'renewInvite', { school: '浙江大学' })).data.inviteCode;
    expect(新码).not.toBe(码.inviteCode);
    expect(await 做(env, 'o-stu', 'joinSchool', { inviteCode: 码.inviteCode, ...学生信息 })).toEqual({ ok: false, message: 'invite_invalid' });
    expect((await 做(env, 'o-stu', 'joinSchool', { inviteCode: 新码, ...学生信息 })).ok).toBe(true);
  });
});

describe('学生', () => {
  test('邀请码有效 + 姓名、学院、专业、学号都填 → 立刻成为该校学生；再加入更新信息；名单、移出、退出', async () => {
    const env = 环境();
    await 当上管理员(env);
    const { inviteCode } = (await 做(env, 'o-admin', 'createInvite', { school: '浙江大学' })).data;
    expect(await 做(env, 'o-stu', 'joinSchool', { inviteCode, ...学生信息, studentNo: '' })).toEqual({ ok: false, message: 'invalid_student_no' });
    expect(await 做(env, 'o-stu', 'joinSchool', { inviteCode: 'nope', ...学生信息 })).toEqual({ ok: false, message: 'invite_invalid' });
    const 加 = await 做(env, 'o-stu', 'joinSchool', { inviteCode, ...学生信息 });
    expect(加).toMatchObject({ ok: true, data: { membership: { school: '浙江大学', realName: '李同学', studentNo: '3220001' } } });
    await 做(env, 'o-stu', 'joinSchool', { inviteCode, ...学生信息, major: '人工智能' });
    expect((await 做(env, 'o-stu', 'myStatus')).data.memberships.map(m => [m.school, m.major])).toEqual([['浙江大学', '人工智能']]);
    // 名单只有本校已通过的管理员能看；学生看不了
    expect(await 做(env, 'o-stu', 'listMembers', { school: '浙江大学' })).toEqual({ ok: false, message: 'not_school_admin' });
    const 名单 = (await 做(env, 'o-admin', 'listMembers', { school: '浙江大学' })).data;
    expect(名单.total).toBe(1);
    expect(名单.items[0]).toMatchObject({ realName: '李同学', college: '计算机学院', major: '人工智能', studentNo: '3220001' });
    expect((await 做(env, 'o-admin', 'removeMember', { school: '浙江大学', memberId: 名单.items[0].id })).data).toEqual({ removed: 1 });
    expect((await 做(env, 'o-admin', 'listMembers', { school: '浙江大学' })).data.total).toBe(0);
    await 做(env, 'o-stu', 'joinSchool', { inviteCode, ...学生信息 });
    expect((await 做(env, 'o-stu', 'leaveSchool', { school: '浙江大学' })).data).toEqual({ left: 1 });
    expect((await 做(env, 'o-stu', 'myStatus')).data.memberships).toEqual([]);
  });
});

describe('校赛：审核通过才给本校看', () => {
  test('发布 → 待审核，本校看不到；美国审核发布后本校学生、管理员看得到，别校看不到；下架后又看不到', async () => {
    const env = 环境();
    await 当上管理员(env);
    const { inviteCode } = (await 做(env, 'o-admin', 'createInvite', { school: '浙江大学' })).data;
    await 做(env, 'o-stu', 'joinSchool', { inviteCode, ...学生信息 });
    expect(await 做(env, 'o-admin', 'publishContest', { ...一场校赛, startDate: '2026-12-31', endDate: '2026-12-01' })).toEqual({ ok: false, message: 'invalid_date_range' });
    expect(await 做(env, 'o-admin', 'publishContest', { ...一场校赛, startDate: '12月1日' })).toEqual({ ok: false, message: 'invalid_start_date' });
    const 发 = await 做(env, 'o-admin', 'publishContest', 一场校赛);
    expect(发).toMatchObject({ ok: true, data: { contest: { title: '校程序设计大赛', status: '待审核', startDate: '2026-12-01' } } });
    expect((await 做(env, 'o-stu', 'listSchoolContests')).data.items).toEqual([]);
    const 原 = 校赛.读校赛(env.用户库, 发.data.contest.id);
    校赛.处理校赛(env.用户库, 原.id, { status: '已发布', review_note: '通过' }, { 读到的更新时间: 原.updated_at, now: NOW });
    expect((await 做(env, 'o-stu', 'listSchoolContests')).data.items.map(c => [c.title, c.school])).toEqual([['校程序设计大赛', '浙江大学']]);
    expect((await 做(env, 'o-admin', 'listSchoolContests')).data.items).toHaveLength(1);
    expect((await 做(env, 'o-other', 'listSchoolContests')).data.items).toEqual([]);
    expect((await 做(env, 'o-admin', 'myContests', { school: '浙江大学' })).data.items[0]).toMatchObject({ status: '已发布', reviewNote: '通过' });
    // 别人下架不了；本校管理员下架
    expect(await 做(env, 'o-stu', 'withdrawContest', { contestId: 原.id })).toEqual({ ok: false, message: 'not_school_admin' });
    expect((await 做(env, 'o-admin', 'withdrawContest', { contestId: 原.id })).data.contest.status).toBe('已下架');
    expect((await 做(env, 'o-stu', 'listSchoolContests')).data.items).toEqual([]);
    expect(await 做(env, 'o-admin', 'withdrawContest', { contestId: 'school-contest-没有' })).toEqual({ ok: false, message: 'school_contest_not_found' });
  });
});

test('微信明确拦截时申请和校赛均不入库；请求异常继续处理', async () => {
  const env = 环境();
  const 拦截 = { ...env, 微信: { msgSecCheck: async () => { throw new Error('wechat_msg_sec_check_failed:87014:risky'); } } };
  expect((await 做(拦截, 'o-admin', 'applyAdmin', 申请)).message).toBe('content_not_allowed');
  expect((await 做(env, 'o-admin', 'myStatus')).data.applications).toEqual([]);
  await 当上管理员(env);
  expect((await 做(拦截, 'o-admin', 'publishContest', 一场校赛)).message).toBe('content_not_allowed');
  expect((await 做(env, 'o-admin', 'myContests', { school: 申请.school })).data.items).toEqual([]);
  const 异常 = { ...env, 微信: { msgSecCheck: async () => { throw new Error('网络失败'); } } };
  expect((await 做(异常, 'o-admin', 'publishContest', 一场校赛)).ok).toBe(true);
});
