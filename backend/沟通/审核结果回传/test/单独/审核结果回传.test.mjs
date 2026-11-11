// 审核结果回传（美国 → 北京，2026-11-02）：美国后台审核纠错、处理意见反馈后，把结果写回北京的正本（小程序“我的纠错”“我的反馈”看得到），
// 北京交回改好的那一行，美国顺手写进自己的用户副本，不用等下一轮用户数据同步（不然再处理一次会因为副本还是旧的被当成冲突）。
import { describe, expect, test } from 'vitest';
import { openUserDb, 用户, 纠错, 意见反馈 } from '../../../../北京/副数据库/index.mjs';
import { 用户副本 } from '../../../../美国/db/index.mjs';
import { 签名, 时间头, 签名头 } from '../../../公开比赛同步/格式.mjs';
import { 接收 } from '../../北京端.mjs';
import { 回传 } from '../../美国端.mjs';

const 秘钥 = 'k'.repeat(40);
const T0 = new Date('2026-11-02T02:00:00Z');

function 准备() {
  const 用户库 = openUserDb({ file: ':memory:', now: () => T0 });
  const 副本库 = 用户副本.open({ file: ':memory:', now: () => T0 });
  const 我 = 用户.新建或登录(用户库, { openid: 'o-1' }, { now: T0 });
  const 纠 = 纠错.提交(用户库, 我.id, { edition_id: 'ed-1', competition_name: '数学建模', category: 'time', content: '截止日期错了' }, { now: T0 });
  const 意 = 意见反馈.提交(用户库, 我.id, { type: 'bug', content: '首页打不开' }, { now: T0 });
  const fetch = async (地址, init) => {
    const 头 = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
    const { 状态, 内容 } = await 接收({ 方法: 'POST', 头, 正文: init.body }, { 用户库, 秘钥, now: new Date(Number(头[时间头])) });
    return { ok: 状态 < 300, status: 状态, json: async () => 内容 };
  };
  const 传 = 参数 => 回传({ 地址: 'https://bj.example/sync/review', 秘钥, 副本库, fetch, now: T0, ...参数 });
  return { 用户库, 副本库, 纠, 意, 传 };
}

describe('美国回传、北京改正本', () => {
  test('纠错采纳：北京正本改成 accepted，美国副本马上跟上', async () => {
    const t = 准备();
    const 行 = await t.传({ 种类: '纠错', 编号: t.纠.id, 改动: { status: 'accepted' }, 读到的更新时间: t.纠.updated_at });
    expect(行).toMatchObject({ id: t.纠.id, status: 'accepted' });
    expect(t.用户库.get('feedback', t.纠.id).data.status).toBe('accepted');
    expect(用户副本.一条(t.副本库, 'feedback', t.纠.id)).toMatchObject({ status: 'accepted' });
  });
  test('意见反馈：状态、公开回复、内部备注写回；已解决没写回复、读到的是旧的，都报北京的原因，美国副本不动', async () => {
    const t = 准备();
    await expect(t.传({ 种类: '意见反馈', 编号: t.意.id, 改动: { status: 'resolved' }, 读到的更新时间: t.意.updated_at })).rejects.toThrow('resolved_feedback_requires_reply');
    await expect(t.传({ 种类: '意见反馈', 编号: t.意.id, 改动: { status: 'processing' }, 读到的更新时间: '2026-01-01T00:00:00.000Z' })).rejects.toThrow('feedback_conflict');
    expect(用户副本.条数(t.副本库)).toEqual({});
    const 行 = await t.传({ 种类: '意见反馈', 编号: t.意.id, 改动: { status: 'resolved', public_reply: '已修好', internal_note: '缓存' }, 读到的更新时间: t.意.updated_at });
    expect(行).toMatchObject({ status: 'resolved', public_reply: '已修好', internal_note: '缓存' });
    expect(用户副本.一条(t.副本库, 'general_feedback', t.意.id)).toMatchObject({ public_reply: '已修好' });
  });
  test('没配北京地址或秘钥：明确报错，不悄悄当成功', async () => {
    const t = 准备();
    await expect(t.传({ 地址: '', 种类: '纠错', 编号: t.纠.id, 改动: { status: 'accepted' }, 读到的更新时间: t.纠.updated_at })).rejects.toThrow('没配');
  });
});

