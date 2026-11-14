// 副数据库的组队表（2026-11-08 建，11-09 按用户定的规则改）：队伍、队员、组队申请、组队通知次数，都挂在用户下（user_id）。只测存取；谁能做什么由 服务/组队/ 判断。
// 建表在 结构/002-组队.sql（还没部署到任何服务器，可以直接改），内容和按描述生成的一致。
// 11-09：去掉队员意见（reviews）；申请加专业、年级（必填）、擅长方向（选填）；队伍不留“已解散”，解散直接删；队长微信号转让时清空，允许为空。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { openUserDb, STRUCTURE_DIR, 用户, 组队 } from '../../index.mjs';
import { buildFileSql, buildUserSql, FIRST_FILE } from '../../结构/生成.mjs';

const at = '2026-11-08T04:00:00.000Z';
const 选项 = { now: new Date(at) };
const open = () => openUserDb({ file: ':memory:', now: () => new Date(at) });
const 三个人 = db => ['o-队长', 'o-甲', 'o-乙'].map(openid => 用户.新建或登录(db, { openid }, 选项));
const 队伍内容 = (改 = {}) => ({ competition_id: 'event-math', max_members: 3, leader_wechat: 'wx_leader', name: '冲国一，缺建模手', ...改 });
const 申请内容 = (改 = {}) => ({ major: '计算机科学与技术', grade: '大二', intro: '会 Python', strengths: '建模、写代码', ...改 });

describe('建表', () => {
  test('001 只有原来六张表，组队四张在 002；两份都和按描述生成的一致', () => {
    expect(fs.readFileSync(FIRST_FILE, 'utf8')).toBe(buildUserSql());
    expect(fs.readFileSync(path.join(STRUCTURE_DIR, '002-组队.sql'), 'utf8')).toBe(buildFileSql('002-组队.sql'));
    expect(buildFileSql('002-组队.sql').match(/CREATE TABLE \w+/g)).toEqual(['CREATE TABLE team', 'CREATE TABLE team_member', 'CREATE TABLE team_application', 'CREATE TABLE team_notify_quota']);
    const db = open();
    for (const 表 of ['team', 'team_member', 'team_application', 'team_notify_quota']) expect(db.count(表)).toBe(0);
  });
  test('队伍没有状态、解散时间；申请没有队员意见，有专业、年级、擅长方向', () => {
    const sql = buildFileSql('002-组队.sql');
    expect(sql).not.toMatch(/\bstatus TEXT NOT NULL,\n\s+disbanded_at/);
    expect(sql).not.toContain('disbanded_at');
    expect(sql).not.toContain('reviews');
    expect(sql).toMatch(/major TEXT NOT NULL/);
    expect(sql).toMatch(/grade TEXT NOT NULL/);
    expect(sql).toMatch(/strengths TEXT/);
    // 队长微信号转让时清空、新队长再补，所以可以为空
    expect(sql).toMatch(/leader_wechat TEXT,/);
  });
});

describe('队伍和队员', () => {
  test('建队：版本 1，队长同时记成队员（角色队长）', () => {
    const db = open();
    const [长] = 三个人(db);
    const 队 = 组队.建队(db, 长.id, 队伍内容(), 选项);
    expect(队).toMatchObject({ user_id: 长.id, competition_id: 'event-math', max_members: 3, version: 1, created_at: at });
    expect(队).not.toHaveProperty('status');
    expect(队.id).toMatch(/^team-/);
    expect(组队.队员们(db, 队.id)).toEqual([expect.objectContaining({ user_id: 长.id, role: 'leader', joined_at: at })]);
    expect(组队.读队(db, 队.id).name).toBe('冲国一，缺建模手');
  });
  test('加队员、是队员、我参加的、删队员；同一人不能在同一队两次', () => {
    const db = open();
    const [长, 甲] = 三个人(db);
    const 队 = 组队.建队(db, 长.id, 队伍内容(), 选项);
    组队.加队员(db, 队.id, 甲.id, 选项);
    expect(组队.是队员(db, 队.id, 甲.id)).toMatchObject({ role: 'member' });
    expect(组队.我参加的(db, 甲.id).map(t => t.id)).toEqual([队.id]);
    expect(() => 组队.加队员(db, 队.id, 甲.id, 选项)).toThrow();
    expect(组队.删队员(db, 队.id, 甲.id)).toEqual({ 删了: 1 });
    expect(组队.是队员(db, 队.id, 甲.id)).toBeNull();
  });
  test('改队要带版本号：改名后版本加一；拿旧版本改报版本冲突', () => {
    const db = open();
    const [长] = 三个人(db);
    const 队 = 组队.建队(db, 长.id, 队伍内容(), 选项);
    const 后 = 组队.改队(db, 队.id, { name: '新名字' }, 队.version);
    expect(后).toMatchObject({ name: '新名字', version: 2 });
    expect(() => 组队.改队(db, 队.id, { name: 'x' }, 1)).toThrow(expect.objectContaining({ kind: '版本冲突' }));
  });
  test('换队长：队伍挂到新队长名下、微信号清空，两人角色互换；新队长要是本队队员', () => {
    const db = open();
    const [长, 甲, 乙] = 三个人(db);
    const 队 = 组队.建队(db, 长.id, 队伍内容(), 选项);
    组队.加队员(db, 队.id, 甲.id, 选项);
    const 后 = 组队.换队长(db, 队.id, 甲.id, 队.version);
    expect(后).toMatchObject({ user_id: 甲.id, leader_wechat: null, version: 2 });
    expect(组队.是队员(db, 队.id, 甲.id).role).toBe('leader');
    expect(组队.是队员(db, 队.id, 长.id).role).toBe('member');
    expect(() => 组队.换队长(db, 队.id, 乙.id, 后.version)).toThrow('新队长不是本队队员');
  });
  test('解散：队伍、队员、申请一起删掉，不留记录', () => {
    const db = open();
    const [长, 甲, 乙] = 三个人(db);
    const 队 = 组队.建队(db, 长.id, 队伍内容(), 选项);
    组队.加队员(db, 队.id, 甲.id, 选项);
    组队.新申请(db, 队.id, 乙.id, 申请内容(), 选项);
    const 别的队 = 组队.建队(db, 甲.id, 队伍内容(), 选项);
    组队.解散(db, 队.id);
    expect(组队.读队(db, 队.id)).toBeNull();
    expect([db.count('team'), db.count('team_member'), db.count('team_application')]).toEqual([1, 1, 0]);
    expect(组队.读队(db, 别的队.id)).not.toBeNull();
  });
  test('超长的微信号、名称，人数不是整数：数据库拒绝', () => {
    const db = open();
    const [长] = 三个人(db);
    for (const 改 of [{ leader_wechat: 'w'.repeat(51) }, { name: '名'.repeat(51) }, { max_members: 2.5 }]) {
      expect(() => 组队.建队(db, 长.id, 队伍内容(改), 选项)).toThrow(expect.objectContaining({ kind: '校验不通过' }));
    }
  });
});

