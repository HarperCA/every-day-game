// 用户数据同步（北京 → 美国，2026-11-02，用户定用户数据传回美国，供后台访问异常、问卷统计、意见反馈、纠错审核用）。
// 做法和公开比赛同步一样：北京按内容哈希比出变化只推变了的，删掉的也推；每 24 小时整体重推一次，收尾时美国清掉这一轮没收到的；
// 报错日志只增不改，按编号接着推。签名、时效和公开比赛同步共用一套（公开比赛同步/格式.mjs）。
// 不传 openid、appid、unionid（用户 11-02 同意：后台审查用不到，发提醒只在北京发，少一份身份信息出境）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openUserDb, 用户, 收藏, 纠错, 偏好 } from '../../../../北京/副数据库/index.mjs';
import { 打开报错库 } from '../../../../北京/服务/收集报错/报错库.mjs';
import { 用户副本 } from '../../../../美国/db/index.mjs';
import { 签名, 时间头, 签名头 } from '../../../公开比赛同步/格式.mjs';
import { 同步的表, 整理行 } from '../../格式.mjs';
import { 推送 } from '../../北京端.mjs';
import { 接收 } from '../../美国端.mjs';

const 秘钥 = 'k'.repeat(40);
const T0 = new Date('2026-11-02T02:00:00Z');
let 目录;
beforeEach(() => { 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '用户同步-')); });
afterEach(() => fs.rmSync(目录, { recursive: true, force: true }));

function 准备() {
  const 用户库 = openUserDb({ file: ':memory:', now: () => T0 });
  const 报错库 = 打开报错库(':memory:');
  const 副本 = 用户副本.open({ file: ':memory:', now: () => T0 });
  const 账号 = 用户.新建或登录(用户库, { openid: 'openid-秘密', appid: 'wx-app' }, { now: T0 });
  收藏.加(用户库, 账号.id, 'event-math', { now: T0 });
  偏好.保存(用户库, 账号.id, { profession: '理学', categories: ['数学'], province: '福建', survey_status: 'completed', dont_show_again: false }, { now: T0 });
  报错库.收下([{ kind: 'error', received_at: T0.toISOString(), at: T0.toISOString(), page: 'pages/home/home', message: '超时' }]);
  报错库.加一('2026-11-02', 'list');
  let 请求数 = 0;
  const fetch = async (地址, init) => {
    请求数 += 1;
    const 头 = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
    // 美国按推送时刻收（推送用的是测试里的固定时间；过期另有用例）
    const { 状态, 内容 } = await 接收({ 方法: 'POST', 头, 正文: init.body }, { 副本库: 副本, 秘钥, now: new Date(Number(头[时间头])) });
    return { ok: 状态 < 300, status: 状态, json: async () => 内容 };
  };
  const 推 = (选项 = {}) => 推送({ 用户库, 报错库, 地址: 'https://us.example/sync/user', 秘钥, 状态文件: path.join(目录, '状态.json'), fetch, now: T0, ...选项 });
  return { 用户库, 报错库, 副本, 账号, 推, 请求数: () => 请求数, 清零: () => { 请求数 = 0; } };
}

describe('格式', () => {
  test('同步哪些表；账号去掉 openid、appid、unionid', () => {
    expect(同步的表.map(t => t.表)).toEqual(['user_account', 'favorite', 'reminder', 'general_feedback', 'feedback', 'user_preference', 'client_stats', 'client_issues', 'school_admin', 'school_contest']);
    expect(同步的表.map(t => t.表)).toEqual(用户副本.同步来的表);   // 两边一致，美国才收
    expect(整理行('user_account', { id: 'u1', openid: 'o', appid: 'a', unionid: 'x', status: 'active' })).toEqual({ id: 'u1', status: 'active' });
    // 2026-11-09：昵称头像只给北京的组队用，不传美国（后台用不到，少一份个人信息出境；账号行和以前一样，美国不用跟着改）
    expect(整理行('user_account', { id: 'u1', status: 'active', nickname: '小黄', avatar_url: 'https://a.cn/1.png' })).toEqual({ id: 'u1', status: 'active' });
    expect(整理行('favorite', { id: 'f1', user_id: 'u1' })).toEqual({ id: 'f1', user_id: 'u1' });
  });
});

