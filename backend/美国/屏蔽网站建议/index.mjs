// 每周统计“建议屏蔽”的网站（2026-10-12 用户定；2026-11-02 搬自 scripts/server/site-block-suggest.mjs）。
// 每周一北京时间 09:00 由定时器跑 run.mjs（美国/定时/competition-radar-site-block.timer）。
//
// 看近 30 天每晚 01 搜到的候选，按网站统计出现次数，再看它们后面有没有用：
//   放行：到过 04 读详情（旧的“前置筛选判为去读详情”）
//   追溯成功：03 的 Codex 代理追踪从它的页面找到了官方来源（旧的“通知追溯 found_official”）
// 出现次数 ≥ MIN_REFS、却一次都没被放行或追溯成功的，列为建议屏蔽，写进比赛库的屏蔽网站状态，在后台“屏蔽网站”页确认后才生效。
// 不建议：已屏蔽（内置或已确认）、已忽略的；学校网站（edu.cn，学校转发要用来追溯）；库里赛事的来源网站。
// 和旧的不同：旧的读 runs/ 里的几个 JSON 文件，新的读每晚的 run.db；新的 01 不记“搜索时就筛掉的结果”，所以只统计候选。
//
//   buildSuggestions(几晚, { blocked, dismissed, protectedHosts, minRefs }) → 建议（纯函数）
//   sourceHosts(比赛库) → 库里赛事来源的网站
//   每周统计({ db, 根, 天数, minRefs, now, dryRun }) → { runs, suggestions, 写了, 已写 }
import { 屏蔽网站 } from '../db/index.mjs';
import { 读候选网站 } from '../pipeline/小数据库/index.mjs';

const { BUILTIN_BLOCKED, BUILTIN_HOSTS, isBlockedHost, normalizeHost } = 屏蔽网站;
export const WINDOW_DAYS = 30;
export const MIN_REFS = 15;

// 纯函数：runs 是 [{ id: 哪一晚, 候选们: [{ 网址, 名称, 读了详情, 追溯了, 追溯找到 }] }]；protectedHosts 是库里赛事来源的网站；blocked、dismissed 是已有名单
export function buildSuggestions(runs, { blocked = BUILTIN_HOSTS, dismissed = [], protectedHosts = new Set(), minRefs = MIN_REFS } = {}) {
  const stats = new Map();
  const of = host => {
    if (!stats.has(host)) stats.set(host, { host, refs:0, candidates:0, fetched:0, traced:0, traceFound:0, firstSeen:'', lastSeen:'', samples:[] });
    return stats.get(host);
  };
  const seen = (item, run, title, url) => {
    item.refs += 1;
    if (!item.firstSeen || run.id < item.firstSeen) item.firstSeen = run.id;
    if (!item.lastSeen || run.id > item.lastSeen) item.lastSeen = run.id;
    if (item.samples.length < 3 && title && !item.samples.some(sample => sample.title === title)) item.samples.push({ title:String(title).slice(0, 80), url });
  };
  for (const run of runs) {
    for (const candidate of run.候选们 || []) {
      const host = normalizeHost(candidate.网址);
      if (!host) continue;
      const item = of(host);
      seen(item, run, candidate.名称, candidate.网址);
      item.candidates += 1;
      if (candidate.读了详情) item.fetched += 1;
      if (candidate.追溯了) item.traced += 1;
      if (candidate.追溯找到) item.traceFound += 1;
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

function suggestionReason(item, runCount) {
  return `近 ${runCount} 晚出现 ${item.refs} 次，进入判重 ${item.candidates}；`
    + `没有一次被放行去读详情${item.traced ? `，交给通知追溯 ${item.traced} 次也没找到官方来源` : ''}`;
}

// 库里赛事的来源网站（官网、报名入口、来源网址）不建议屏蔽
export function sourceHosts(db) {
  const hosts = new Set();
  const urls = [
    ...db.find('competition', {}).map(c => c.website),
    ...db.find('edition', {}).map(e => e.registration_url),
    ...db.find('source', {}).map(s => s.url),
  ];
  for (const url of urls) {
    const host = normalizeHost(url);
    if (host) hosts.add(host);
  }
  return hosts;
}

export async function 每周统计({ db, 根, 天数 = WINDOW_DAYS, minRefs = MIN_REFS, now = () => new Date(), dryRun = false }) {
  const 现在 = now();
  const runs = 读候选网站({ 根, 天数, now: 现在 }).map(n => ({ id: n.名, 候选们: n.候选们 }));
  const state = 屏蔽网站.读状态(db);
  const blocked = [...BUILTIN_HOSTS, ...state.blocked.map(item => item.host)];
  const suggestions = buildSuggestions(runs, { blocked, dismissed: state.dismissed, protectedHosts: sourceHosts(db), minRefs });
  const report = { windowDays: 天数, minRefs, runs: runs.length, builtin: BUILTIN_BLOCKED, suggestions };
  if (dryRun) return { ...report, 写了: false };
  return { ...report, 写了: true, 已写: 屏蔽网站.写建议(db, report, { now }) };
}
