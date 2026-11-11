// 公开比赛同步（北京服务器这一端，2026-11-02）：接收美国推来的一批，验签名后交给北京主数据库的 同步.收下（版本号更大才覆盖、下架的删掉、海报先存）。
// 单独起一个只听本机的小服务器，nginx 把 /sync/public 转进来；和小程序的 /api/ 分开，小程序碰不到它。格式和秘钥规则见 格式.mjs。
//   node backend/沟通/公开比赛同步/北京端.mjs     端口 BEIJING_SYNC_PORT（默认 4331）；要 SYNC_SECRET（或 SYNC_SECRET_FILE）、DB_DIR，海报目录 POSTER_DIR
//
//   接收({ 方法, 头, 正文 }, { 主库, 秘钥, 海报目录, now }) → { 状态, 内容 }
//     401 签名不对、过期、没签名；405 不是 POST；400 不是 JSON；422 内容不对（整批不收）；200 交回收下的结果
//   建服务(环境) → http.Server（还没 listen）
import { 读正文 } from '../../共用/工具/请求正文.mjs';
import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { openMainDb, 同步 } from '../../北京/主数据库/index.mjs';
import { 时间头, 签名头, 验签 } from './格式.mjs';

export const 路径 = '/sync/public';
export const 请求上限 = 2 * 1024 * 1024;

export async function 接收({ 方法, 头 = {}, 正文 = '' }, { 主库, 秘钥, 海报目录, now = new Date() }) {
  if (方法 !== 'POST') return { 状态: 405, 内容: { ok: false, message: 'method_not_allowed' } };
  const 验 = 验签(秘钥, 头[时间头], 正文, 头[签名头], { now: now.getTime() });
  if (!验.ok) return { 状态: 401, 内容: { ok: false, message: 验.原因 === '已过期' ? 'sync_expired' : 'sync_signature_invalid' } };
  let 批次;
  try { 批次 = JSON.parse(正文); } catch { return { 状态: 400, 内容: { ok: false, message: 'invalid_json' } }; }
  try {
    return { 状态: 200, 内容: { ok: true, ...同步.收下(主库, 批次, { now, 海报目录 }) } };
  } catch (错误) {
    return { 状态: 422, 内容: { ok: false, message: String(错误?.message || 错误).slice(0, 300) } };
  }
}

export function 建服务(环境) {
  return http.createServer(async (req, res) => {
    const 回 = (状态, 内容) => res.writeHead(状态, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(内容));
    if (new URL(req.url, 'http://localhost').pathname !== 路径) { 回(404, { ok: false, message: 'not_found' }); return; }
    const { 正文, 太大 } = await 读正文(req, 请求上限);
    if (太大) { res.setHeader('Connection', 'close'); 回(413, { ok: false, message: 'request_too_large' }); return; }
    const { 状态, 内容 } = await 接收({ 方法: req.method, 头: req.headers, 正文 }, { ...环境, now: new Date() });
    回(状态, 内容);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const 秘钥 = process.env.SYNC_SECRET || (process.env.SYNC_SECRET_FILE ? fs.readFileSync(process.env.SYNC_SECRET_FILE, 'utf8').trim() : '');
  const port = Number(process.env.BEIJING_SYNC_PORT || 4331);
  建服务({ 主库: openMainDb(), 秘钥, 海报目录: process.env.POSTER_DIR || undefined })
    .listen(port, '127.0.0.1', () => console.log(`北京 公开比赛同步：http://127.0.0.1:${port}${路径}`));
}
