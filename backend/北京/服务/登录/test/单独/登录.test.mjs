// 登录：搬自上海云函数 login（2026-11-02），去掉云函数的兼容外壳。
// 上海：openid 由微信经 cloud.getWXContext() 自动给。北京：小程序把 wx.login 的 code 交来，向微信换 openid（共用/工具/微信.mjs）；
// 找账号、没有就建、停用的不让登录：副数据库的 用户.新建或登录；最后签一个令牌交回（共用/工具/令牌.mjs），之后的请求带着它，
// 北京其他服务和美国的赛事助手都用它认人。微信是假的，不连网。
import { describe, expect, test } from 'vitest';
import { 校验令牌 } from '../../../../../共用/工具/令牌.mjs';
import { openUserDb, 用户 } from '../../../../副数据库/index.mjs';
import { handle } from '../../index.mjs';

const 密钥 = 'k'.repeat(32);
const NOW = new Date('2026-11-02T02:00:00Z');
const 假微信 = (表 = { 'code-1': { openid: 'o-1', unionid: 'u-1' } }) => ({
  appId: 'wx-app', 换过: [],
  async exchangeCode(code) { this.换过.push(code); if (!表[code]) throw new Error('wechat_jscode2session_failed:40029:invalid code'); return 表[code]; },
});
const 环境 = (over = {}) => ({ 用户库: openUserDb({ file: ':memory:', now: () => NOW }), 微信: 假微信(), 密钥, now: () => NOW, ...over });

describe('登录', () => {
  test('第一次登录：用 code 换 openid，建账号，交回账号编号、是新用户、openid 和令牌；令牌里认的是这个 openid', async () => {
    const env = 环境();
    const r = await handle({ code: 'code-1' }, env);
    expect(r).toMatchObject({ ok: true, data: { isNewUser: true, openid: 'o-1' } });
    expect(env.微信.换过).toEqual(['code-1']);
    expect(用户.按openid(env.用户库, 'o-1')).toMatchObject({ id: r.data.userId, appid: 'wx-app', unionid: 'u-1', status: 'active' });
    // 字段名照小程序已经写好的自有服务器模式：userSessionToken（apps/miniprogram/services/cloudSession.ts）
    expect(校验令牌(r.data.userSessionToken, 密钥, { now: NOW.getTime() })).toEqual({ ok: true, openid: 'o-1', 过期: r.data.userSessionExpiresAt });
    expect(r.data.userSessionExpiresAt).toBe(NOW.getTime() + 2 * 3600 * 1000);
  });
  test('再次登录：同一个账号，不是新用户，记下这次登录时间', async () => {
    const env = 环境();
    const 第一次 = await handle({ code: 'code-1' }, env);
    const 以后 = new Date('2026-11-03T02:00:00Z');
    const 第二次 = await handle({ code: 'code-1' }, { ...env, now: () => 以后 });
    expect(第二次.data).toMatchObject({ userId: 第一次.data.userId, isNewUser: false });
    expect(用户.读取(env.用户库, 第一次.data.userId).last_login_at).toBe(以后.toISOString());
  });
  test('没带 code、微信换不到身份：交回“无法取得微信用户身份”（上海原来的提示），不建账号', async () => {
    const env = 环境();
    expect(await handle({}, env)).toEqual({ ok: false, message: '无法取得微信用户身份' });
    expect(await handle({ code: '过期的' }, env)).toEqual({ ok: false, message: '无法取得微信用户身份' });
    expect(env.用户库.find('user_account', {})).toEqual([]);
  });
  test('账号停用了：不让登录，不签令牌（上海原来报 user_account_disabled）', async () => {
    const env = 环境();
    const { data } = await handle({ code: 'code-1' }, env);
    用户.停用(env.用户库, data.userId, { now: NOW });
    expect(await handle({ code: 'code-1' }, env)).toEqual({ ok: false, message: 'user_account_disabled' });
  });
  test('只认服务端向微信换来的 openid：请求里自己写的 openid 不理', async () => {
    const r = await handle({ code: 'code-1', openid: 'o-冒充' }, 环境());
    expect(r.data.openid).toBe('o-1');
  });
  test('服务器没配令牌密钥：报错，不交回没法校验的令牌', async () => {
    await expect(handle({ code: 'code-1' }, 环境({ 密钥: '' }))).rejects.toThrow(/密钥/);
  });
});
