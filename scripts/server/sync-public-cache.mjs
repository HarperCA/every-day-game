// 把公开赛事数据推到腾讯云开发上海环境（publicSync 云函数），小程序浏览赛事从那里读。
//
// 为什么：服务器在美国，国内手机跨境访问又慢（2~4 秒）又时常连不上——2026-10-01 测试用户
// 遇到 request:fail -118 ERR_CONNECTION_TIMED_OUT，请求根本没到服务器。上海那份走微信内网。
//
// 每 5 分钟由 systemd 定时跑（daily-contest-public-sync.timer）：
//   - 只推有变化的条目（按每条内容的哈希比对），没有变化就一个请求都不发；
//   - 服务器这边已下架、删除的，在上海也删掉；
//   - 每 24 小时整体重推、整体核对一次，防止两边慢慢走样。
//   - 海报（2026-10-24）：公开数据里带 poster_file（图片总库里的文件名）的，先把还没推过的海报一张一请求推到上海云存储，
//     换回 https 链接，以 poster_url 写进推给上海的数据；不再被用到的海报，在上海也删掉。
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
// 图片总库：后台上传的海报存在这里（adminData/posterImage.js 的 posterDir，两边要一致）
const POSTER_DIR = process.env.POSTER_DIR || path.join(HERE, 'server', 'data', 'posters');
const POSTER_FILE = /^[0-9a-f]{64}\.jpg$/;

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

// 海报：哪些要推上去、哪些已经不用了。posters = { 文件名: { fileID, url } }，存在同步状态里
export function planPosters(docs, posters = {}) {
  const wanted = new Set(docs.map(doc => doc.poster_file).filter(file => typeof file === 'string' && POSTER_FILE.test(file)));
  return {
    upload:[...wanted].filter(file => !posters[file]?.fileID),
    stale:Object.keys(posters).filter(file => !wanted.has(file)),
  };
}

// 推给上海的数据带上海报的云存储文件 ID；上海 publicData 返回列表时再换成 10 分钟有效的链接（2026-10-24 用户定：不升级套餐，存储是私有的）。
// 还没推成功的海报先不带，小程序显示文字封面，下次同步再补
export function withPosterUrls(docs, posters = {}) {
  return docs.map(doc => ({ ...doc, poster_file_id:(POSTER_FILE.test(doc.poster_file || '') && posters[doc.poster_file]?.fileID) || '' }));
}

async function syncPosters(endpoint, secret, docs, posters) {
  const plan = planPosters(docs, posters);
  const next = { ...posters };
  let uploaded = 0;
  for (const file of plan.upload) {
    try {
      const data = fs.readFileSync(path.join(POSTER_DIR, file)).toString('base64');
      const result = await callSync(endpoint, secret, { action:'uploadPoster', file, data });
      next[file] = { fileID:result.fileID, url:result.url };
      uploaded += 1;
    } catch (error) {
      // 一张失败不影响比赛数据同步，这张下次再试
      console.error(`${new Date().toISOString()} 海报 ${file} 推送失败：${String(error?.message || error).slice(0, 160)}`);
    }
  }
  return { posters:next, uploaded, stale:plan.stale };
}

async function deleteStalePosters(endpoint, secret, posters, stale) {
  const next = { ...posters };
  let removed = 0;
  for (let index = 0; index < stale.length; index += 50) {
    const files = stale.slice(index, index + 50);
    const fileIDs = files.map(file => posters[file]?.fileID).filter(Boolean);
    try {
      if (fileIDs.length) removed += (await callSync(endpoint, secret, { action:'deletePosters', fileIDs })).removed || 0;
      for (const file of files) delete next[file];
    } catch (error) {
      console.error(`${new Date().toISOString()} 删除旧海报失败：${String(error?.message || error).slice(0, 160)}`);
    }
  }
  return { posters:next, removed };
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

  const localDocs = loadPublicDocs();
  // 防误删：本地一条公开数据都读不到，多半是数据库出问题，不能拿空列表去把上海清空
  if (!localDocs.length) throw new Error('本地公开数据为 0 条，疑似读库出错，本次不同步');
  const stateFile = sourceStateFile(path.join(HERE, 'plans'), 'public-sync', endpoint);
  const state = readSourceState(stateFile, endpoint);
  const stamp = new Date().toISOString();
  if (args.dryRun) {
    const posterPlan = planPosters(localDocs, state.posters);
    const plan = planSync(withPosterUrls(localDocs, state.posters), state, { full:args.full });
    console.log(`${stamp} [dry-run] 要推 ${plan.upserts.length} 条，删 ${plan.removed.length} 条，整体核对：${plan.prune}；海报要推 ${posterPlan.upload.length} 张，要删 ${posterPlan.stale.length} 张`);
    return;
  }
  // 先推海报，拿到链接再算哪些比赛数据有变化（链接变了也算变化）
  const posterSync = await syncPosters(endpoint, secret, localDocs, state.posters || {});
  const docs = withPosterUrls(localDocs, posterSync.posters);
  const plan = planSync(docs, state, { full:args.full });
  if (!plan.upserts.length && !plan.prune && !posterSync.uploaded && !posterSync.stale.length) { console.log(`${stamp} 公开数据 ${docs.length} 条，无变化`); return; }

  let saved = 0;
  for (const batch of batchBySize(plan.upserts)) {
    const result = await callSync(endpoint, secret, { action:'upsert', records:batch });
    if (result.saved !== batch.length) throw new Error('公开缓存写入数量不一致，拒绝更新同步状态');
    saved += result.saved;
  }
  let removed = 0;
  if (plan.prune) removed = (await callSync(endpoint, secret, { action:'prune', keepIds:plan.keepIds })).removed || 0;
  // 比赛数据已经换成新海报以后，再删上海不再用的旧海报
  const posterClean = await deleteStalePosters(endpoint, secret, posterSync.posters, posterSync.stale);

  writeSourceState(stateFile, endpoint, { hashes:plan.hashes, posters:posterClean.posters, lastSyncAt:stamp, lastFullAt:plan.fullDue ? stamp : state.lastFullAt });
  console.log(`${stamp} 公开数据 ${docs.length} 条：推送 ${saved} 条，目标删除 ${removed} 条${plan.fullDue ? '（整体核对）' : ''}；海报推送 ${posterSync.uploaded} 张，删除 ${posterClean.removed} 张`);
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
