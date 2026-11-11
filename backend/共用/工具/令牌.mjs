// 令牌：北京在用户登录时签发，美国收到请求时校验（2026-11-01 用户定）。两台服务器用同一个密钥（环境变量 SESSION_SIGNING_KEY），
// 美国不用再找微信换 openid，也不用存小程序密钥。令牌 = base64url(JSON { openid, exp }) + "." + HMAC-SHA256 签名，默认 2 小时有效；
// 过期后小程序找北京重新要一个。
//
//   签发令牌(openid, 密钥, { 有效秒, now })   → 令牌字符串
//   校验令牌(令牌, 密钥, { now })             → { ok: true, openid, 过期 } 或 { ok: false, 原因: 缺令牌 | 格式不对 | 签名不对 | 已过期 }
//   密钥没配或少于 32 个字符直接抛错：配置错了宁可谁都不放行。
import crypto from 'node:crypto';

export const 有效秒数 = 2 * 60 * 60;
const 最短密钥 = 32;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function 检查密钥(密钥) {
  if (typeof 密钥 !== 'string' || 密钥.length < 最短密钥) throw new Error(`令牌密钥没配或太短（至少 ${最短密钥} 个字符）`);
}

const 签名 = (内容, 密钥) => crypto.createHmac('sha256', 密钥).update(内容).digest('base64url');

export function 签发令牌(openid, 密钥, { 有效秒 = 有效秒数, now = Date.now() } = {}) {
  检查密钥(密钥);
  if (typeof openid !== 'string' || !openid) throw new Error('签发令牌要有 openid');
  const 内容 = Buffer.from(JSON.stringify({ openid, exp: Math.floor(now / 1000) + 有效秒 })).toString('base64url');
  return `${内容}.${签名(内容, 密钥)}`;
}

export function 校验令牌(令牌, 密钥, { now = Date.now() } = {}) {
  检查密钥(密钥);
  if (typeof 令牌 !== 'string' || !令牌) return { ok: false, 原因: '缺令牌' };
  const 段 = 令牌.split('.');
  if (段.length !== 2 || !段.every(s => BASE64URL.test(s))) return { ok: false, 原因: '格式不对' };
  const [内容, 带来的签名] = 段;
  const 应有 = Buffer.from(签名(内容, 密钥));
  const 带来 = Buffer.from(带来的签名);
  if (应有.length !== 带来.length || !crypto.timingSafeEqual(应有, 带来)) return { ok: false, 原因: '签名不对' };
  let 数据;
  try { 数据 = JSON.parse(Buffer.from(内容, 'base64url').toString('utf8')); } catch { return { ok: false, 原因: '格式不对' }; }
  if (typeof 数据?.openid !== 'string' || !数据.openid || !Number.isFinite(数据.exp)) return { ok: false, 原因: '格式不对' };
  if (now >= 数据.exp * 1000) return { ok: false, 原因: '已过期' };
  return { ok: true, openid: 数据.openid, 过期: 数据.exp * 1000 };
}
