// 北京副数据库（用户管理中心）：用户是一级，下面五张表都挂在用户编号上：收藏、提醒、意见反馈、纠错、偏好。
// 字段沿用旧的上海云开发（userData、login 云函数和 database/schemas），收藏改挂比赛。用内存里的库跑，不碰任何真实库文件。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { openUserDb, STRUCTURE_DIR, 用户, 收藏, 提醒, 意见反馈, 纠错, 偏好 } from '../../index.mjs';
import { buildFileSql, buildUserSql, FIRST_FILE, 文件们 } from '../../结构/生成.mjs';

const at = '2026-11-01T04:00:00.000Z';
const 选项 = { now: new Date(at) };
// 库的时钟：通用的修改方法用它写“最后修改时间”；要测第二天改的，先拨到第二天
const 钟 = { 时间: at };
const open = () => { 钟.时间 = at; return openUserDb({ file: ':memory:', now: () => new Date(钟.时间) }); };
const 第二天 = () => { 钟.时间 = '2026-11-02T00:00:00.000Z'; return { now: new Date(钟.时间) }; };
const 一个用户 = db => 用户.新建或登录(db, { openid: 'o-1', appid: 'wx-app' }, 选项);

const 提醒内容 = (id, 改 = {}) => ({
  id, edition_id: 'ed-math-2026', competition_name: '全国大学生数学建模竞赛', task_name: '数学建模·报名截止提醒',
  event_type: 'registration_end', event_label: '报名截止', target_at: '2026-11-10T15:59:59.999Z',
  advance_key: '3d', advance_label: '提前 3 天', offset_ms: 259200000, remind_at: '2026-11-07T15:59:59.999Z', ...改,
});

describe('建库', () => {
  test('001-建表.sql 和按描述生成的一致；只有用户管理中心的六张表', () => {
    expect(fs.readFileSync(FIRST_FILE, 'utf8')).toBe(buildUserSql());
    const db = open();
    for (const 表 of ['user_account', 'favorite', 'reminder', 'general_feedback', 'feedback', 'user_preference']) expect(db.count(表)).toBe(0);
    expect(() => db.count('public_edition')).toThrow('没有这张表');
  });
});

describe('用户（一级）', () => {
  test('新建或登录：没有就建、有就记登录时间，同一个 openid 只有一个账号', () => {
    const db = open();
    const 新 = 一个用户(db);
    expect(新).toMatchObject({ openid: 'o-1', appid: 'wx-app', status: 'active', created_at: at, last_login_at: at });
    expect(新.id).toMatch(/^user-/);
    const 再 = 用户.新建或登录(db, { openid: 'o-1' }, { now: new Date('2026-11-02T00:00:00.000Z') });
    expect(再).toMatchObject({ id: 新.id, appid: 'wx-app', last_login_at: '2026-11-02T00:00:00.000Z' });
    expect(db.count('user_account')).toBe(1);
  });
  test('读取、按 openid 找、停用；停用的账号登录报错', () => {
    const db = open();
    const 新 = 一个用户(db);
    expect(用户.读取(db, 新.id).openid).toBe('o-1');
    expect(用户.按openid(db, 'o-1').id).toBe(新.id);
    expect(用户.读取(db, 'user-none')).toBeNull();
    用户.停用(db, 新.id, 选项);
    expect(用户.读取(db, 新.id).status).toBe('disabled');
    expect(() => 用户.新建或登录(db, { openid: 'o-1' }, 选项)).toThrow('账号已停用');
  });
  test('一个用户的全部：账号和五张表的记录；注销（删除）时五张表一起删', () => {
    const db = open();
    const 甲 = 一个用户(db);
    const 乙 = 用户.新建或登录(db, { openid: 'o-2' }, 选项);
    收藏.加(db, 甲.id, 'event-math', 选项);
    提醒.保存(db, 甲.id, 提醒内容('r-1'), 选项);
    意见反馈.提交(db, 甲.id, { type: 'bug', content: '列表加载慢' }, 选项);
    纠错.提交(db, 甲.id, { edition_id: 'ed-math-2026', competition_name: '数学建模', category: 'time', content: '截止日不对' }, 选项);
    偏好.保存(db, 甲.id, { profession: '计算机与AI', categories: ['计算机与AI'], province: '浙江省' }, 选项);
    收藏.加(db, 乙.id, 'event-art', 选项);
    const 全部 = 用户.全部(db, 甲.id);
    expect(全部.账号.id).toBe(甲.id);
    expect([全部.收藏.length, 全部.提醒.length, 全部.意见反馈.length, 全部.纠错.length]).toEqual([1, 1, 1, 1]);
    expect(全部.偏好.profession).toBe('计算机与AI');
    expect(用户.删除(db, 甲.id)).toEqual({ 连带: { favorite: 1, reminder: 1, general_feedback: 1, feedback: 1, user_preference: 1 } });
    expect(用户.读取(db, 甲.id)).toBeNull();
    expect(收藏.编号们(db, 乙.id)).toEqual(['event-art']);
  });
});

