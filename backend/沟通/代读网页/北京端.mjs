// 代读网页（北京服务器这一端，2026-11-09）：收美国的代读请求，验签名后按同一套安全规则读公网网页，把结果交回美国。
// 单独起一个只听本机的小服务器，nginx 把 /sync/fetch 转进来；签名、5 分钟时效和公开比赛同步共用（../公开比赛同步/格式.mjs）。
//   node backend/沟通/代读网页/北京端.mjs     端口 BEIJING_FETCH_PORT（默认 4334）；要 SYNC_SECRET（或 SYNC_SECRET_FILE）
//
// 读网页直接用 美国/web 的 读网页、取源码（北京打包要带上 美国/web，见 README.md）：规范化网址、只读公网 http/https（跳转后每一跳也查）、
//   遵守 robots、同一个爬虫身份（user-agent）、同一网站间隔 1.5 秒（北京这个进程里共用）、读正文、PDF、Word，和美国是同一份代码。
//   上限比美国紧：15 秒、3MB、最多 5 次跳转（上限 常量）。
//
// 一次一个网址：{ 网址, 方式: '网页' | '源码', etag?, 最后修改? }
//   接收({ 方法, 头, 正文 }, { 秘钥, now, 读网页, 取源码 }) → { 状态, 内容 }
//     200 { ok: true, 结果 }：方式“网页”的结果和 读网页() 一样，“源码”的和 取源码() 一样（etag、最后修改原样转给取源码）；
//         读不到（不安全、robots 不允许、超时……）也是 200，原因在 结果.status、结果.error 里
//     401 签名不对 / 过期；405 不是 POST；400 不是 JSON；422 网址、方式、etag、最后修改不对；500 读的时候程序出错
//     读网页、取源码默认用 美国/web 的，测试注入假的
import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { 读正文 } from '../../共用/工具/请求正文.mjs';
import { 读网页 as 默认读网页, 取源码 as 默认取源码 } from '../../美国/web/index.mjs';
import { 时间头, 签名头, 验签 } from '../公开比赛同步/格式.mjs';

export const 路径 = '/sync/fetch';
export const 上限 = { 超时: 15_000, 最大字节: 3 * 1024 * 1024, 最多跳转: 5 };
const 方式们 = ['网页', '源码'];
const 可选文字 = 值 => 值 == null || (typeof 值 === 'string' && 值.length <= 512);

function 检查请求(请求) {
  if (!请求 || typeof 请求 !== 'object') return 'invalid_request';
  if (typeof 请求.网址 !== 'string' || !请求.网址 || 请求.网址.length > 4096) return 'invalid_url';
  if (!方式们.includes(请求.方式)) return 'invalid_mode';
  if (!可选文字(请求.etag) || !可选文字(请求.最后修改)) return 'invalid_version_tag';
  return null;
}

export async function 接收({ 方法, 头 = {}, 正文 = '' }, { 秘钥, now = new Date(), 读网页 = 默认读网页, 取源码 = 默认取源码 }) {
  if (方法 !== 'POST') return { 状态: 405, 内容: { ok: false, message: 'method_not_allowed' } };
  const 验 = 验签(秘钥, 头[时间头], 正文, 头[签名头], { now: now.getTime() });
  if (!验.ok) return { 状态: 401, 内容: { ok: false, message: 验.原因 === '已过期' ? 'sync_expired' : 'sync_signature_invalid' } };
  let 请求;
  try { 请求 = JSON.parse(正文); } catch { return { 状态: 400, 内容: { ok: false, message: 'invalid_json' } }; }
  const 不对 = 检查请求(请求);
  if (不对) return { 状态: 422, 内容: { ok: false, message: 不对 } };
  try {
    const 结果 = 请求.方式 === '源码'
      ? await 取源码(请求.网址, { ...上限, etag: 请求.etag ?? null, 最后修改: 请求.最后修改 ?? null })
      : await 读网页(请求.网址, { ...上限 });
    return { 状态: 200, 内容: { ok: true, 结果 } };
  } catch (错误) {
    return { 状态: 500, 内容: { ok: false, message: String(错误?.message || 错误).slice(0, 300) } };
  }
}

export function 建服务(环境) {
  return http.createServer(async (req, res) => {
    const 回 = (状态, 内容) => res.writeHead(状态, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(内容));
    if (new URL(req.url, 'http://localhost').pathname !== 路径) { 回(404, { ok: false, message: 'not_found' }); return; }
    const { 正文, 太大 } = await 读正文(req, 16 * 1024);
    if (太大) { res.setHeader('Connection', 'close'); 回(413, { ok: false, message: 'request_too_large' }); return; }
    const { 状态, 内容 } = await 接收({ 方法: req.method, 头: req.headers, 正文 }, { ...环境, now: new Date() });
    回(状态, 内容);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const 秘钥 = process.env.SYNC_SECRET || (process.env.SYNC_SECRET_FILE ? fs.readFileSync(process.env.SYNC_SECRET_FILE, 'utf8').trim() : '');
  const port = Number(process.env.BEIJING_FETCH_PORT || 4334);
  if (!秘钥) { console.error('缺 SYNC_SECRET 或 SYNC_SECRET_FILE'); process.exit(1); }
  建服务({ 秘钥 })
    .listen(port, '127.0.0.1', () => console.log(`北京 代读网页：http://127.0.0.1:${port}${路径}`));
}
