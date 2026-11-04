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