describe('收藏：只存比赛编号', () => {
  test('加、重复加不重复存、取消；编号们按新收藏的在前', () => {
    const db = open();
    const 甲 = 一个用户(db);
    expect(收藏.加(db, 甲.id, 'event-math', 选项)).toEqual({ 收藏了: true });
    收藏.加(db, 甲.id, 'event-art', { now: new Date('2026-11-02T00:00:00.000Z') });
    expect(收藏.加(db, 甲.id, 'event-math', 选项)).toEqual({ 收藏了: true });
    expect(收藏.编号们(db, 甲.id)).toEqual(['event-art', 'event-math']);
    expect(收藏.取消(db, 甲.id, 'event-math')).toEqual({ 收藏了: false });
    expect(收藏.取消(db, 甲.id, 'event-math')).toEqual({ 收藏了: false });
    expect(收藏.编号们(db, 甲.id)).toEqual(['event-art']);
  });
  test('账号不存在：数据库拒绝', () => {
    expect(() => 收藏.加(open(), 'user-none', 'event-math', 选项)).toThrow(expect.objectContaining({ kind: '指向的记录不存在' }));
  });
});

describe('提醒：挂届次', () => {
  test('保存：没有就加（默认待发送、未请求授权、时间正常），有就改；只能改自己的', () => {
    const db = open();
    const 甲 = 一个用户(db);
    const 乙 = 用户.新建或登录(db, { openid: 'o-2' }, 选项);
    提醒.保存(db, 甲.id, 提醒内容('r-1'), 选项);
    expect(提醒.列出(db, 甲.id)[0]).toMatchObject({ id: 'r-1', user_id: 甲.id, delivery_status: 'pending', authorization_status: 'not_requested', schedule_change_status: 'normal', retry_count: 0, created_at: at });
    提醒.保存(db, 甲.id, 提醒内容('r-1', { advance_key: '7d', authorization_status: 'accepted' }), 第二天());
    expect(提醒.列出(db, 甲.id)[0]).toMatchObject({ advance_key: '7d', authorization_status: 'accepted', created_at: at, updated_at: '2026-11-02T00:00:00.000Z' });
    expect(() => 提醒.保存(db, 乙.id, 提醒内容('r-1'), 选项)).toThrow('不是这个用户的提醒');
  });
  test('删一条、删一届的全部；届次编号们（排序第 ④ 条用）不重复', () => {
    const db = open();
    const 甲 = 一个用户(db);
    提醒.保存(db, 甲.id, 提醒内容('r-1'), 选项);
    提醒.保存(db, 甲.id, 提醒内容('r-2', { event_type: 'registration_start', event_label: '报名开始' }), 选项);
    提醒.保存(db, 甲.id, 提醒内容('r-3', { edition_id: 'ed-art-2026' }), 选项);
    expect(提醒.届次编号们(db, 甲.id).sort()).toEqual(['ed-art-2026', 'ed-math-2026']);
    expect(提醒.删除(db, 甲.id, 'r-3')).toEqual({ 删了: 1 });
    expect(提醒.删除(db, 甲.id, 'r-3')).toEqual({ 删了: 0 });
    expect(提醒.删届次的(db, 甲.id, 'ed-math-2026')).toEqual({ 删了: 2 });
    expect(提醒.列出(db, 甲.id)).toEqual([]);
  });
  test('到期：到时间、还待发送的，按时间先后', () => {
    const db = open();
    const 甲 = 一个用户(db);
    提醒.保存(db, 甲.id, 提醒内容('r-早', { remind_at: '2026-11-01T01:00:00.000Z' }), 选项);
    提醒.保存(db, 甲.id, 提醒内容('r-更早', { remind_at: '2026-10-31T01:00:00+08:00' }), 选项);
    提醒.保存(db, 甲.id, 提醒内容('r-发过', { remind_at: '2026-11-01T01:00:00.000Z', delivery_status: 'sent' }), 选项);
    提醒.保存(db, 甲.id, 提醒内容('r-晚', { remind_at: '2026-11-05T01:00:00.000Z' }), 选项);
    expect(提醒.到期(db, new Date(at)).map(r => r.id)).toEqual(['r-更早', 'r-早']);
  });
  test('提醒什么、发送状态这些只能填规定的值', () => {
    const db = open();
    const 甲 = 一个用户(db);
    expect(() => 提醒.保存(db, 甲.id, 提醒内容('r-x', { event_type: 'competition_end' }), 选项)).toThrow(expect.objectContaining({ kind: '校验不通过' }));
  });
});

