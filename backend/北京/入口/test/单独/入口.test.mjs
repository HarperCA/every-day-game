// 北京入口：小程序的请求都从这里进，按路径分给 5 项服务里对外的 4 项（2026-11-02）。路径、请求内容、回复格式照小程序已经写好的
// 自有服务器模式（apps/miniprogram/services/cloudSession.ts、clientLog.ts），小程序那边不用改：
//   POST /api/login       { code }                                   不要令牌
//   POST /api/userData    { action, ..., userSessionToken }           要令牌；过期回 user_session_expired，小程序据此重新登录再试一次
//   POST /api/publicData  { action, ... }                             不要令牌；带了有效令牌的按这个用户排首页
//   POST /api/clientLog   { events }                                  不要令牌，匿名
// 发提醒不对外（它会交出 openid）。令牌也认请求头 Authorization: Bearer。服务真用，库用内存里的，微信是假的。
import { describe, expect, test } from 'vitest';
import { 签发令牌 } from '../../../../共用/工具/令牌.mjs';
import { openMainDb, 同步 } from '../../../主数据库/index.mjs';
import { openUserDb } from '../../../副数据库/index.mjs';
import { 打开报错库 } from '../../../服务/收集报错/报错库.mjs';
import { 处理请求, 请求上限 } from '../../接口.mjs';

const 密钥 = 'k'.repeat(32);
const NOW = new Date('2026-11-02T02:00:00Z');
function 环境(over = {}) {
  const 主库 = openMainDb({ file: ':memory:', now: () => NOW });
  同步.收下(主库, { 比赛们: [{ id: 'event-math', version: 1, name: '全国大学生数学建模竞赛', level: '国家级', data: {} }],
    届次们: [{ id: 'ed-math-2026', competition_id: 'event-math', version: 1, registration_start: '2026-10-01', registration_end: '2026-11-20', status: '已发布', data: { edition_name: '2026 年' } }] });
  const 排了 = [];
  return {
    排了,
    env: { 主库, 用户库: openUserDb({ file: ':memory:', now: () => NOW }), 报错库: 打开报错库(':memory:'), 密钥, now: () => NOW,
      微信: { appId: 'wx-app', exchangeCode: async code => (code === 'code-1' ? { openid: 'o-1' } : Promise.reject(new Error('40029'))) },
      排提醒: 提醒们 => 排了.push(...提醒们.map(r => r.id)), ...over },
  };
}
const 发 = (env, 路径, 内容, 头 = {}) => 处理请求({ 方法: 'POST', 路径, 头, 正文: JSON.stringify(内容) }, env);
const 登录 = async env => (await 发(env, '/api/login', { code: 'code-1' })).内容.data.userSessionToken;