describe('北京端拒收', () => {
  const 发 = (正文, { 时间 = Date.now(), 用的秘钥 = 秘钥, 方法 = 'POST' } = {}) => 接收({ 方法, 头: { [时间头]: String(时间), [签名头]: 签名(用的秘钥, String(时间), 正文) }, 正文 },
    { 用户库: openUserDb({ file: ':memory:' }), 秘钥, now: new Date() });
  test('不是 POST 405；签名不对、过期 401；不是 JSON 400；不认识的种类、改不能改的字段 422；找不到 404', async () => {
    expect((await 发('{}', { 方法: 'GET' })).状态).toBe(405);
    expect((await 发('{}', { 用的秘钥: 'y'.repeat(40) })).状态).toBe(401);
    expect((await 发('{}', { 时间: Date.now() - 10 * 60e3 })).状态).toBe(401);
    expect((await 发('不是 JSON')).状态).toBe(400);
    expect((await 发(JSON.stringify({ 种类: '收藏', 编号: 'x', 改动: {} }))).状态).toBe(422);
    expect((await 发(JSON.stringify({ 种类: '纠错', 编号: 'x', 改动: { status: 'accepted', user_id: '别人' } }))).状态).toBe(422);
    expect((await 发(JSON.stringify({ 种类: '纠错', 编号: 'feedback-没有', 改动: { status: 'accepted' }, 读到的更新时间: 'x' }))).状态).toBe(404);
  });
});

// 校赛（2026-11-08 用户定：校赛在美国审核通过才能在小程序发布）：后台审核管理员申请、校赛，结果写回北京正本。
// 北京副数据库的 校赛.处理管理员申请、校赛.处理校赛 另一个智能体在写，这里注入假的（照约好的参数：(db, 编号, { status, review_note }, { 读到的更新时间, now })）。
function 假校赛操作() {
  const 行们 = {
    school_admin: new Map([['sa-1', { id: 'sa-1', user: 'user-1', school: '福州大学', real_name: '张老师', status: '待审核', review_note: null, updated_at: 'T-1', version: 1 }]]),
    school_contest: new Map([['sc-1', { id: 'sc-1', school: '福州大学', title: '校数学竞赛', status: '待审核', review_note: null, updated_at: 'T-1', version: 1 }]]),
  };
  const 调用 = [];
  const 处理 = 表 => (db, 编号, 改动, 选项) => {
    调用.push({ 表, 编号, 改动, 读到的更新时间: 选项.读到的更新时间 });
    const 原 = 行们[表].get(编号);
    if (!原) throw new Error(`${表}_not_found`);
    if (原.updated_at !== 选项.读到的更新时间) throw new Error('feedback_conflict');
    const 新 = { ...原, ...改动, updated_at: 选项.now.toISOString(), version: 原.version + 1 };
    行们[表].set(编号, 新);
    return 新;
  };
  return { 操作: { 处理管理员申请: 处理('school_admin'), 处理校赛: 处理('school_contest') }, 调用 };
}