describe('意见反馈和纠错', () => {
  test('意见反馈：提交后待处理，列出自己的（新的在前）', () => {
    const db = open();
    const 甲 = 一个用户(db);
    const 回 = 意见反馈.提交(db, 甲.id, { type: 'suggestion', content: '想要按地区筛', contact: '微信 abc', app_version: '1.1.2' }, 选项);
    expect(回).toMatchObject({ user_id: 甲.id, type: 'suggestion', status: 'pending', created_at: at });
    expect(回.id).toMatch(/^general-feedback-/);
    意见反馈.提交(db, 甲.id, { type: 'bug', content: '第二条' }, { now: new Date('2026-11-02T00:00:00.000Z') });
    expect(意见反馈.列出(db, 甲.id).map(r => r.content)).toEqual(['第二条', '想要按地区筛']);
    expect(() => 意见反馈.提交(db, 甲.id, { type: '吐槽', content: 'x' }, 选项)).toThrow(expect.objectContaining({ kind: '校验不通过' }));
  });
  test('纠错：针对某一届，提交后待 AI 审核，列出自己的', () => {
    const db = open();
    const 甲 = 一个用户(db);
    const 回 = 纠错.提交(db, 甲.id, { edition_id: 'ed-math-2026', competition_name: '数学建模', category: 'registration_link', content: '报名链接打不开', evidence_url: 'https://a.cn/x' }, 选项);
    expect(回).toMatchObject({ status: 'pending_ai_review', edition_id: 'ed-math-2026', created_at: at });
    expect(回.id).toMatch(/^feedback-/);
    expect(纠错.列出(db, 甲.id).map(r => r.id)).toEqual([回.id]);
    expect(() => 纠错.提交(db, 甲.id, { edition_id: 'e', competition_name: 'x', category: 'price', content: 'x' }, 选项)).toThrow(expect.objectContaining({ kind: '校验不通过' }));
  });
});

describe('偏好：每个用户一条', () => {
  test('保存：没有就建、有就改（建立时间不变）；读取没有给 null', () => {
    const db = open();
    const 甲 = 一个用户(db);
    expect(偏好.读取(db, 甲.id)).toBeNull();
    偏好.保存(db, 甲.id, { profession: '计算机与AI', categories: ['计算机与AI', '数学与统计'], province: '浙江省' }, 选项);
    偏好.保存(db, 甲.id, { profession: '电子信息', categories: [], province: '', survey_status: 'skipped', dont_show_again: true }, 第二天());
    expect(偏好.读取(db, 甲.id)).toMatchObject({ user_id: 甲.id, profession: '电子信息', categories: [], survey_status: 'skipped', dont_show_again: true, created_at: at, updated_at: '2026-11-02T00:00:00.000Z' });
    expect(db.count('user_preference')).toBe(1);
  });
});