describe('北京推、美国收', () => {
  test('第一次全部推过去；美国收到的账号里没有 openid', async () => {
    const t = 准备();
    const 结果 = await t.推();
    expect(结果).toMatchObject({ 写: 4, 删: 0, 报错: 1, 全量: true });
    expect(用户副本.条数(t.副本)).toEqual({ user_account: 1, favorite: 1, user_preference: 1, client_stats: 1, client_issues: 1 });
    const 账号 = 用户副本.一条(t.副本, 'user_account', t.账号.id);
    expect(账号).toMatchObject({ id: t.账号.id, status: 'active' });
    expect(JSON.stringify(用户副本.列出(t.副本, 'user_account'))).not.toContain('openid');
    expect(用户副本.列出(t.副本, 'client_issues')[0]).toMatchObject({ page: 'pages/home/home', message: '超时' });
  });
  test('没变化一个请求都不发；改了、删了的推过去；新报错接着推', async () => {
    const t = 准备();
    await t.推();
    t.清零();
    expect(await t.推()).toMatchObject({ 写: 0, 删: 0, 报错: 0 });
    expect(t.请求数()).toBe(0);
    收藏.取消(t.用户库, t.账号.id, 'event-math');
    纠错.提交(t.用户库, t.账号.id, { edition_id: 'e1', competition_name: '数学建模', category: 'time', content: '截止日期写错了' }, { now: T0 });
    t.报错库.收下([{ kind: 'error', at: T0.toISOString(), message: '第二条' }]);
    expect(await t.推()).toMatchObject({ 写: 1, 删: 1, 报错: 1 });
    expect(用户副本.列出(t.副本, 'favorite')).toEqual([]);
    expect(用户副本.列出(t.副本, 'feedback')[0]).toMatchObject({ content: '截止日期写错了', status: 'pending_ai_review' });
    expect(用户副本.列出(t.副本, 'client_issues').map(x => x.message)).toEqual(['超时', '第二条']);
  });
  test('每 24 小时整体重推，收尾时美国清掉北京已经没有的（比如美国从备份恢复后多出来的）', async () => {
    const t = 准备();
    await t.推();
    用户副本.写(t.副本, [{ 表: 'favorite', 编号: 'f-多出来的', data: {} }], { now: T0 });
    expect(await t.推({ now: new Date(T0.getTime() + 3600e3) })).toMatchObject({ 全量: false });
    expect(用户副本.条数(t.副本).favorite).toBe(2);
    const 一天后 = await t.推({ now: new Date(T0.getTime() + 25 * 3600e3) });
    expect(一天后).toMatchObject({ 全量: true, 写: 4 });
    expect(用户副本.条数(t.副本).favorite).toBe(1);
  });
  test('美国没收下（签名不对、出错）：北京不推进进度，下次再推', async () => {
    const t = 准备();
    await expect(t.推({ 秘钥: 'x'.repeat(40) })).rejects.toThrow('401');
    expect(用户副本.条数(t.副本)).toEqual({});
    expect(await t.推()).toMatchObject({ 写: 4, 报错: 1 });
  });
  test('试跑：只算要推什么，不发请求、不记进度', async () => {
    const t = 准备();
    expect(await t.推({ 试跑: true })).toMatchObject({ 写: 4, 报错: 1, 试跑: true });
    expect(t.请求数()).toBe(0);
    expect(await t.推()).toMatchObject({ 写: 4 });
  });
});

