// 后台的小服务器（服务器端）：提供界面文件，把 POST api/后台/<功能> 交给 接口.mjs，GET 海报/<文件名> 从图片总库读图；登录见 登录.mjs。
// 挂在 https://107-175-111-18.sslip.io/new-admin/ 下面（nginx 去掉前缀转进来），所以网页里的地址都写相对的。
//   建服务({ 口令, 环境, now }) → http.Server（还没 listen）
//     口令：配了就要先登录才能取数据、看海报（界面文件不用）；空的（本机预览）不用登录
//     环境()：交给各功能 数据库.mjs 的东西（比赛库、用户副本、回传……），由 服务.mjs 准备
//   POST api/登录 { 口令 } → 成功发会话 cookie；口令连错 5 次，10 分钟内都回 429
//   POST api/退出 → 清掉会话 cookie
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 读正文 } from '../../共用/工具/请求正文.mjs';
import { 图片总库 } from '../db/index.mjs';
import { 处理后台请求 } from './接口.mjs';
import { 创建限次, 会话头, 会话秘钥, 口令对不对, 清会话头, 签会话, 读会话, 验会话 } from './登录.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const 图片类型 = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
// 候选图原图最大 5 MB，编成 base64 约 6.7 MB
const 请求上限 = 8 * 1024 * 1024;
// 浏览器只能拿到界面文件：服务器端的 数据库.mjs、接口.mjs、服务.mjs、建服务.mjs、登录.mjs、测试都不给
const 服务器端 = ['接口.mjs', '服务.mjs', '建服务.mjs', '登录.mjs', '每日清理.mjs'].map(名 => path.join(ROOT, 名));
const 不给 = file => file.endsWith(`${path.sep}数据库.mjs`) || file.includes(`${path.sep}test${path.sep}`) || 服务器端.includes(file);

function 回(res, 状态, 内容, 头 = {}) {
  res.writeHead(状态, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...头 }).end(JSON.stringify(内容));
}

export function 建服务({ 口令 = '', 环境, now = () => Date.now() }) {
  const 秘钥 = 口令 ? 会话秘钥(口令) : null;
  const 限次 = 创建限次();
  const 登录了 = req => !口令 || 验会话(秘钥, 读会话(req.headers), now());

  return http.createServer(async (req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }

    if (rel === '/api/登录' || rel === '/api/退出') {
      if (req.method !== 'POST') { 回(res, 405, { ok: false, 错误: '只接受 POST' }); return; }
      if (rel === '/api/退出') { 回(res, 200, { ok: true }, { 'Set-Cookie': 清会话头() }); return; }
      if (!口令) { 回(res, 200, { ok: true, 数据: { 不用登录: true } }); return; }
      if (限次.锁着(now())) { 回(res, 429, { ok: false, 错误: '口令错太多次了，10 分钟后再试' }); return; }
      const { 正文 } = await 读正文(req, 4096);
      let 给的 = '';
      try { 给的 = JSON.parse(正文 || '{}').口令; } catch { /* 当成没给 */ }
      if (!口令对不对(给的, 口令)) { 限次.记错(now()); 回(res, 401, { ok: false, 错误: '口令不对' }); return; }
      限次.清();
      回(res, 200, { ok: true }, { 'Set-Cookie': 会话头(签会话(秘钥, now())) });
      return;
    }

    if (rel.startsWith('/api/后台/')) {
      if (req.method !== 'POST') { 回(res, 405, { ok: false, 错误: '只接受 POST' }); return; }
      if (!登录了(req)) { 回(res, 401, { ok: false, 错误: '要先登录', 要登录: true }); return; }
      const { 正文, 太大 } = await 读正文(req, 请求上限);
      if (太大) { 回(res, 413, { ok: false, 错误: '请求太大' }); return; }
      try {
        const 数据 = await 处理后台请求(rel.slice('/api/后台/'.length), 正文 ? JSON.parse(正文) : {}, 环境());
        回(res, 200, { ok: true, 数据 });
      } catch (错误) {
        回(res, 错误.kind === '找不到' ? 404 : 500, { ok: false, 错误: String(错误?.message || 错误) });
      }
      return;
    }

    if (rel.startsWith('/海报/') && req.method === 'GET') {
      if (!登录了(req)) { res.writeHead(401).end('要先登录'); return; }
      try {
        const { 格式, 内容 } = 图片总库.读(rel.slice('/海报/'.length));
        res.writeHead(200, { 'Content-Type': 图片类型[格式], 'Cache-Control': 'private, max-age=86400' }).end(内容);
      } catch { res.writeHead(404).end('找不到'); }
      return;
    }

    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(ROOT, '.' + rel);
    if (!file.startsWith(ROOT + path.sep) || 不给(file)) { res.writeHead(404).end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end('找不到'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
    });
  });
}
