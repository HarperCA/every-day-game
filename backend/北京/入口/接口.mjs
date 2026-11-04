// 北京入口：小程序的请求都从这里进，按路径分给对外的 4 项服务（2026-11-02）。只做检查和转交，不碰网络；服务.mjs 和以后正式的部署都挂这个函数。
// 路径、请求内容、回复格式照小程序已经写好的自有服务器模式（apps/miniprogram/services/cloudSession.ts、clientLog.ts），小程序那边不用改：
//   POST /api/login       登录         不要令牌
//   POST /api/userData    用户数据     要令牌：没有、签名不对 401 unauthenticated；过期 401 user_session_expired（小程序据此重新登录再试一次）
//   POST /api/publicData  公开数据     不要令牌；带了有效令牌的按这个用户排首页，无效的当没登录
//   POST /api/clientLog   收集报错     不要令牌，匿名
// 发提醒不对外（它会交出 openid），只在本机由 服务.mjs 启动的调度调用。
// 令牌放在请求内容的 userSessionToken 里（小程序这样发），也认请求头 Authorization: Bearer；转交给服务前去掉。
// 服务里抛错回 500 internal_error，不把细节回给小程序；服务自己交回的 { ok: false } 照常回 200（小程序看 ok）。
//
//   处理请求({ 方法, 路径, 头, 正文 }, { 主库, 用户库, 报错库, 微信, 密钥, now, 排提醒, 海报地址, 海报目录 }) → { 状态, 内容 }
import { 校验令牌 } from '../../共用/工具/令牌.mjs';
import { handle as 登录 } from '../服务/登录/index.mjs';
import { handle as 用户数据 } from '../服务/用户数据/index.mjs';
import { handle as 公开数据 } from '../服务/公开数据/index.mjs';
import { handle as 收集报错 } from '../服务/收集报错/index.mjs';

// 一次最多 50 条收藏或 10 条提醒、20 条报错，64 KB 足够
export const 请求上限 = 64 * 1024;
const 拒 = (状态, message) => ({ 状态, 内容: { ok: false, message } });

// 令牌：没带 → null；交回 { ok, openid } 或 { ok: false, 原因 }
function 认令牌(请求, 头, 密钥, now) {
  const 令牌 = typeof 请求.userSessionToken === 'string' && 请求.userSessionToken
    ? 请求.userSessionToken : /^Bearer (.+)$/.exec(头.authorization || '')?.[1] || '';
  if (!令牌) return null;
  return 校验令牌(令牌, 密钥, { now: Number(now()) });
}

const 路由 = {
  '/api/login': { 令牌: '不要', 服务: (请求, env) => 登录(请求, { 用户库: env.用户库, 微信: env.微信, 密钥: env.密钥, now: env.now }) },
  '/api/userData': { 令牌: '要', 服务: (请求, env, openid) => 用户数据(请求, { 用户库: env.用户库, 主库: env.主库, openid, now: env.now, 排提醒: env.排提醒 }) },
  '/api/publicData': { 令牌: '可以带', 服务: (请求, env, openid) => 公开数据(请求, { 主库: env.主库, 用户库: env.用户库, 报错库: env.报错库, openid, now: env.now, 海报地址: env.海报地址, 海报目录: env.海报目录 }) },
  '/api/clientLog': { 令牌: '不要', 服务: (请求, env) => 收集报错(请求, { 报错库: env.报错库, now: env.now }) },
};

export async function 处理请求({ 方法, 路径, 头 = {}, 正文 = '' }, env) {
  const 这条 = Object.hasOwn(路由, 路径) ? 路由[路径] : null;
  if (!这条) return 拒(404, 'not_found');
  if (方法 !== 'POST') return 拒(405, 'method_not_allowed');
  if (正文.length > 请求上限) return 拒(413, 'request_too_large');
  let 请求;
  try { 请求 = JSON.parse(正文); } catch { return 拒(400, 'bad_request'); }
  if (!请求 || typeof 请求 !== 'object' || Array.isArray(请求)) return 拒(400, 'bad_request');
  const now = env.now || (() => new Date());

  let openid = null;
  if (这条.令牌 !== '不要') {
    if (!env.密钥) return 拒(500, 'server_misconfigured');
    const 验 = 认令牌(请求, 头, env.密钥, now);
    if (验?.ok) openid = 验.openid;
    else if (这条.令牌 === '要') return 拒(401, 验?.原因 === '已过期' ? 'user_session_expired' : 'unauthenticated');
  }
  const { userSessionToken: _令牌, ...给服务的 } = 请求;
  try {
    return { 状态: 200, 内容: await 这条.服务(给服务的, { ...env, now }, openid) };
  } catch (error) {
    console.error('[北京入口] 出错', 路径, String(error?.message || error).slice(0, 200));
    return 拒(500, 'internal_error');
  }
}