describe('校赛：美国审核、北京改正本', () => {
  function 准备校赛() {
    const 假 = 假校赛操作();
    const 用户库 = openUserDb({ file: ':memory:', now: () => T0 });
    const 副本库 = 用户副本.open({ file: ':memory:', now: () => T0 });
    const fetch = async (地址, init) => {
      const 头 = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
      const { 状态, 内容 } = await 接收({ 方法: 'POST', 头, 正文: init.body }, { 用户库, 秘钥, now: new Date(Number(头[时间头])), 校赛操作: 假.操作 });
      return { ok: 状态 < 300, status: 状态, json: async () => 内容 };
    };
    const 传 = 参数 => 回传({ 地址: 'https://bj.example/sync/review', 秘钥, 副本库, fetch, now: T0, ...参数 });
    return { 假, 副本库, 传 };
  }
  test('管理员申请通过：调 处理管理员申请，美国副本马上跟上', async () => {
    const t = 准备校赛();
    const 行 = await t.传({ 种类: '校赛管理员', 编号: 'sa-1', 改动: { status: '已通过', review_note: '' }, 读到的更新时间: 'T-1' });
    expect(行).toMatchObject({ id: 'sa-1', status: '已通过' });
    expect(t.假.调用).toEqual([{ 表: 'school_admin', 编号: 'sa-1', 改动: { status: '已通过', review_note: '' }, 读到的更新时间: 'T-1' }]);
    expect(用户副本.一条(t.副本库, 'school_admin', 'sa-1')).toMatchObject({ status: '已通过' });
  });
  test('校赛发布、下架：调 处理校赛，美国副本跟上；读到的是旧的报冲突', async () => {
    const t = 准备校赛();
    expect(await t.传({ 种类: '校赛', 编号: 'sc-1', 改动: { status: '已发布' }, 读到的更新时间: 'T-1' })).toMatchObject({ status: '已发布' });
    expect(用户副本.一条(t.副本库, 'school_contest', 'sc-1')).toMatchObject({ status: '已发布' });
    await expect(t.传({ 种类: '校赛', 编号: 'sc-1', 改动: { status: '已下架', review_note: '信息有误' }, 读到的更新时间: 'T-1' })).rejects.toThrow('feedback_conflict');
    const 下架 = await t.传({ 种类: '校赛', 编号: 'sc-1', 改动: { status: '已下架', review_note: '信息有误' }, 读到的更新时间: T0.toISOString() });
    expect(下架).toMatchObject({ status: '已下架', review_note: '信息有误' });
  });
  test('状态只能是约好的那几个；拒绝、下架要写说明；不能改别的字段——都不调北京的操作', async () => {
    const t = 准备校赛();
    await expect(t.传({ 种类: '校赛管理员', 编号: 'sa-1', 改动: { status: '已发布' }, 读到的更新时间: 'T-1' })).rejects.toThrow('invalid_school_status');
    await expect(t.传({ 种类: '校赛管理员', 编号: 'sa-1', 改动: { status: '待审核' }, 读到的更新时间: 'T-1' })).rejects.toThrow('invalid_school_status');
    await expect(t.传({ 种类: '校赛', 编号: 'sc-1', 改动: { status: '已通过' }, 读到的更新时间: 'T-1' })).rejects.toThrow('invalid_school_status');
    await expect(t.传({ 种类: '校赛管理员', 编号: 'sa-1', 改动: { status: '已拒绝', review_note: '  ' }, 读到的更新时间: 'T-1' })).rejects.toThrow('review_note_required');
    await expect(t.传({ 种类: '校赛', 编号: 'sc-1', 改动: { status: '已下架' }, 读到的更新时间: 'T-1' })).rejects.toThrow('review_note_required');
    await expect(t.传({ 种类: '校赛', 编号: 'sc-1', 改动: { status: '已发布', title: '改标题' }, 读到的更新时间: 'T-1' })).rejects.toThrow('field_not_editable');
    expect(t.假.调用).toEqual([]);
    expect(用户副本.条数(t.副本库)).toEqual({});
  });
  test('找不到 404、冲突 409；北京还没有校赛操作时明确拒收', async () => {
    const 假 = 假校赛操作();
    const 发 = (请求, 校赛操作 = 假.操作) => {
      const 正文 = JSON.stringify(请求); const 时间 = String(Date.now());
      return 接收({ 方法: 'POST', 头: { [时间头]: 时间, [签名头]: 签名(秘钥, 时间, 正文) }, 正文 }, { 用户库: openUserDb({ file: ':memory:' }), 秘钥, now: new Date(), 校赛操作 });
    };
    expect((await 发({ 种类: '校赛', 编号: 'sc-没有', 改动: { status: '已发布' }, 读到的更新时间: 'T-1' })).状态).toBe(404);
    expect((await 发({ 种类: '校赛管理员', 编号: 'sa-1', 改动: { status: '已通过' }, 读到的更新时间: '旧的' })).状态).toBe(409);
    expect(await 发({ 种类: '校赛', 编号: 'sc-1', 改动: { status: '已发布' }, 读到的更新时间: 'T-1' }, null)).toMatchObject({ 状态: 422, 内容: { message: 'school_review_not_ready' } });
  });
});
