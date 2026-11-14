// 校赛（2026-11-08 粗版本）：副数据库里的四张表和存取工具。表名、字段名是和美国审核的接口，不能随便改。
//   school_admin 管理员申请（美国审核）  school_member 本校学生（不传美国）  school_invite 邀请码  school_contest 校赛（美国审核）
// 美国审核完经 沟通/审核结果回传 调 处理管理员申请、处理校赛；读到的更新时间对不上照 纠错.处理 抛 feedback_conflict。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { openUserDb, STRUCTURE_DIR, 用户, 校赛 } from '../../index.mjs';
import { buildFileSql } from '../../结构/生成.mjs';

const at = '2026-11-08T04:00:00.000Z';
const 选项 = { now: new Date(at) };
const 钟 = { 时间: at };
const open = () => { 钟.时间 = at; return openUserDb({ file: ':memory:', now: () => new Date(钟.时间) }); };
const 第二天 = () => { 钟.时间 = '2026-11-09T00:00:00.000Z'; return { now: new Date(钟.时间) }; };
const 新用户 = (db, openid) => 用户.新建或登录(db, { openid }, 选项);
const 申请内容 = (改 = {}) => ({ school: '浙江大学', real_name: '张老师', contact: '13800000000', proof: '计算机学院团委老师', ...改 });
const 校赛内容 = (改 = {}) => ({ title: '校程序设计大赛', content: '面向全校本科生', signup: '团委公众号报名', start_date: '2026-12-01', end_date: '2026-12-10', ...改 });

// 申请 → 美国审核通过
function 已通过的管理员(db, openid = 'o-admin', school = '浙江大学') {
  const 人 = 新用户(db, openid);
  const 申请 = 校赛.申请管理员(db, 人.id, 申请内容({ school }), 选项);
  校赛.处理管理员申请(db, 申请.id, { status: '已通过', review_note: '核实' }, { 读到的更新时间: 申请.updated_at, ...选项 });
  return 人;
}

describe('建表', () => {
  test('003-校赛.sql 和按描述生成的一致；四张表都建好', () => {
    expect(fs.readFileSync(path.join(STRUCTURE_DIR, '003-校赛.sql'), 'utf8')).toBe(buildFileSql('003-校赛.sql'));
    const db = open();
    for (const 表 of ['school_admin', 'school_member', 'school_invite', 'school_contest']) expect(db.count(表)).toBe(0);
  });
});

describe('管理员申请', () => {
  test('申请：待审核；同一用户同一学校待审核、已通过的不能重复申请，被拒的可以再申请', () => {
    const db = open();
    const 甲 = 新用户(db, 'o-1');
    const 申请 = 校赛.申请管理员(db, 甲.id, 申请内容(), 选项);
    expect(申请).toMatchObject({ user: 甲.id, school: '浙江大学', status: '待审核', version: 1, created_at: at });
    expect(() => 校赛.申请管理员(db, 甲.id, 申请内容(), 选项)).toThrow('school_admin_already_applied');
    expect(校赛.申请管理员(db, 甲.id, 申请内容({ school: '杭州电子科技大学' }), 选项).status).toBe('待审核');
    校赛.处理管理员申请(db, 申请.id, { status: '已拒绝', review_note: '材料不足' }, { 读到的更新时间: 申请.updated_at, ...选项 });
    expect(校赛.申请管理员(db, 甲.id, 申请内容(), 选项).status).toBe('待审核');
    expect(校赛.我的申请(db, 甲.id)).toHaveLength(3);
  });
  test('处理管理员申请：只能改成已通过、已拒绝；读到的更新时间对不上抛 feedback_conflict；找不到抛 feedback_not_found', () => {
    const db = open();
    const 甲 = 新用户(db, 'o-1');
    const 申请 = 校赛.申请管理员(db, 甲.id, 申请内容(), 选项);
    expect(() => 校赛.处理管理员申请(db, 申请.id, { status: '待审核' }, { 读到的更新时间: 申请.updated_at, ...选项 })).toThrow('invalid_school_admin_status');
    expect(() => 校赛.处理管理员申请(db, 申请.id, { status: '已通过' }, { 读到的更新时间: '2026-10-01T00:00:00.000Z', ...选项 })).toThrow('feedback_conflict');
    expect(() => 校赛.处理管理员申请(db, 'school-admin-没有', { status: '已通过' }, { 读到的更新时间: at, ...选项 })).toThrow('feedback_not_found');
    const 后 = 校赛.处理管理员申请(db, 申请.id, { status: '已通过', review_note: '核实' }, { 读到的更新时间: 申请.updated_at, ...第二天() });
    expect(后).toMatchObject({ status: '已通过', review_note: '核实', version: 2, updated_at: '2026-11-09T00:00:00.000Z' });
    expect(校赛.是管理员(db, 甲.id, '浙江大学')).toBe(true);
    expect(校赛.是管理员(db, 甲.id, '杭州电子科技大学')).toBe(false);
    expect(校赛.管理的学校(db, 甲.id)).toEqual(['浙江大学']);
  });
});

