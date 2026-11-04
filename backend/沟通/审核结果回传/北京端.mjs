// 审核结果回传（北京服务器这一端，2026-11-02）：接收美国后台审核纠错、处理意见反馈的结果，验签名后写进北京副数据库的正本，交回改好的那一行。
// 单独起一个只听本机的小服务器，nginx 把 /sync/review 转进来；签名、5 分钟时效和公开比赛同步共用（../公开比赛同步/格式.mjs）。
//   node backend/沟通/审核结果回传/北京端.mjs     端口 BEIJING_REVIEW_PORT（默认 4333）；要 SYNC_SECRET（或 SYNC_SECRET_FILE）、DB_DIR
//
// 一次一条：{ 种类: '纠错' | '意见反馈', 编号, 改动, 读到的更新时间 }
//   纠错能改 status；意见反馈能改 status、public_reply、internal_note。规则在副数据库的 纠错.处理、意见反馈.处理
//   接收({ 方法, 头, 正文 }, { 用户库, 秘钥, now }) → { 状态, 内容 }
//     200 { ok, 行 }；401 签名；405；400 不是 JSON；404 找不到；409 别人刚改过（feedback_conflict）；422 其余不对
import { 读正文 } from '../../共用/工具/请求正文.mjs';
import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { openUserDb, 纠错, 意见反馈 } from '../../北京/副数据库/index.mjs';
import { 时间头, 签名头, 验签 } from '../公开比赛同步/格式.mjs';

export const 路径 = '/sync/review';
const 种类们 = {
  纠错: { 能改: ['status'], 处理: 纠错.处理 },
  意见反馈: { 能改: ['status', 'public_reply', 'internal_note'], 处理: 意见反馈.处理 },
};
const 状态码 = { feedback_not_found: 404, feedback_conflict: 409 };

export async function 接收({ 方法, 头 = {}, 正文 = '' }, { 用户库, 秘钥, now = new Date() }) {
  if (方法 !== 'POST') return { 状态: 405, 内容: { ok: false, message: 'method_not_allowed' } };
  const 验 = 验签(秘钥, 头[时间头], 正文, 头[签名头], { now: now.getTime() });
  if (!验.ok) return { 状态: 401, 内容: { ok: false, message: 验.原因 === '已过期' ? 'sync_expired' : 'sync_signature_invalid' } };
  let 请求;
  try { 请求 = JSON.parse(正文); } catch { return { 状态: 400, 内容: { ok: false, message: 'invalid_json' } }; }
  try {
    const 种类 = Object.hasOwn(种类们, 请求?.种类) ? 种类们[请求.种类] : null;
    if (!种类) throw new Error('unsupported_review_kind');
    const 改动 = 请求.改动 && typeof 请求.改动 === 'object' ? 请求.改动 : {};
    if (Object.keys(改动).some(字段 => !种类.能改.includes(字段))) throw new Error('field_not_editable');
    const 行 = 种类.处理(用户库, String(请求.编号 || ''), { ...改动, 读到的更新时间: 请求.读到的更新时间 }, { now });
    return { 状态: 200, 内容: { ok: true, 行 } };
  } catch (错误) {
    const message = String(错误?.message || 错误).slice(0, 300);
    return { 状态: 状态码[message] || 422, 内容: { ok: false, message } };
  }
}

export function 建服务(环境) {
  return http.createServer(async (req, res) => {
    const 回 = (状态, 内容) => res.writeHead(状态, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(内容));
    if (new URL(req.url, 'http://localhost').pathname !== 路径) { 回(404, { ok: false, message: 'not_found' }); return; }
    const { 正文, 太大 } = await 读正文(req, 64 * 1024);
    if (太大) { res.setHeader('Connection', 'close'); 回(413, { ok: false, message: 'request_too_large' }); return; }
    const { 状态, 内容 } = await 接收({ 方法: req.method, 头: req.headers, 正文 }, { ...环境, now: new Date() });
    回(状态, 内容);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const 秘钥 = process.env.SYNC_SECRET || (process.env.SYNC_SECRET_FILE ? fs.readFileSync(process.env.SYNC_SECRET_FILE, 'utf8').trim() : '');
  const port = Number(process.env.BEIJING_REVIEW_PORT || 4333);
  建服务({ 用户库: openUserDb(), 秘钥 })
    .listen(port, '127.0.0.1', () => console.log(`北京 审核结果回传：http://127.0.0.1:${port}${路径}`));
}
