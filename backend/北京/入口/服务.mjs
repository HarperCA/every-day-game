// 北京的小服务器：小程序的请求都交给 接口.mjs。只听本机，外面由 nginx 转进来（https 在 nginx 上，域名 xiaohuiworks.cn）。
//   node backend/北京/入口/服务.mjs     端口 BEIJING_PORT（默认 4330）
// 直接运行时：打开主数据库、副数据库（用户管理中心）、报错库，接上微信，起发提醒的调度（保存提醒后经 排提醒 交给它）。
// 要的环境变量：SESSION_SIGNING_KEY（和美国共用的令牌密钥）、WECHAT_APPID、WECHAT_APPSECRET(_FILE)、DB_DIR；
// 海报：POSTER_BASE_URL（网站对外提供海报文件夹的地址，没配就不给海报）、POSTER_DIR。
//
//   建服务(环境) → http.Server（还没 listen）；环境同 接口.mjs 的 处理请求
import { 读正文 } from '../../共用/工具/请求正文.mjs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { 处理请求, 请求上限 } from './接口.mjs';

function 回(res, 状态, 内容) {
  res.writeHead(状态, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(内容));
}

export function 建服务(环境) {
  return http.createServer(async (req, res) => {
    const { 正文, 太大 } = await 读正文(req, 请求上限);
    if (太大) { res.setHeader('Connection', 'close'); 回(res, 413, { ok: false, message: 'request_too_large' }); return; }
    const { 状态, 内容 } = await 处理请求({ 方法: req.method, 路径: new URL(req.url, 'http://localhost').pathname, 头: req.headers, 正文 }, 环境);
    回(res, 状态, 内容);
  });
}

// 直接运行时接上真实的库、微信和发提醒
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [{ openMainDb }, { openUserDb }, { 打开报错库 }, { WeChatClient, readWeChatConfig }, { 启动发提醒 }] = await Promise.all([
    import('../主数据库/index.mjs'), import('../副数据库/index.mjs'), import('../服务/收集报错/报错库.mjs'), import('../../共用/工具/微信.mjs'), import('../服务/发提醒/index.mjs'),
  ]);
  const 密钥 = process.env.SESSION_SIGNING_KEY || '';
  if (!密钥) console.error('[北京] 没配 SESSION_SIGNING_KEY：登录和用户数据都会回 500');
  const 微信配置 = readWeChatConfig();
  const 用户库 = openUserDb();
  const 主库 = openMainDb();
  const 发提醒 = 启动发提醒({ 用户库, 主库, 微信配置: { appid: 微信配置.appId, secret: 微信配置.appSecret } });
  const port = Number(process.env.BEIJING_PORT || 4330);
  建服务({
    主库, 用户库, 报错库: 打开报错库(), 微信: new WeChatClient(微信配置), 密钥,
    排提醒: 发提醒.排上, 海报地址: process.env.POSTER_BASE_URL || '',
  }).listen(port, '127.0.0.1', () => console.log(`北京：http://127.0.0.1:${port}/api/（login、userData、publicData、clientLog）`));
}