// 2026-11-02：后台（美国）审核纠错、处理意见反馈后，结果经 沟通/审核结果回传 写回这里的正本，小程序“我的纠错”“我的反馈”据此显示。
// 带上后台读到的最后修改时间：和现在的不一样说明别人刚改过，不覆盖（照旧上海 adminData generalFeedback.update 的 feedback_conflict）。
describe('后台处理结果写回', () => {
  test('纠错.处理：改处理状态，处理完（采纳、驳回）记处理时间；读到的修改时间对不上不改', () => {
    const db = open();
    const 我 = 一个用户(db);
    const 条 = 纠错.提交(db, 我.id, { edition_id: 'ed-1', competition_name: '数学建模', category: 'time', content: '截止日期错了' }, 选项);
    expect(() => 纠错.处理(db, 条.id, { status: 'accepted', 读到的更新时间: '2026-10-01T00:00:00.000Z' }, 第二天())).toThrow('feedback_conflict');
    const 后 = 纠错.处理(db, 条.id, { status: 'accepted', 读到的更新时间: 条.updated_at }, 第二天());
    expect(后).toMatchObject({ status: 'accepted', resolved_at: '2026-11-02T00:00:00.000Z', updated_at: '2026-11-02T00:00:00.000Z' });
    expect(() => 纠错.处理(db, 条.id, { status: 'drop', 读到的更新时间: 后.updated_at }, 选项)).toThrow('invalid_feedback_status');
    expect(() => 纠错.处理(db, 'feedback-没有', { status: 'rejected', 读到的更新时间: at }, 选项)).toThrow('feedback_not_found');
  });
  test('意见反馈.处理：状态、公开回复、内部备注；已解决必须写公开回复；改回未解决清掉处理时间', () => {
    const db = open();
    const 我 = 一个用户(db);
    const 条 = 意见反馈.提交(db, 我.id, { type: 'bug', content: '首页打不开' }, 选项);
    expect(() => 意见反馈.处理(db, 条.id, { status: 'resolved', public_reply: ' ', 读到的更新时间: 条.updated_at }, 选项)).toThrow('resolved_feedback_requires_reply');
    const 后 = 意见反馈.处理(db, 条.id, { status: 'resolved', public_reply: '已修好', internal_note: '缓存问题', 读到的更新时间: 条.updated_at }, 第二天());
    expect(后).toMatchObject({ status: 'resolved', public_reply: '已修好', internal_note: '缓存问题', resolved_at: '2026-11-02T00:00:00.000Z' });
    const 再 = 意见反馈.处理(db, 条.id, { status: 'processing', public_reply: '再看看', 读到的更新时间: 后.updated_at }, 选项);
    expect(再).toMatchObject({ status: 'processing', resolved_at: null });
    expect(() => 意见反馈.处理(db, 条.id, { status: 'resolved', public_reply: '好', 读到的更新时间: 条.updated_at }, 选项)).toThrow('feedback_conflict');
  });
});

// 昵称头像（2026-11-09，组队里给队友看）：001 已部署不能改，字段在 004-用户昵称头像.sql 里用 ALTER TABLE 加；头像只存网址（只收 https，服务里查）
describe('用户的昵称和头像（004）', () => {
  test('001 不带这两个字段；004 只给 user_account 加 nickname、avatar_url 两列，和按描述生成的一致', () => {
    expect(buildUserSql()).not.toContain('nickname');
    const sql = buildFileSql('004-用户昵称头像.sql');
    expect(fs.readFileSync(path.join(STRUCTURE_DIR, '004-用户昵称头像.sql'), 'utf8')).toBe(sql);
    expect(sql).not.toContain('CREATE TABLE');
    expect(sql.match(/ALTER TABLE .+;/g)).toEqual(['ALTER TABLE user_account ADD COLUMN nickname TEXT;', 'ALTER TABLE user_account ADD COLUMN avatar_url TEXT;']);
    expect(文件们()).toContain('004-用户昵称头像.sql');
  });
  test('改资料：存昵称和头像网址，空的存 null；超长的数据库拒绝；新账号两项都是 null', () => {
    const db = open();
    const 我 = 一个用户(db);
    expect(我).toMatchObject({ nickname: null, avatar_url: null });
    expect(用户.改资料(db, 我.id, { nickname: '小黄', avatar_url: 'https://thirdwx.qlogo.cn/a.png' }, 第二天()))
      .toMatchObject({ nickname: '小黄', avatar_url: 'https://thirdwx.qlogo.cn/a.png', updated_at: '2026-11-02T00:00:00.000Z' });
    expect(用户.改资料(db, 我.id, { nickname: null, avatar_url: null }, 选项)).toMatchObject({ nickname: null, avatar_url: null });
    expect(() => 用户.改资料(db, 我.id, { nickname: '名'.repeat(31), avatar_url: null }, 选项)).toThrow(expect.objectContaining({ kind: '校验不通过' }));
    expect(() => 用户.改资料(db, 我.id, { nickname: null, avatar_url: `https://a.cn/${'x'.repeat(500)}` }, 选项)).toThrow(expect.objectContaining({ kind: '校验不通过' }));
  });
  test('资料们：按编号一次取出昵称头像（队员列表用），没有的编号不出现', () => {
    const db = open();
    const 甲 = 一个用户(db);
    const 乙 = 用户.新建或登录(db, { openid: 'o-2' }, 选项);
    用户.改资料(db, 甲.id, { nickname: '甲', avatar_url: null }, 选项);
    const 资料 = 用户.资料们(db, [甲.id, 乙.id, 'user-none']);
    expect(资料.get(甲.id)).toEqual({ nickname: '甲', avatarUrl: null });
    expect(资料.get(乙.id)).toEqual({ nickname: null, avatarUrl: null });
    expect(资料.has('user-none')).toBe(false);
  });
});
