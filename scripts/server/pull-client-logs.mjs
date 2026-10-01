// 把小程序的访问异常记录从腾讯云开发上海拉回本地，后台“访问异常”页显示（2026-10-01 起）。
//
// 小程序在用户手机上出问题时，匿名上报到上海的 clientLog 云函数（走微信内网，美国服务器连不上时也能报）；
// 上海 publicData 每天还记一个成功加载次数。本脚本经 publicSync 的 pullClientLogs 取回，
// 再经后台 saveClientLogs 写进本地数据库。每 5 分钟由 systemd 定时跑（daily-contest-client-logs.timer）。
// 用法：node pull-client-logs.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(HERE, 'plans', 'client-logs-state.json');
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const STATS_DAYS = 40;

const readConfig = name => { try { return fs.readFileSync(path.join(HERE, name), 'utf8').trim(); } catch { return ''; } };

// 本页里哪些是新的（按上海的 _id 去重），以及下一次从哪儿接着拉
export function nextCursor(issues, since, seenIds = new Set()) {
  const fresh = issues.filter(item => item?._id && !seenIds.has(item._id));
  const last = issues.reduce((max, item) => (String(item?.received_at || '') > max ? String(item.received_at) : max), since);
  return { fresh, since:last };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const endpoint = readConfig('.sync-endpoint');
  const secret = readConfig('.sync-secret');
  const adminToken = readConfig('.admin-token');
  if (!endpoint || !secret || !adminToken) throw new Error('缺少 .sync-endpoint、.sync-secret 或 .admin-token');
  const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
  let since = state.since || '1970-01-01T00:00:00.000Z';
  const seen = new Set(state.lastIds || []);
  const statsFrom = new Date(Date.now() + 8 * 3600000 - STATS_DAYS * 86400000).toISOString().slice(0, 10);

  const pull = async () => {
    const response = await fetch(endpoint, { method:'POST', headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ action:'pullClientLogs', secret, since, statsFrom, limit:200 }), signal:AbortSignal.timeout(60000) });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(`上海拉取失败（HTTP ${response.status}）：${result?.status || ''} ${result?.error || ''}`.trim());
    return result;
  };
  const save = async body => {
    if (dryRun) return { savedIssues:body.issues.length, savedStats:body.stats.length };
    const response = await fetch(`${API_BASE}/api/adminData`, { method:'POST', headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ adminToken, action:'saveClientLogs', ...body }) });
    const result = await response.json();
    if (!result?.ok) throw new Error(`写本地失败：${result?.message || ''}`);
    return result.data;
  };

  let issuesSaved = 0;
  let statsSaved = 0;
  let lastIds = [...seen];
  for (let page = 0; page < 20; page += 1) {
    const result = await pull();
    const { fresh, since:nextSince } = nextCursor(result.issues || [], since, seen);
    const saved = await save({ issues:fresh, stats:page === 0 ? (result.stats || []) : [] });
    issuesSaved += saved.savedIssues || 0;
    statsSaved += saved.savedStats || 0;
    for (const item of fresh) seen.add(item._id);
    // 记住游标那一刻的 id，下次用“大于等于”拉时去重，不会漏掉同一时刻的记录
    lastIds = (result.issues || []).filter(item => item.received_at === nextSince).map(item => item._id);
    since = nextSince;
    if (!result.hasMore || !fresh.length) break;
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive:true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ since, lastIds, lastRunAt:new Date().toISOString() }, null, 1));
  }
  if (issuesSaved || dryRun) console.log(`${new Date().toISOString()} 访问异常：新记录 ${issuesSaved} 条，每日统计 ${statsSaved} 天${dryRun ? '（dry-run）' : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(`${new Date().toISOString()} ${error.message}`); process.exit(1); });
}
