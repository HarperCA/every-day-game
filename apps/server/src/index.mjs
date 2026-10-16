// 自有服务器上的后端：把原来 5 个云函数的处理逻辑原样跑起来。
//
// 关键设计：不重写业务代码。云函数里 require('wx-server-sdk') 会解析到
// vendor/wx-server-sdk 这个替身，替身把调用转给 SQLite 外壳
// （src/cloudbase-shim.mjs）。3757 行业务逻辑一行不改，出错面只剩外壳本身，
// 而外壳有 19 个测试钉着。
//
// 用法：node src/index.mjs
// 环境变量：
//   PORT            监听端口，默认 8787
//   DB_FILE         SQLite 文件，默认 ./data/app.db
//   ADMIN_TOKEN     管理员口令（和云函数同一把）
//   FUNCTIONS_DIR   云函数源码目录，默认指向仓库里的 cloudfunctions
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { openDatabase, listCollections } from './db.mjs';
import { createCloudShim } from './cloudbase-shim.mjs';
import { runWithContext, currentWXContext } from './context.mjs';
import { WeChatClient, readWeChatConfig, createOpenApi } from './wechat.mjs';
import { createUserSessions } from './userSession.mjs';
import { createCloudBridgeVerifier } from './cloudBridge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');

const PORT = Number(process.env.PORT) || 8787;
const DB_FILE = process.env.DB_FILE || path.join(APP_ROOT, 'data', 'app.db');
const FUNCTIONS_DIR = process.env.FUNCTIONS_DIR || path.join(REPO_ROOT, 'apps', 'miniprogram', 'cloudfunctions');

const require = createRequire(import.meta.url);
if (process.env.CLOUD_USER_BRIDGE_URL || (process.env.CLOUD_USER_SERVICE_MODE && process.env.CLOUD_USER_SERVICE_MODE !== 'local')) throw new Error('cloud_bridge_forwarding_must_not_be_enabled_on_destination');

// 云函数源码在 apps/miniprogram/cloudfunctions/ 下，它里面 require('wx-server-sdk')
// 是相对它自己的位置去找的，永远找不到 apps/server/node_modules。
// 这里只拦这一个模块名，重定向到我们的替身——不做宽泛劫持，其它模块照常解析。
// 这样源码目录保持干净，本地和服务器上行为一致。
const Module = require('node:module');
const VENDOR_SDK = require.resolve('wx-server-sdk');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveWithShim(request, ...rest) {
  if (request === 'wx-server-sdk') return VENDOR_SDK;
  return originalResolve.call(this, request, ...rest);
};

// —— 装好外壳，再加载云函数 ——

const db = openDatabase(DB_FILE);
const shim = createCloudShim(db);
// 身份改成按请求取：云函数内部调 cloud.getWXContext() 时，
// 拿到的是当前这一个请求的用户，不会串号（见 src/context.mjs）。
shim.getWXContext = () => currentWXContext();

// 订阅消息直接对接微信接口（原来由 CloudBase 代劳）。没配 AppSecret 时
// 保持抛错而不是静默成功——消息没发出去这件事必须让人看见。
const wechat = new WeChatClient(readWeChatConfig());
const userSessions = createUserSessions();
// Keep replay state outside async business transactions: a failed user write
// must never roll back a concurrently consumed bridge nonce.
const bridgeReplayDb = process.env.USER_SERVICE_BRIDGE_SECRET ? openDatabase(`${DB_FILE}.bridge-nonces.db`) : db;
const verifyCloudBridge = createCloudBridgeVerifier({ secret:process.env.USER_SERVICE_BRIDGE_SECRET, appId:readWeChatConfig().appId, db:bridgeReplayDb });
const openapi = createOpenApi(wechat);
Object.defineProperty(shim, 'openapi', {
  get() {
    if (!wechat.configured) throw new Error('wx_openapi_not_available:未配置 WECHAT_APPID / WECHAT_APPSECRET');
    return openapi;
  },
});

require('wx-server-sdk').install(shim);

function loadFunction(name) {
  const entry = path.join(FUNCTIONS_DIR, name, 'index.js');
  if (!fs.existsSync(entry)) throw new Error(`找不到云函数入口：${entry}`);
  const module_ = require(entry);
  if (typeof module_.main !== 'function') throw new Error(`${name} 没有导出 main`);
  return module_.main;
}

const handlers = {
  adminData: loadFunction('adminData'),
  publicData: loadFunction('publicData'),
  userData: loadFunction('userData'),
  login: loadFunction('login'),
  sendReminders: loadFunction('sendReminders'),
  clientLog: loadFunction('clientLog'),
  publicSync: loadFunction('publicSync'),
};

// —— HTTP 层 ——

const app = express();
app.use(express.json({ limit: '10mb' }));

// 后台前端和小程序都从别的源过来，这里明确放行——
// 我们自己的服务器自己说了算，不用再看别人的白名单脸色。
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    database: path.basename(DB_FILE),
    collections: listCollections(db),
    at: new Date().toISOString(),
  });
});

