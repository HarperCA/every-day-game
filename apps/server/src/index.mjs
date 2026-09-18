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
import { openDatabase, listCollections } from './db.mjs';
import { createCloudShim } from './cloudbase-shim.mjs';
import { runWithContext, currentWXContext } from './context.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');

const PORT = Number(process.env.PORT) || 8787;
const DB_FILE = process.env.DB_FILE || path.join(APP_ROOT, 'data', 'app.db');
const FUNCTIONS_DIR = process.env.FUNCTIONS_DIR || path.join(REPO_ROOT, 'apps', 'miniprogram', 'cloudfunctions');

const require = createRequire(import.meta.url);

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
function mount(name, handler, { deriveContext } = {}) {
  app.post(`/api/${name}`, async (req, res) => {
    const event = req.body || {};
    const context = deriveContext ? deriveContext(req, event) : {};
    try {
      const result = await runWithContext(context, () => handler(event, {}));
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

// 用户侧接口要知道「当前是谁」。小程序登录后拿到 userId，后续请求带上它。
// 这里先从 body 取，阶段四接上微信登录后换成校验过的会话。
const deriveUserContext = (req, event) => ({
  openid: String(event.__openid || req.header('X-Openid') || ''),
  appid: String(event.__appid || ''),
});
mount('userData', handlers.userData, { deriveContext: deriveUserContext });
mount('login', handlers.login, { deriveContext: deriveUserContext });
mount('sendReminders', handlers.sendReminders, { deriveContext: deriveUserContext });

app.listen(PORT, () => {
  const counts = listCollections(db).map(row => `${row.collection}:${row.n}`).join(' ');
  console.log(`后端已启动 http://0.0.0.0:${PORT}`);
  console.log(`数据库 ${DB_FILE}`);
  console.log(`集合 ${counts || '（空）'}`);
});
