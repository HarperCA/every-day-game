// 把小程序的访问异常记录从腾讯云开发上海拉回本地，后台“访问异常”页显示（2026-10-01 起）。
//
// 小程序在用户手机上出问题时，匿名上报到上海的 clientLog 云函数（走微信内网，美国服务器连不上时也能报）；
// 上海 publicData 每天还记一个成功加载次数。本脚本经 publicSync 的 pullClientLogs 取回，
// 再经后台 saveClientLogs 写进本地数据库。每 5 分钟由 systemd 定时跑（daily-contest-client-logs.timer）。
// 用法：node pull-client-logs.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSourceState, sourceStateFile, writeSourceState } from './sync-source-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const STATS_DAYS = 40;

const readConfig = name => { try { return fs.readFileSync(path.join(HERE, name), 'utf8').trim(); } catch { return ''; } };

// 本页里哪些是新的（按上海的 _id 去重），以及下一次从哪儿接着拉
export function nextCursor(issues, since, seenIds = new Set()) {
  const fresh = issues.filter(item => item?._id && !seenIds.has(item._id));
  const last = issues.reduce((max, item) => (String(item?.received_at || '') > max ? String(item.received_at) : max), since);
  return { fresh, since:last };
}

// A completed scan rereads the boundary window: a concurrent insert can have the
// same timestamp but a smaller random ID. Saved logs are idempotent by source _id.
// An unfinished 20-page scan must resume strictly, otherwise a large tie group stalls.
export function resumeLogCursor(state = {}) {
  const cursor = state.cursor || { at:state.since || '1970-01-01T00:00:00.000Z', id:'' };
  if (state.hasMore === true || !state.cursor) return cursor;
  return { at:new Date(Math.max(0, Date.parse(cursor.at) - 5 * 60000)).toISOString(), id:'' };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const endpoint = readConfig('.sync-endpoint');
  const secret = readConfig('.sync-secret');
  const adminToken = readConfig('.admin-token');
  if (!endpoint || !secret || !adminToken) throw new Error('缺少 .sync-endpoint、.sync-secret 或 .admin-token');
  const stateFile = sourceStateFile(path.join(HERE, 'plans'), 'client-logs', endpoint);
  const state = readSourceState(stateFile, endpoint);
  let since = state.since || '1970-01-01T00:00:00.000Z';
  let cursor = resumeLogCursor(state);
  const seen = new Set(state.lastIds || []);
  const statsFrom = new Date(Date.now() + 8 * 3600000 - STATS_DAYS * 86400000).toISOString().slice(0, 10);

  const pull = async () => {
    const response = await fetch(endpoint, { method:'POST', headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ action:'pullClientLogs', secret, since, cursor, statsFrom, limit:200 }), signal:AbortSignal.timeout(60000) });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(`同步源拉取失败（HTTP ${response.status}）：${result?.status || ''} ${result?.error || ''}`.trim());
    if (result.cursorVersion !== 2 || !result.nextCursor) throw new Error('同步源未支持稳定分页，拒绝推进日志游标');
    return result;
  };
  const save = async body => {
    if (dryRun) return { savedIssues:body.issues.length, savedStats:body.stats.length };
    const response = await fetch(`${API_BASE}/api/adminData`, { method:'POST', headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ adminToken, action:'saveClientLogs', ...body }), signal:AbortSignal.timeout(60000) });
    const result = await response.json();
    if (!response.ok || !result?.ok) throw new Error(`写本地失败：${result?.message || ''}`);
    return result.data;
  };

  let issuesSaved = 0;
  let statsSaved = 0;
  let lastIds = [...seen];
  for (let page = 0; page < 20; page += 1) {
    const result = await pull();
    const next = result.nextCursor;
    if (!next || typeof next.at !== 'string' || typeof next.id !== 'string'
      || next.at < cursor.at || (next.at === cursor.at && next.id < cursor.id)
      || (result.hasMore && next.at === cursor.at && next.id === cursor.id)) throw new Error('日志分页游标未前进');
    const { fresh, since:nextSince } = nextCursor(result.issues || [], since, seen);
    const saved = await save({ issues:fresh, stats:page === 0 ? (result.stats || []) : [] });
    if (saved.savedIssues !== fresh.length || saved.savedStats !== (page === 0 ? (result.stats || []).length : 0)) throw new Error('日志/统计写入数量不一致，拒绝推进游标');
    issuesSaved += saved.savedIssues || 0;
    statsSaved += saved.savedStats || 0;
    for (const item of fresh) seen.add(item._id);
    // 记住游标那一刻的 id，下次用“大于等于”拉时去重，不会漏掉同一时刻的记录
    lastIds = (result.issues || []).filter(item => item.received_at === nextSince).map(item => item._id);
    since = nextSince;
    cursor = next;
    if (!dryRun) writeSourceState(stateFile, endpoint, { since, cursor, hasMore:result.hasMore, lastIds, lastRunAt:new Date().toISOString() });
    if (!result.hasMore) break;
  }
  // 偏好问卷统计（2026-10-09 起）：上海只回计数，覆盖成一份快照；失败不影响访问异常这部分
  try {
    const response = await fetch(endpoint, { method:'POST', headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ action:'pullPreferenceStats', secret }), signal:AbortSignal.timeout(60000) });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(`HTTP ${response.status} ${result?.status || ''} ${result?.error || ''}`.trim());
    if (!dryRun) {
      const saved = await fetch(`${API_BASE}/api/adminData`, { method:'POST', headers:{ 'content-type':'application/json' },
        body:JSON.stringify({ adminToken, action:'savePreferenceStats', stats:result.stats }), signal:AbortSignal.timeout(60000) }).then(r => r.json());
      if (!saved?.ok) throw new Error(`写本地失败：${saved?.message || ''}`);
    }
  } catch (error) {
    // 上海 publicSync 还没部署新版本时会回 unsupported_action，等部署后自然恢复
    console.error(`${new Date().toISOString()} 问卷统计拉取失败：${String(error.message || error).slice(0, 200)}`);
  }
  if (issuesSaved || dryRun) console.log(`${new Date().toISOString()} 访问异常：幂等写入/核对 ${issuesSaved} 条，每日统计 ${statsSaved} 天${dryRun ? '（dry-run）' : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(`${new Date().toISOString()} ${error.message}`); process.exit(1); });
}