// 云函数的调用形状是 main(event)，event 里带 action 和参数。
// HTTP 这边保持同一个形状：POST /api/<函数名>，body 就是 event。
// 这样后台前端从「调用云函数」改成「调这个接口」，改动最小。
function mount(name, handler, { deriveContext, authorize } = {}) {
  app.post(`/api/${name}`, async (req, res) => {
    const event = req.body || {};
    if (authorize && !authorize(req, event)) return res.status(403).json({ ok:false, message:'forbidden' });
    if (event.Type === 'Timer') {
      return res.status(403).json({ ok: false, message: 'http_timer_event_forbidden' });
    }
    try {
      const context = deriveContext ? deriveContext(req, event) : {};
      // 接口用量记账（api-usage.mjs）：这次请求里调的外部接口记在“函数.操作”名下
      const usage = globalThis.__apiUsage;
      const call = () => runWithContext(context, () => handler(event, {}));
      const result = await (usage ? usage.run(`${name}.${String(event.action || 'call').slice(0, 60)}`, call) : call());
      res.json(result);
    } catch (error) {
      // 云函数自己会把业务错误包成 { ok:false }；能走到这里的是没接住的异常。
      console.error(`[${name}] 未捕获异常`, error);
      res.status(500).json({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  });
}

// 管理侧接口不需要微信身份，用 ADMIN_TOKEN 鉴权（云函数内部已经在做这件事）。
mount('adminData', handlers.adminData);
mount('publicData', handlers.publicData);
// Anonymous diagnostics keep only the sanitizer allowlist; no client identity
// is accepted here. nginx should rate-limit this endpoint independently.
mount('clientLog', handlers.clientLog);
mount('publicSync', handlers.publicSync, {
  authorize:(_req, event) => {
    const expected = process.env.SYNC_SECRET || '';
    if (Buffer.byteLength(expected) < 32 || typeof event.secret !== 'string') return false;
    const given = Buffer.from(event.secret);
    const wanted = Buffer.from(expected);
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  },
  deriveContext:() => ({ internal:true }),
});

// 用户侧接口只接受登录后签发的会话，不从客户端 OpenID/userId 认身份。
const deriveUserContext = (req, event) => {
  const identity = userSessions.verify(event.userSessionToken);
  if (!identity) throw new Error('user_session_expired');
  return identity;
};
mount('userData', handlers.userData, { deriveContext: deriveUserContext });
mount('sendReminders', handlers.sendReminders);

// Shanghai compatibility functions sign the identity from getWXContext, never
// the identity supplied by an old mini-program. This route cannot dispatch admin
// functions or timers. Failed forwarding never falls back to Shanghai writes.
app.post('/api/cloudBridge', async (req, res) => {
  let claims;
  try { claims = verifyCloudBridge(req.body); }
  catch (error) { return res.status(403).json({ ok:false, message:error instanceof Error ? error.message : 'cloud_bridge_invalid' }); }
  try {
    const result = await runWithContext(claims.identity, () => handlers[claims.functionName](claims.event, {}));
    if (claims.functionName === 'login' && result.ok) result.data = { ...result.data, userSessionToken:userSessions.issue(claims.identity), userSessionOrigin:process.env.PUBLIC_API_ORIGIN || '' };
    return res.json(result);
  } catch {
    return res.status(500).json({ ok:false, message:'cloud_bridge_handler_failed' });
  }
});

// 小程序登录：客户端 wx.login() 拿到 code 传过来，这里换成 openid，
// 再交给原来的 login 处理逻辑建账号/更新登录时间——那段逻辑一行不用改。
app.post('/api/login', async (req, res) => {
  const code = String(req.body?.code || '');
  try {
    const { openid, unionid } = await wechat.exchangeCode(code);
    const result = await runWithContext(
      { openid, unionid, appid: readWeChatConfig().appId },
      () => handlers.login({}, {}),
    );
    // OpenID 仅用于客户端核对账号；后续接口必须使用签名会话。
    if (result.ok) result.data = { ...result.data, openid, userSessionToken:userSessions.issue({ openid, appid:readWeChatConfig().appId }), userSessionOrigin:process.env.PUBLIC_API_ORIGIN || '' };
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[login] 失败', message);
    res.status(message.startsWith('wechat_') ? 400 : 500).json({ ok: false, message });
  }
});

// 生产上只监听本机，对外由 nginx 反代——Node 服务本身不暴露端口，
// 少一个可以被直接打的入口。本地开发不设 HOST 时监听全部网卡，方便真机调试。
const HOST = process.env.HOST || '0.0.0.0';

// Return JSON without exposing Express stack traces or absolute server paths.
app.use((error, _req, res, _next) => {
  const status = error?.status === 413 ? 413 : error?.type === 'entity.parse.failed' ? 400 : 500;
  res.status(status).json({ ok:false, message:status === 413 ? 'request_too_large' : status === 400 ? 'invalid_json' : 'internal_server_error' });
});

app.listen(PORT, HOST, () => {
  const counts = listCollections(db).map(row => `${row.collection}:${row.n}`).join(' ');
  console.log(`后端已启动 http://${HOST}:${PORT}`);
  console.log(`数据库 ${DB_FILE}`);
  console.log(`集合 ${counts || '（空）'}`);
});
