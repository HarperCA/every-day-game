// 每周统计“建议屏蔽”的网站（2026-10-12，用户定），每周一北京时间 09:00 由 daily-contest-site-block.timer 运行。
//
// 看近 30 天每晚的百度搜索结果（runs/<编号>/baidu-candidates.json），按网站统计出现次数，再看它们后面有没有用：
//   放行：前置筛选判为“去读详情”（jev-filter-report.json 的 action=fetch）
//   追溯成功：通知追溯代理从它的页面找到了官方来源（notice-resolution-leads.json 的 found_official）
// 出现次数 ≥ MIN_REFS、却一次都没被放行或追溯成功的，列为建议屏蔽，写进后台（saveSiteBlockSuggestions），在“屏蔽网站”页确认后才生效。
// 不建议：已屏蔽（内置或已确认）、已忽略的；学校网站（edu.cn，学校转发要用来追溯）；库里赛事的来源网站。
//
// 用法：node site-block-suggest.mjs [--days 30] [--min-refs 15] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_BLOCKED, BUILTIN_HOSTS, isBlockedHost, normalizeHost } from './site-blocklist.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WINDOW_DAYS = 30;
export const MIN_REFS = 15;

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const runTime = name => Date.parse(String(name).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z'));

// 读近 days 天的运行目录（重跑的 --from-run 不算，免得同一批结果算两次）
export function loadRuns(runsDir, { days = WINDOW_DAYS, now = new Date() } = {}) {
  if (!fs.existsSync(runsDir)) return [];
  const since = now.getTime() - days * 86400000;
  return fs.readdirSync(runsDir)
    .filter(name => /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(name) && runTime(name) >= since)
    .filter(name => !fs.existsSync(path.join(runsDir, name, 'replay.json')))
    .map(name => {
      const dir = path.join(runsDir, name);
      return { id:name, baidu:readJson(path.join(dir, 'baidu-candidates.json')), jev:readJson(path.join(dir, 'jev-filter-report.json')),
        notices:readJson(path.join(dir, 'notice-resolution-leads.json')) };
    })
    .filter(run => run.baidu);
}

// 纯函数：runs 见 loadRuns；protectedHosts 是库里赛事来源的网站；blocked、dismissed 是已有名单
export function buildSuggestions(runs, { blocked = BUILTIN_HOSTS, dismissed = [], protectedHosts = new Set(), minRefs = MIN_REFS } = {}) {
  const stats = new Map();
  const of = host => {
    if (!stats.has(host)) stats.set(host, { host, refs:0, candidates:0, dropped:0, droppedReasons:{}, fetched:0, traced:0, traceFound:0, firstSeen:'', lastSeen:'', samples:[] });
    return stats.get(host);
  };
  const seen = (item, run, title, url) => {
    item.refs += 1;
    if (!item.firstSeen || run.id < item.firstSeen) item.firstSeen = run.id;
    if (!item.lastSeen || run.id > item.lastSeen) item.lastSeen = run.id;
    if (item.samples.length < 3 && title && !item.samples.some(sample => sample.title === title)) item.samples.push({ title:String(title).slice(0, 80), url });
  };
  for (const run of runs) {
    for (const entry of run.baidu.dropped || []) {
      const host = normalizeHost(entry.url);
      if (!host) continue;
      const item = of(host);
      seen(item, run, entry.title, entry.url);
      item.dropped += 1;
      item.droppedReasons[entry.reason || 'unknown'] = (item.droppedReasons[entry.reason || 'unknown'] || 0) + 1;
    }
    for (const candidate of run.baidu.candidates || []) {
      const host = normalizeHost(candidate.detailUrl);
      if (!host) continue;
      const item = of(host);
      seen(item, run, candidate.name, candidate.detailUrl);
      item.candidates += 1;
    }
    for (const decision of run.jev?.decisions || []) {
      const host = normalizeHost(decision.url);
      if (!host || !stats.has(host)) continue;
      if (decision.action === 'fetch') stats.get(host).fetched += 1;
      if (decision.action === 'trace') stats.get(host).traced += 1;
    }
    for (const result of run.notices?.results || []) {
      const host = normalizeHost(result.noticeUrl);
      if (host && stats.has(host) && result.agent?.outcome === 'found_official') stats.get(host).traceFound += 1;
    }
  }
  const skip = new Set(dismissed.map(item => normalizeHost(typeof item === 'string' ? item : item?.host)));
  return [...stats.values()]
    .filter(item => item.refs >= minRefs && item.fetched === 0 && item.traceFound === 0)
    .filter(item => !isBlockedHost(item.host, blocked) && !skip.has(item.host))
    .filter(item => !/(^|\.)edu\.cn$/.test(item.host) && !protectedHosts.has(item.host))
    .sort((a, b) => b.refs - a.refs)
    .map(item => ({ ...item, reason:suggestionReason(item, runs.length) }));
}

const REASON_TEXT = { irrelevant:'不含“赛”字', out_of_scope:'不在收录范围', known_source:'已有抓取器的平台', duplicate:'同轮重复' };
function suggestionReason(item, runCount) {
  const reasons = Object.entries(item.droppedReasons).sort((a, b) => b[1] - a[1]).map(([key, count]) => `${REASON_TEXT[key] || key} ${count}`).join('、');
  return `近 ${runCount} 晚出现 ${item.refs} 次：搜索时筛掉 ${item.dropped}${reasons ? `（${reasons}）` : ''}，进入判重 ${item.candidates}；`
    + `没有一次被放行去读详情${item.traced ? `，交给通知追溯 ${item.traced} 次也没找到官方来源` : ''}`;
}

// 库里赛事的来源网站（官网、通知、报名入口）不建议屏蔽
export function sourceHosts(records = []) {
  const hosts = new Set();
  for (const record of records) {
    for (const url of [record.registrationUrl, record.website, ...(record.sources || []).map(source => source?.url)]) {
      const host = normalizeHost(url);
      if (host) hosts.add(host);
    }
  }
  return hosts;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) || fallback : fallback; };
  const days = opt('days', WINDOW_DAYS);
  const minRefs = opt('min-refs', MIN_REFS);
  const dryRun = args.includes('--dry-run');
  const token = fs.readFileSync(path.join(HERE, '.admin-token'), 'utf8').trim();
  const call = async (action, payload = {}) => {
    const response = await fetch(`${process.env.API_BASE || 'http://127.0.0.1:8787'}/api/adminData`, {
      method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, action, ...payload }),
    });
    const result = await response.json();
    if (!result?.ok) throw new Error(`${action} 失败：${result?.message || response.status}`);
    return result.data;
  };
  const [state, snapshot] = await Promise.all([call('siteBlocklist'), call('bootstrap')]);
  const runs = loadRuns(path.join(HERE, 'runs'), { days });
  const blocked = [...BUILTIN_HOSTS, ...(state.blocked || []).map(item => item.host)];
  const suggestions = buildSuggestions(runs, { blocked, dismissed:state.dismissed || [], protectedHosts:sourceHosts(snapshot.records || []), minRefs });
  console.log(`近 ${days} 天 ${runs.length} 晚的百度结果：建议屏蔽 ${suggestions.length} 个网站（出现 ≥ ${minRefs} 次且从没被放行或追溯成功）`);
  for (const item of suggestions) console.log(`  ${String(item.refs).padStart(4)}  ${item.host}  ${item.reason}`);
  const report = { generatedAt:new Date().toISOString(), windowDays:days, minRefs, runs:runs.length, builtin:BUILTIN_BLOCKED, suggestions };
  fs.mkdirSync(path.join(HERE, 'reports'), { recursive:true });
  fs.writeFileSync(path.join(HERE, 'reports', `site-block-suggestions-${report.generatedAt.slice(0, 10)}.json`), JSON.stringify(report, null, 2));
  if (dryRun) { console.log('--dry-run：没有写进后台'); return; }
  const saved = await call('saveSiteBlockSuggestions', report);
  console.log(`已写进后台：建议 ${saved.suggestions} 个，已确认屏蔽 ${saved.blocked} 个`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error('统计建议屏蔽网站失败：', error.message); process.exit(1); });
}
