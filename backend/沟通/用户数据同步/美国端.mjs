// 用户数据同步（美国服务器这一端，2026-11-02）：接收北京推来的一批，验签名后写进美国的用户副本（美国/db/用户副本，只读副本，只有这里写）。
// 单独起一个只听本机的小服务器，nginx 把 /sync/user 转进来；和后台分开。格式见 格式.mjs，签名和公开比赛同步共用。
//   node backend/沟通/用户数据同步/美国端.mjs     端口 USER_SYNC_PORT（默认 4332）；要 SYNC_SECRET（或 SYNC_SECRET_FILE）、DB_DIR
//
//   接收({ 方法, 头, 正文 }, { 副本库, 秘钥, now }) → { 状态, 内容 }
//     401 签名不对、过期、没签名；405 不是 POST；400 不是 JSON；422 内容不对（整批不收）；200 { ok, 写了, 删了, 清掉 }
//   建服务(环境) → http.Server（还没 listen）
import { 读正文 } from '../../共用/工具/请求正文.mjs';
import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { 用户副本 } from '../../美国/db/index.mjs';
import { 同步的表, 时间头, 签名头, 验签 } from './格式.mjs';

export const 路径 = '/sync/user';
export const 请求上限 = 2 * 1024 * 1024;
const 认识的表 = new Set(同步的表.map(t => t.表));

function 检查(批次) {
  const 写们 = 批次.写们 ?? []; const 删们 = 批次.删们 ?? [];
  if (!Array.isArray(写们) || !Array.isArray(删们)) throw new Error('写们、删们要是列表');
  for (const 条 of [...写们, ...删们]) {
    if (!条 || !认识的表.has(条.表)) throw new Error(`不认识的表：${条?.表}`);
    if (typeof 条.编号 !== 'string' || !条.编号) throw new Error(`${条.表} 缺编号`);
  }
  for (const 条 of 写们) if (!条.data || typeof 条.data !== 'object' || Array.isArray(条.data)) throw new Error(`${条.表}:${条.编号} 的内容不对`);
  if (批次.轮次 != null && typeof 批次.轮次 !== 'string') throw new Error('轮次不对');
  if (批次.收尾 && !批次.轮次) throw new Error('收尾要带轮次');
  return { 写们, 删们 };
}

export async function 接收({ 方法, 头 = {}, 正文 = '' }, { 副本库, 秘钥, now = new Date() }) {
  if (方法 !== 'POST') return { 状态: 405, 内容: { ok: false, message: 'method_not_allowed' } };
  const 验 = 验签(秘钥, 头[时间头], 正文, 头[签名头], { now: now.getTime() });
  if (!验.ok) return { 状态: 401, 内容: { ok: false, message: 验.原因 === '已过期' ? 'sync_expired' : 'sync_signature_invalid' } };
  let 批次;
  try { 批次 = JSON.parse(正文); } catch { return { 状态: 400, 内容: { ok: false, message: 'invalid_json' } }; }
  try {
    const { 写们, 删们 } = 检查(批次);
    const 写了 = 用户副本.写(副本库, 写们, { now, 轮次: 批次.轮次 ?? null });
    const 删了 = 用户副本.删(副本库, 删们);
    const 清掉 = 批次.收尾 ? 用户副本.收尾(副本库, 批次.轮次) : 0;
    return { 状态: 200, 内容: { ok: true, 写了, 删了, 清掉 } };
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
  const port = Number(process.env.USER_SYNC_PORT || 4332);
  建服务({ 副本库: 用户副本.open(), 秘钥 })
    .listen(port, '127.0.0.1', () => console.log(`美国 用户数据同步：http://127.0.0.1:${port}${路径}`));
}