describe('登录和用户数据', () => {
  test('登录交回 userSessionToken；带着它（放在请求内容里，或者请求头）调用户数据', async () => {
    const { env } = 环境();
    const r = await 发(env, '/api/login', { code: 'code-1' });
    expect(r).toMatchObject({ 状态: 200, 内容: { ok: true, data: { isNewUser: true, openid: 'o-1' } } });
    const 令牌 = r.内容.data.userSessionToken;
    expect(await 发(env, '/api/userData', { action: 'setFavorite', editionId: 'ed-math-2026', favorited: true, userSessionToken: 令牌 })).toEqual({ 状态: 200, 内容: { ok: true, data: { favorited: true } } });
    const 列表 = await 发(env, '/api/userData', { action: 'listFavorites' }, { authorization: `Bearer ${令牌}` });
    expect(列表.内容.data.map(f => f.editionId)).toEqual(['ed-math-2026']);
  });
  test('用户数据：没令牌、签名不对 401 unauthenticated；过期 401 user_session_expired（小程序据此重新登录）', async () => {
    const { env } = 环境();
    expect(await 发(env, '/api/userData', { action: 'listFavorites' })).toEqual({ 状态: 401, 内容: { ok: false, message: 'unauthenticated' } });
    expect((await 发(env, '/api/userData', { action: 'listFavorites', userSessionToken: 签发令牌('o-1', 'z'.repeat(32), { now: NOW.getTime() }) })).内容.message).toBe('unauthenticated');
    await 登录(env);
    const 旧令牌 = 签发令牌('o-1', 密钥, { now: NOW.getTime() - 3 * 3600 * 1000 });
    expect(await 发(env, '/api/userData', { action: 'listFavorites', userSessionToken: 旧令牌 })).toEqual({ 状态: 401, 内容: { ok: false, message: 'user_session_expired' } });
  });
  test('存好的提醒交给发提醒排计划', async () => {
    const { env, 排了 } = 环境();
    const 令牌 = await 登录(env);
    const 提醒 = { id: 'r-1', editionId: 'ed-math-2026', competitionName: '全国大学生数学建模竞赛', eventType: 'registration_end', eventLabel: '报名截止',
      targetAt: '2026-11-20T15:59:59.000Z', advanceKey: '1d', advanceLabel: '提前 1 天', remindAt: '2026-11-19T15:59:59.000Z',
      authorizationStatus: 'accepted', deliveryStatus: 'pending', scheduleChangeStatus: 'normal', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
    expect((await 发(env, '/api/userData', { action: 'mergeReminders', records: [提醒], userSessionToken: 令牌 })).内容.ok).toBe(true);
    expect(排了).toEqual(['r-1']);
  });
});

describe('公开数据和收集报错：不要令牌', () => {
  test('公开数据不登录也能看；带了过期或乱写的令牌当没登录，照样能看', async () => {
    const { env } = 环境();
    expect((await 发(env, '/api/publicData', { action: 'list', query: {} })).内容).toMatchObject({ ok: true, data: { total: 1 } });
    expect((await 发(env, '/api/publicData', { action: 'get', id: 'ed-math-2026', userSessionToken: 'a.b' })).内容).toMatchObject({ ok: true, data: { id: 'ed-math-2026' } });
  });
  test('收集报错：匿名收下', async () => {
    const { env } = 环境();
    expect(await 发(env, '/api/clientLog', { events: [{ kind: 'slow', page: 'pages/index/index' }] })).toEqual({ 状态: 200, 内容: { ok: true, saved: 1 } });
  });
});

describe('其余的一律拒绝', () => {
  test('发提醒不对外；不认识的路径 404；不是 POST 405；不是 JSON 对象 400；太大 413', async () => {
    const { env } = 环境();
    expect((await 发(env, '/api/sendReminders', { action: 'claim', key: 'r-1' })).状态).toBe(404);
    expect((await 发(env, '/api/adminData', {})).状态).toBe(404);
    expect((await 处理请求({ 方法: 'GET', 路径: '/api/publicData', 头: {}, 正文: '' }, env)).状态).toBe(405);
    expect(await 处理请求({ 方法: 'POST', 路径: '/api/clientLog', 头: {}, 正文: '不是json' }, env)).toEqual({ 状态: 400, 内容: { ok: false, message: 'bad_request' } });
    expect((await 处理请求({ 方法: 'POST', 路径: '/api/clientLog', 头: {}, 正文: 'x'.repeat(请求上限 + 1) }, env)).状态).toBe(413);
  });
  test('服务里抛错：500 internal_error，不把细节回给小程序；没配令牌密钥：500', async () => {
    const { env } = 环境({ 用户库: { find: () => { throw new Error('数据库 /opt/x 坏了'); } } });
    expect(await 发(env, '/api/login', { code: 'code-1' })).toEqual({ 状态: 500, 内容: { ok: false, message: 'internal_error' } });
    const { env: 没密钥 } = 环境({ 密钥: '' });
    expect((await 发(没密钥, '/api/userData', { action: 'listFavorites', userSessionToken: 'a.b' })).状态).toBe(500);
  });
});
