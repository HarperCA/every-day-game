// 赛事助手的小服务器：只接 POST /api/assistant，交给 接口.mjs。只听本机，外面由 nginx 转进来（https 在 nginx 上）。
//   node backend/美国/赛事助手/服务.mjs     端口 ASSISTANT_PORT（默认 4320）
// 要的环境变量：SESSION_SIGNING_KEY（和北京共用的令牌密钥）、WECHAT_APPID 和 WECHAT_APPSECRET(_FILE)（内容安全要换 access_token）、
// AI 总管的密钥、DB_DIR。正式的美国后端建好后挂 接口.mjs 的同一个函数，这个文件可以不用。
//
//   建服务({ 密钥, 回答 }) → http.Server（还没 listen）；回答(event, openid)
import { 读正文 } from '../../共用/工具/请求正文.mjs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { 处理助手请求, 请求上限 } from './接口.mjs';

function 回(res, 状态, 内容) {
  res.writeHead(状态, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(内容));
}

export function 建服务({ 密钥, 回答 }) {
  return http.createServer(async (req, res) => {
    if (new URL(req.url, 'http://localhost').pathname !== '/api/assistant') { 回(res, 404, { ok: false, message: 'not_found' }); return; }
    const { 正文, 太大 } = await 读正文(req, 请求上限);
    if (太大) { res.setHeader('Connection', 'close'); 回(res, 413, { ok: false, message: 'request_too_large' }); return; }
    const { 状态, 内容 } = await 处理助手请求({ 方法: req.method, 头: req.headers, 正文 }, { 密钥, 回答 });
    回(res, 状态, 内容);
  });
}

// 直接运行时接上真实的比赛库、问答记录、AI 总管和微信
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [{ openDb }, ai, { WeChatClient, readWeChatConfig }, { 打开问答记录 }, { 回答 }] = await Promise.all([
    import('../db/index.mjs'), import('../ai/index.mjs'), import('../../共用/工具/微信.mjs'), import('./问答记录.mjs'), import('./index.mjs'),
  ]);
  const 密钥 = process.env.SESSION_SIGNING_KEY || '';
  if (!密钥) console.error('[赛事助手] 没配 SESSION_SIGNING_KEY：所有请求都会回 500');
  const 依赖 = { 比赛库: openDb({ readOnly: true }), 问答记录: 打开问答记录(), ai, 微信: new WeChatClient(readWeChatConfig()) };
  const port = Number(process.env.ASSISTANT_PORT || 4320);
  建服务({ 密钥, 回答: (event, openid) => 回答(event, { ...依赖, openid }) })
    .listen(port, '127.0.0.1', () => console.log(`赛事助手：http://127.0.0.1:${port}/api/assistant`));
}