// 校赛（2026-11-08 用户定：校赛在美国审核通过才能在小程序发布）：管理员申请、校赛两张表传美国给后台审核；学生名单、邀请不传。
describe('校赛两张表', () => {
  const 申请 = { id: 'sa-1', user: 'user-1', school: '福州大学', real_name: '张老师', contact: '13800000000', proof: '团委老师', status: '待审核', review_note: null, created_at: T0.toISOString(), updated_at: T0.toISOString(), version: 1, openid: '不该出境' };
  const 校赛行 = { id: 'sc-1', school: '福州大学', admin: 'sa-1', title: '校数学竞赛', content: '简介', signup: '扫码报名', start_date: '2026-12-01', end_date: '2026-12-02', status: '待审核', review_note: null, created_at: T0.toISOString(), updated_at: T0.toISOString(), version: 1 };
  // 北京副数据库的校赛表另一个智能体在写：这里在真的用户库外面包一层，假装已经有这两张表（学生名单也放一张，看它传不传）
  const 包一层 = (用户库, 假表) => new Proxy(用户库, { get: (目标, 名) => 名 === 'find' ? (表, 条件) => (表 in 假表 ? 假表[表] : 目标.find(表, 条件)) : 目标[名] });

  test('管理员申请、校赛推到美国；不带 openid；学生名单不传', async () => {
    const t = 准备();
    const 用户库 = 包一层(t.用户库, { school_admin: [申请], school_contest: [校赛行], school_member: [{ id: 'm-1', name: '学生' }] });
    expect(await t.推({ 用户库 })).toMatchObject({ 写: 6 });
    expect(用户副本.一条(t.副本, 'school_admin', 'sa-1')).toMatchObject({ school: '福州大学', real_name: '张老师', status: '待审核' });
    expect(用户副本.一条(t.副本, 'school_admin', 'sa-1')).not.toHaveProperty('openid');
    expect(用户副本.一条(t.副本, 'school_contest', 'sc-1')).toMatchObject({ title: '校数学竞赛', status: '待审核' });
    expect(用户副本.条数(t.副本).school_member).toBeUndefined();
  });
  test('北京还没建校赛表（先部署美国、后部署北京）：当成没有，照常同步别的表', async () => {
    const t = 准备();
    expect(await t.推()).toMatchObject({ 写: 4 });
    expect(用户副本.条数(t.副本).school_admin).toBeUndefined();
  });
  test('美国不收学生名单、邀请', async () => {
    const t = 准备();
    for (const 表 of ['school_member', 'school_invite']) {
      const 正文 = JSON.stringify({ 写们: [{ 表, 编号: 'x', data: {} }] });
      const 时间 = String(T0.getTime());
      expect((await 接收({ 方法: 'POST', 头: { [时间头]: 时间, [签名头]: 签名(秘钥, 时间, 正文) }, 正文 }, { 副本库: t.副本, 秘钥, now: T0 })).状态).toBe(422);
    }
  });
});

describe('美国端拒收', () => {
  const 副本 = () => 用户副本.open({ file: ':memory:' });
  const 发 = (正文, { 时间 = Date.now(), 用的秘钥 = 秘钥, 方法 = 'POST' } = {}) => 接收({ 方法, 头: { [时间头]: String(时间), [签名头]: 签名(用的秘钥, String(时间), 正文) }, 正文 }, { 副本库: 副本(), 秘钥, now: new Date() });
  test('不是 POST 405；没签名、签名不对 401；过期 401；不是 JSON 400；不认识的表 422', async () => {
    expect((await 发('{}', { 方法: 'GET' })).状态).toBe(405);
    expect((await 接收({ 方法: 'POST', 头: {}, 正文: '{}' }, { 副本库: 副本(), 秘钥 })).状态).toBe(401);
    expect((await 发('{}', { 用的秘钥: 'y'.repeat(40) })).状态).toBe(401);
    expect(await 发('{}', { 时间: Date.now() - 10 * 60e3 })).toMatchObject({ 状态: 401, 内容: { message: 'sync_expired' } });
    expect((await 发('不是 JSON')).状态).toBe(400);
    expect((await 发(JSON.stringify({ 写们: [{ 表: 'secret', 编号: 'x', data: {} }] }))).状态).toBe(422);
  });
});
