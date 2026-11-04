// 新后台的登录（服务器端，2026-11-03）：口令核对、会话 cookie 的签发和核验、连错几次就暂停。
// 口令和旧后台同一个（服务器上 ADMIN_TOKEN_FILE 指向旧后台的口令文件），只在服务器上读，不进仓库、不交给浏览器。
//   口令对不对(给的, 真的) → true/false（按摘要比，用时和对错无关）
//   会话秘钥(口令) → 签 cookie 用的秘钥（从口令算出来，换口令后旧会话全部作废）
//   签会话(秘钥, now) → cookie 的值“到期毫秒.签名”；验会话(秘钥, 值, now) → true/false
//   会话头(值) / 清会话头() → Set-Cookie
//   读会话(请求头) → cookie 里的会话值
//   创建限次({ 次数, 窗口毫秒 }) → { 锁着(now), 记错(now), 清() }
import crypto from 'node:crypto';

export const 会话名 = 'cr_admin';
export const 会话时长毫秒 = 12 * 3600 * 1000;
const 摘要 = 文字 => crypto.createHash('sha256').update(String(文字)).digest();
const 签 = (秘钥, 文字) => crypto.createHmac('sha256', 秘钥).update(文字).digest('hex');

export function 口令对不对(给的, 真的) {
  if (!真的 || typeof 给的 !== 'string' || !给的) return false;
  return crypto.timingSafeEqual(摘要(给的), 摘要(真的));
}

export const 会话秘钥 = 口令 => 摘要(`新后台会话:${口令}`);

export function 签会话(秘钥, now) {
  const 到期 = String(now + 会话时长毫秒);
  return `${到期}.${签(秘钥, 到期)}`;
}

export function 验会话(秘钥, 值, now) {
  const m = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(String(值 || ''));
  if (!m || Number(m[1]) <= now) return false;
  return crypto.timingSafeEqual(Buffer.from(m[2], 'hex'), Buffer.from(签(秘钥, m[1]), 'hex'));
}

export const 会话头 = 值 => `${会话名}=${值}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${会话时长毫秒 / 1000}`;
export const 清会话头 = () => `${会话名}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function 读会话(头 = {}) {
  for (const 段 of String(头.cookie || '').split(';')) {
    const [名, ...值] = 段.trim().split('=');
    if (名 === 会话名) return 值.join('=');
  }
  return '';
}

export function 创建限次({ 次数 = 5, 窗口毫秒 = 10 * 60 * 1000 } = {}) {
  let 错的 = [];
  return {
    锁着: now => (错的 = 错的.filter(t => now - t < 窗口毫秒)).length >= 次数,
    记错: now => { 错的.push(now); },
    清: () => { 错的 = []; },
  };
}
