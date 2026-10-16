// 把公开赛事数据推到腾讯云开发上海环境（publicSync 云函数），小程序浏览赛事从那里读。
//
// 为什么：服务器在美国，国内手机跨境访问又慢（2~4 秒）又时常连不上——2026-10-01 测试用户
// 遇到 request:fail -118 ERR_CONNECTION_TIMED_OUT，请求根本没到服务器。上海那份走微信内网。
//
// 每 5 分钟由 systemd 定时跑（daily-contest-public-sync.timer）：
//   - 只推有变化的条目（按每条内容的哈希比对），没有变化就一个请求都不发；
//   - 服务器这边已下架、删除的，在上海也删掉；
//   - 每 24 小时整体重推、整体核对一次，防止两边慢慢走样。
// 用法：node sync-public-cache.mjs [--full] [--dry-run]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readSourceState, sourceStateFile, writeSourceState } from './sync-source-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.DB_FILE || path.join(HERE, 'server', 'data', 'app.db');
const COLLECTION = 'event_edition_public_cache';
// 腾讯云 HTTP 访问服务对请求体有上限（一批 40 条、约 80KB 时返回 413），按大小分批，每批不超过 50KB
const MAX_BATCH_BYTES = 50 * 1024;
const FULL_EVERY_MS = 24 * 60 * 60 * 1000;

// 跟上海 publicData 读取时的条件一致：只推可以公开的
export const isPublic = doc => ['published', 'archived'].includes(doc?.data_status)
  && doc.system_validation === 'passed' && doc.manual_review === 'passed';

// 按序列化后的大小把条目分批；单条超过上限的单独成一批（让上海那边报错，而不是悄悄丢掉）
export function batchBySize(docs, maxBytes = MAX_BATCH_BYTES, maxRecords = 100) {
  const batches = [];
  let current = [];
  let size = 0;
  for (const doc of docs) {
    const bytes = Buffer.byteLength(JSON.stringify(doc));
    if (current.length && (size + bytes > maxBytes || current.length >= maxRecords)) { batches.push(current); current = []; size = 0; }
    current.push(doc);
    size += bytes;
  }
  if (current.length) batches.push(current);
  return batches;
}

export const hashOf = doc => crypto.createHash('sha256').update(JSON.stringify(doc)).digest('hex').slice(0, 16);

// 比对本地公开数据和上次推送的记录，决定这次推哪些、删哪些
export function planSync(docs, state = {}, { full = false, now = Date.now() } = {}) {
  const previous = state.hashes || {};
  const fullDue = full || !state.lastFullAt || now - Date.parse(state.lastFullAt) > FULL_EVERY_MS;
  const current = {};
  const upserts = [];
  for (const doc of docs) {
    current[doc.id] = hashOf(doc);
    if (fullDue || previous[doc.id] !== current[doc.id]) upserts.push(doc);
  }
  const removed = Object.keys(previous).filter(id => !(id in current));
  return { upserts, removed, prune:fullDue || removed.length > 0, fullDue, hashes:current, keepIds:Object.keys(current) };
}

function readConfig(name) {
  try { return fs.readFileSync(path.join(HERE, name), 'utf8').trim(); } catch { return ''; }
}

function loadPublicDocs() {
  const require = createRequire(import.meta.url);
  const Database = require(path.join(HERE, 'server', 'node_modules', 'better-sqlite3'));
  const db = new Database(DB_FILE, { readonly:true, fileMustExist:true });
  try {
    return db.prepare('select id, data from documents where collection = ?').all(COLLECTION)
      .map(row => ({ ...JSON.parse(row.data), id:row.id }))
      .filter(isPublic);
  } finally {
    db.close();
  }
}

async function callSync(endpoint, secret, body) {
  const response = await fetch(endpoint, {
    method:'POST', headers:{ 'content-type':'application/json' },
    body:JSON.stringify({ ...body, secret }), signal:AbortSignal.timeout(60000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(`目标同步失败（HTTP ${response.status}）：${result?.status || ''} ${result?.error || ''}`.trim());
  return result;
}

async function main() {
  const args = { full:process.argv.includes('--full'), dryRun:process.argv.includes('--dry-run') };
  const endpoint = readConfig('.sync-endpoint');
  const secret = readConfig('.sync-secret');
  if (!endpoint || !secret) throw new Error('缺少 .sync-endpoint 或 .sync-secret');

  const docs = loadPublicDocs();
  // 防误删：本地一条公开数据都读不到，多半是数据库出问题，不能拿空列表去把上海清空
  if (!docs.length) throw new Error('本地公开数据为 0 条，疑似读库出错，本次不同步');
  const stateFile = sourceStateFile(path.join(HERE, 'plans'), 'public-sync', endpoint);
  const state = readSourceState(stateFile, endpoint);
  const plan = planSync(docs, state, { full:args.full });
  const stamp = new Date().toISOString();
  if (!plan.upserts.length && !plan.prune) { console.log(`${stamp} 公开数据 ${docs.length} 条，无变化`); return; }
  if (args.dryRun) { console.log(`${stamp} [dry-run] 要推 ${plan.upserts.length} 条，删 ${plan.removed.length} 条，整体核对：${plan.prune}`); return; }

  let saved = 0;
  for (const batch of batchBySize(plan.upserts)) {
    const result = await callSync(endpoint, secret, { action:'upsert', records:batch });
    if (result.saved !== batch.length) throw new Error('公开缓存写入数量不一致，拒绝更新同步状态');
    saved += result.saved;
  }
  let removed = 0;
  if (plan.prune) removed = (await callSync(endpoint, secret, { action:'prune', keepIds:plan.keepIds })).removed || 0;

  writeSourceState(stateFile, endpoint, { hashes:plan.hashes, lastSyncAt:stamp, lastFullAt:plan.fullDue ? stamp : state.lastFullAt });
  console.log(`${stamp} 公开数据 ${docs.length} 条：推送 ${saved} 条，目标删除 ${removed} 条${plan.fullDue ? '（整体核对）' : ''}`);
}

// 让上海的 publicData 保持运行（2026-10-01）：云开发自己的定时触发器在这个环境不执行，
// 所以借这个每 5 分钟跑一次的同步顺便调一下。同步成功与否都调；失败只记一行，不影响同步结果。
export function warmEndpoint(syncEndpoint) {
  return String(syncEndpoint || '').replace(/\/public-sync\/?$/, '/public-data');
}
async function warmShanghai() {
  const url = warmEndpoint(readConfig('.sync-endpoint'));
  if (!/\/public-data$/.test(url)) return;
  try {
    const response = await fetch(url, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ action:'warm' }), signal:AbortSignal.timeout(20000) });
    const result = await response.json().catch(() => ({}));
    if (!result.ok) console.error(`${new Date().toISOString()} 上海 publicData 保持运行失败：HTTP ${response.status} ${JSON.stringify(result).slice(0, 120)}`);
  } catch (error) {
    console.error(`${new Date().toISOString()} 上海 publicData 保持运行失败：${String(error?.message || error).slice(0, 120)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(`${new Date().toISOString()} ${error.message}`); process.exitCode = 1; })
    .finally(() => (process.argv.includes('--dry-run') ? undefined : warmShanghai()));
}