describe('邀请和学生', () => {
  test('邀请码随机；有效的就交回同一个，换邀请后旧的作废', () => {
    const db = open();
    const 管 = 已通过的管理员(db);
    const 码 = 校赛.有效邀请(db, 管.id, '浙江大学', 选项);
    expect(码.id).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(校赛.有效邀请(db, 管.id, '浙江大学', 选项).id).toBe(码.id);
    const 新码 = 校赛.换邀请(db, 管.id, '浙江大学', 选项);
    expect(新码.id).not.toBe(码.id);
    expect(校赛.读邀请(db, 码.id).revoked_at).toBe(at);
    expect(校赛.读邀请(db, 新码.id).revoked_at).toBeNull();
  });
  test('加入：同一用户同一学校只一行，再加入就更新信息；名单、移出、退出', () => {
    const db = open();
    const 管 = 已通过的管理员(db);
    const 码 = 校赛.有效邀请(db, 管.id, '浙江大学', 选项);
    const 生 = 新用户(db, 'o-stu');
    const 行 = 校赛.加入(db, 生.id, { school: '浙江大学', real_name: '李同学', college: '计算机学院', major: '软件工程', student_no: '3220001', invite_code: 码.id }, 选项);
    expect(行).toMatchObject({ user: 生.id, school: '浙江大学', student_no: '3220001', joined_at: at });
    校赛.加入(db, 生.id, { school: '浙江大学', real_name: '李同学', college: '计算机学院', major: '人工智能', student_no: '3220001', invite_code: 码.id }, 第二天());
    expect(校赛.学生名单(db, '浙江大学').map(m => m.major)).toEqual(['人工智能']);
    expect(校赛.我的学校(db, 生.id).map(m => m.school)).toEqual(['浙江大学']);
    const 生2 = 新用户(db, 'o-stu2');
    const 行2 = 校赛.加入(db, 生2.id, { school: '浙江大学', real_name: '王同学', college: '理学院', major: '数学', student_no: '3220002', invite_code: 码.id }, 选项);
    expect(校赛.移出(db, '浙江大学', 行2.id)).toEqual({ 删了: 1 });
    expect(校赛.移出(db, '杭州电子科技大学', 行.id)).toEqual({ 删了: 0 });
    expect(校赛.退出(db, 生.id, '浙江大学')).toEqual({ 删了: 1 });
    expect(校赛.学生名单(db, '浙江大学')).toEqual([]);
  });
});

describe('校赛', () => {
  test('发布 → 待审核；美国审核后只有已发布的给本校看；处理校赛只能改成已发布、已拒绝、已下架', () => {
    const db = open();
    const 管 = 已通过的管理员(db);
    const 赛 = 校赛.发布(db, 管.id, '浙江大学', 校赛内容(), 选项);
    expect(赛).toMatchObject({ school: '浙江大学', admin: 管.id, status: '待审核', version: 1 });
    expect(校赛.已发布的(db, ['浙江大学'])).toEqual([]);
    expect(() => 校赛.处理校赛(db, 赛.id, { status: '待审核' }, { 读到的更新时间: 赛.updated_at, ...选项 })).toThrow('invalid_school_contest_status');
    expect(() => 校赛.处理校赛(db, 赛.id, { status: '已发布' }, { 读到的更新时间: '2026-10-01T00:00:00.000Z', ...选项 })).toThrow('feedback_conflict');
    expect(() => 校赛.处理校赛(db, 'school-contest-没有', { status: '已发布' }, { 读到的更新时间: at, ...选项 })).toThrow('feedback_not_found');
    const 后 = 校赛.处理校赛(db, 赛.id, { status: '已发布', review_note: '通过' }, { 读到的更新时间: 赛.updated_at, ...第二天() });
    expect(后).toMatchObject({ status: '已发布', review_note: '通过', version: 2 });
    expect(校赛.已发布的(db, ['浙江大学']).map(c => c.id)).toEqual([赛.id]);
    expect(校赛.已发布的(db, ['杭州电子科技大学'])).toEqual([]);
    expect(校赛.学校的校赛(db, '浙江大学').map(c => c.id)).toEqual([赛.id]);
    const 下 = 校赛.下架(db, 赛.id, 选项);
    expect(下.status).toBe('已下架');
    expect(校赛.已发布的(db, ['浙江大学'])).toEqual([]);
  });
  test('注销账号：申请、学生信息、邀请、发的校赛一起删', () => {
    const db = open();
    const 管 = 已通过的管理员(db);
    校赛.有效邀请(db, 管.id, '浙江大学', 选项);
    校赛.发布(db, 管.id, '浙江大学', 校赛内容(), 选项);
    const { 连带 } = 用户.删除(db, 管.id);
    expect(连带).toMatchObject({ school_admin: 1, school_invite: 1, school_contest: 1 });
  });
});
