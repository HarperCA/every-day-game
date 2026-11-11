// 登录：搬自上海云函数 login（2026-11-02），去掉云函数的兼容外壳。说明见同目录 README.md。
//   1 小程序 wx.login 拿到的 code 交来，向微信换 openid（共用/工具/微信.mjs）。上海是 cloud.getWXContext() 自动给的，自己的服务器要自己换。
//   2 找账号、没有就建、停用的不让登录：副数据库的 用户.新建或登录（规则同上海的 login + loginPolicy）
//   3 签一个令牌交回（共用/工具/令牌.mjs，默认 2 小时）：之后的请求带着它，北京的其他服务和美国的赛事助手都用它认人
// 只认服务端向微信换来的 openid，请求里自己写的不理。
//
//   handle({ code }, { 用户库, 微信, 密钥, now }) → { ok: true, data: { userId, isNewUser, openid, userSessionToken, userSessionExpiresAt } } 或 { ok: false, message }
//     openid 照旧交回给小程序（上海也交回）；令牌的字段名照小程序已经写好的自有服务器模式（services/cloudSession.ts 认 userSessionToken）
import { 签发令牌, 校验令牌 } from '../../../共用/工具/令牌.mjs';
import { 用户 } from '../../副数据库/index.mjs';

export async function handle(request = {}, { 用户库, 微信, 密钥, now = () => new Date() } = {}) {
  if (typeof 密钥 !== 'string' || 密钥.length < 32) throw new Error('令牌密钥没配或太短（SESSION_SIGNING_KEY）');
  let 身份;
  try {
    身份 = await 微信.exchangeCode(request.code);
  } catch (error) {
    console.error('[登录] 向微信换 openid 失败', String(error?.message || error).slice(0, 200));
    return { ok: false, message: '无法取得微信用户身份' };
  }
  const 现在 = now();
  let 账号;
  try {
    账号 = 用户.新建或登录(用户库, { openid: 身份.openid, appid: 微信.config?.appId || 微信.appId || null, unionid: 身份.unionid || null }, { now: 现在 });
  } catch (error) {
    if (error.message === '账号已停用') return { ok: false, message: 'user_account_disabled' };
    throw error;
  }
  const token = 签发令牌(身份.openid, 密钥, { now: 现在.getTime() });
  return {
    ok: true,
    data: { userId: 账号.id, isNewUser: 账号.created_at === 现在.toISOString(), openid: 身份.openid, userSessionToken: token, userSessionExpiresAt: 校验令牌(token, 密钥, { now: 现在.getTime() }).过期 },
  };
}