describe('组队申请', () => {
  test('新申请待审，带专业、年级、介绍、擅长方向；改申请记处理结果；按队、按状态、按申请人列', () => {
    const db = open();
    const [长, 甲] = 三个人(db);
    const 队 = 组队.建队(db, 长.id, 队伍内容(), 选项);
    const 申 = 组队.新申请(db, 队.id, 甲.id, 申请内容(), 选项);
    expect(申).toMatchObject({ team_id: 队.id, user_id: 甲.id, major: '计算机科学与技术', grade: '大二', intro: '会 Python', strengths: '建模、写代码', status: 'pending', created_at: at });
    expect(申).not.toHaveProperty('reviews');
    expect(申.id).toMatch(/^team-application-/);
    expect(组队.改申请(db, 申.id, { status: 'approved', handled_by: 长.id, handled_at: at }, 选项)).toMatchObject({ status: 'approved', handled_by: 长.id });
    expect(组队.申请们(db, { team_id: 队.id, status: 'approved' }).map(a => a.id)).toEqual([申.id]);
    expect(组队.申请们(db, { team_id: 队.id, status: 'pending' })).toEqual([]);
    expect(组队.我发出的(db, 甲.id).map(a => a.id)).toEqual([申.id]);
  });
  test('介绍、擅长方向选填（空存 null）；专业、年级缺了或超长：数据库拒绝', () => {
    const db = open();
    const [长, 甲] = 三个人(db);
    const 队 = 组队.建队(db, 长.id, 队伍内容(), 选项);
    expect(组队.新申请(db, 队.id, 甲.id, 申请内容({ intro: '', strengths: '' }), 选项)).toMatchObject({ intro: null, strengths: null });
    for (const 改 of [{ major: '' }, { grade: '' }, { major: '专'.repeat(31) }, { grade: '年'.repeat(21) }, { intro: '介'.repeat(201) }, { strengths: '擅'.repeat(51) }]) {
      expect(() => 组队.新申请(db, 队.id, 甲.id, 申请内容(改), 选项), JSON.stringify(改)).toThrow(expect.objectContaining({ kind: '校验不通过' }));
    }
  });
  test('注销账号：他建的队、队员身份、申请、通知次数一起删', () => {
    const db = open();
    const [长, 甲] = 三个人(db);
    const 队 = 组队.建队(db, 长.id, 队伍内容(), 选项);
    组队.新申请(db, 队.id, 甲.id, 申请内容(), 选项);
    组队.加通知次数(db, 长.id, 10, 选项);
    用户.删除(db, 长.id);
    expect([db.count('team'), db.count('team_member'), db.count('team_application'), db.count('team_notify_quota')]).toEqual([0, 0, 0, 0]);
  });
});

describe('组队通知次数（订阅消息）', () => {
  test('没记过是 0；加一次多一次，到上限不再加；扣一次少一次，没有了扣不到；清零', () => {
    const db = open();
    const [长] = 三个人(db);
    expect(组队.通知次数(db, 长.id)).toBe(0);
    expect(组队.扣通知次数(db, 长.id, 选项)).toBe(false);
    expect(组队.加通知次数(db, 长.id, 2, 选项)).toBe(1);
    expect(组队.加通知次数(db, 长.id, 2, 选项)).toBe(2);
    expect(组队.加通知次数(db, 长.id, 2, 选项)).toBe(2);
    expect(组队.扣通知次数(db, 长.id, 选项)).toBe(true);
    expect(组队.通知次数(db, 长.id)).toBe(1);
    组队.清零通知次数(db, 长.id, 选项);
    expect(组队.通知次数(db, 长.id)).toBe(0);
  });
});
