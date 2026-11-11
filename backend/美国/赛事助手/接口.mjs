// 赛事助手的 HTTP 入口 POST /api/assistant（2026-11-01 用户定：小程序直连美国，不经北京转发）。
// 小程序带着北京登录时签的令牌来，这里用两台共用的密钥验；openid 只认令牌里的，正文里写的不认。
// 令牌放在正文的 userSessionToken 里（小程序已经写好的自有服务器模式这样发，apps/miniprogram/services/cloudSession.ts），也认请求头 Authorization: Bearer；
// 转交给回答前去掉。2026-11-02 和北京入口统一成小程序认的约定：
//   没令牌、签名不对 → 401 unauthenticated；过期 → 401 user_session_expired（小程序收到它就重新登录再试一次）；没配密钥 → 500，谁都不放行。
// 这里不碰网络，只做检查和转交，正式的美国后端和 服务.mjs 都挂这个函数。
//
//   处理助手请求({ 方法, 头, 正文 }, { 密钥, 回答, now }) → { 状态, 内容 }
//     头的键是小写（Node 的 req.headers 就是小写）；回答(event, openid) 一般是 index.mjs 的 回答() 绑好比赛库等依赖
import { 校验令牌 } from '../../共用/工具/令牌.mjs';

// 提问最多 500 字（askValidation.js），加上会话编号、专业、令牌，16 KB 足够
export const 请求上限 = 16 * 1024;
const 回 = (状态, message) => ({ 状态, 内容: { ok: false, message } });

export async function 处理助手请求({ 方法, 头 = {}, 正文 = '' }, { 密钥, 回答, now = () => Date.now() }) {
  if (方法 !== 'POST') return 回(405, 'method_not_allowed');
  if (!密钥) return 回(500, 'server_misconfigured');
  if (正文.length > 请求上限) return 回(413, 'request_too_large');
  let event;
  try { event = JSON.parse(正文); } catch { return 回(400, 'bad_request'); }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return 回(400, 'bad_request');
  const { userSessionToken, ...给回答的 } = event;
  const 令牌 = typeof userSessionToken === 'string' && userSessionToken ? userSessionToken : /^Bearer (.+)$/.exec(头.authorization || '')?.[1] || '';
  const 验 = 校验令牌(令牌, 密钥, { now: Number(now()) });
  if (!验.ok) return 回(401, 验.原因 === '已过期' ? 'user_session_expired' : 'unauthenticated');
  try {
    return { 状态: 200, 内容: await 回答(给回答的, 验.openid) };
  } catch (error) {
    console.error('[赛事助手] 入口出错', error);
    return 回(500, 'assistant_failed');
  }
}
