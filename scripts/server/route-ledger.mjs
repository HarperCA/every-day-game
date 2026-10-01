// 路线台账：按“路线”和“查询词”统计最近一段时间的搜索投入与合格新增，给次日搜索计划用。
//
// 合格新增（2026-09-24 用户确定）：最终进入已发布或已归档的新赛事。
// 其中报名中、即将报名的计 2 分，时间待公布、已截止的计 1 分。
// 待审、草稿单独列出不计分；隔离、下架计为未通过。
// 只统计带来源链（discovery）的记录，也就是 2026-09-24 之后新抓入库的；老记录不追溯来源。
//
// 投入：runs/*/baidu-candidates.json 里每条查询算 1 次调用（失败的不算），
//       runs/*/notice-resolution-leads.json 里每条追溯算 1 次调用，属于“追溯线索与主办方监测”路线；
//       plans/trace-drafts-*.json 里每条实际搜索的记录追溯也算 1 次，同属追溯路线。
// 产出：被追溯过（task.firstAttemptAt 在窗口内）的老记录也计入追溯路线，看追溯能不能把草稿推到发布。
//
// 用法：node route-ledger.mjs [--days 28] [--out reports/route-ledger-YYYY-MM-DD.json]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ROUTES, ROUTE_SHARE } from './discovery.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUALIFIED = new Set(['published', 'archived']);
const PENDING = new Set(['draft', 'pending_system_validation', 'pending_manual_review', 'reviewing']);
const OPEN_STATUSES = new Set(['报名中', '即将报名']);
const NO_ROUTE = '未标路线';

// 运行目录名是 ISO 时间把 : 和 . 换成 -，还原成可解析的时间。
export function runDirTime(name) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(name);
  return match ? Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`) : NaN;
}

const emptyBucket = (route, query) => ({ route, query, calls:0, discovered:0, qualified:0, qualifiedOpen:0, score:0, pending:0, failed:0 });

// runs: [{ time, baidu:{ perQuery, failures }, noticeLeads:{ results } }]
export function buildRouteLedger(records, runs, { now = new Date(), days = 28, registrationStatus } = {}) {
  const since = now.getTime() - days * 86400000;
  const byRoute = new Map(Object.values(ROUTES).map(route => [route, emptyBucket(route, null)]));
  const byQuery = new Map();
  const add = (route, query, apply) => {
    const r = route || NO_ROUTE;
    if (!byRoute.has(r)) byRoute.set(r, emptyBucket(r, null));
    apply(byRoute.get(r));
    if (!query) return;
    const key = JSON.stringify([r, query]);
    if (!byQuery.has(key)) byQuery.set(key, emptyBucket(r, query));
    apply(byQuery.get(key));
  };

  for (const run of runs) {
    if (!(run.time >= since)) continue;
    const failed = new Set((run.baidu?.failures || []).map(item => item.query));
    for (const item of run.baidu?.perQuery || []) {
      if (failed.has(item.query)) continue;
      add(item.route || ROUTES.gap, item.query, b => { b.calls += 1; });
    }
    for (const item of run.noticeLeads?.results || []) {
      if (item.error) continue;
      add(ROUTES.trace, item.followupQuery || null, b => { b.calls += 1; });
    }
    for (const item of run.traceDrafts?.results || []) {
      if (item.skipped || item.error) continue;
      add(ROUTES.trace, item.query || null, b => { b.calls += 1; });
    }
  }

  for (const record of records) {
    const traced = !record.discovery && record.task?.firstAttemptAt;
    const d = record.discovery || (traced ? { route:ROUTES.trace, query:record.task.lastQuery } : null);
    if (!d) continue;
    const seen = Date.parse((traced ? record.task.firstAttemptAt : record.firstSeenAt) || '');
    if (!(seen >= since)) continue;
    const status = record.dataStatus;
    let open = false;
    if (QUALIFIED.has(status)) {
      try { open = OPEN_STATUSES.has(registrationStatus(record, now)); } catch { open = false; }
    }
    add(d.route, d.query || null, b => {
      b.discovered += 1;
      if (QUALIFIED.has(status)) { b.qualified += 1; b.score += open ? 2 : 1; if (open) b.qualifiedOpen += 1; }
      else if (PENDING.has(status)) b.pending += 1;
      else b.failed += 1;
    });
  }

  const finish = b => ({ ...b, scorePerCall:b.calls ? Number((b.score / b.calls).toFixed(3)) : null });
  const metrics = buildMetrics(records, runs, { now, since });
  return {
    generatedAt:now.toISOString(), windowDays:days,
    definition:'合格新增＝最终已发布或已归档；报名中、即将报名计 2 分，其余计 1 分；待审不计分',
    routeShare:ROUTE_SHARE,
    routes:[...byRoute.values()].map(finish),
    metrics,
    queries:[...byQuery.values()].map(finish).sort((a, b) => (b.score - a.score) || (a.calls - b.calls)),
  };
}

const days = ms => Number((ms / 86400000).toFixed(1));
const median = list => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };

// 方案里的三个衡量指标：草稿转为真实发布多少条、平均卡多久、每条发布花多少调用与费用。
// 窗口内首次发现（或首次追溯）的记录为分母；发布耗时用 publishedAt − firstSeenAt；
// 费用只合计有记录的 Jev 前置筛选费用，详情抽取费用各轮没有落盘，记为 null，不估算。
// 按来源分开：人工按原文整理的记录发布快、不花搜索，混在一起会把搜索的效率算得虚高。
export function originOf(record) {
  if (record.discovery) return '自动发现';
  if (record.task?.firstAttemptAt) return '记录追溯';
  if (record.curationBatch || record.verifiedBy) return '人工整理';
  return '早期记录（无来源链）';
}
const AUTOMATED = new Set(['自动发现', '记录追溯']);

export function buildMetrics(records, runs, { now, since }) {
  const entered = records.filter(record => {
    const start = Date.parse(record.task?.firstAttemptAt || record.firstSeenAt || '');
    return start >= since;
  });
  const qualified = entered.filter(record => QUALIFIED.has(record.dataStatus));
  const byOrigin = {};
  for (const record of entered) {
    const origin = originOf(record);
    const bucket = byOrigin[origin] ||= { entered:0, qualified:0, publishDays:[] };
    bucket.entered += 1;
    if (QUALIFIED.has(record.dataStatus)) bucket.qualified += 1;
    const published = Date.parse(record.publishedAt || '');
    const start = Date.parse(record.task?.firstAttemptAt || record.firstSeenAt || '');
    if (published >= start) bucket.publishDays.push(published - start);
  }
  const automatedQualified = qualified.filter(record => AUTOMATED.has(originOf(record))).length;
  const stuck = records.filter(record => PENDING.has(record.dataStatus) && Date.parse(record.firstSeenAt || ''))
    .map(record => now.getTime() - Date.parse(record.firstSeenAt));
  const toPublish = records.filter(record => Date.parse(record.publishedAt || '') >= since && Date.parse(record.firstSeenAt || ''))
    .map(record => Date.parse(record.publishedAt) - Date.parse(record.firstSeenAt)).filter(ms => ms >= 0);
  let calls = 0;
  let jevUsd = 0;
  let jevRecorded = false;
  for (const run of runs) {
    if (!(run.time >= since)) continue;
    const failed = new Set((run.baidu?.failures || []).map(item => item.query));
    calls += (run.baidu?.perQuery || []).filter(item => !failed.has(item.query)).length;
    calls += (run.noticeLeads?.results || []).filter(item => !item.error).length;
    calls += (run.traceDrafts?.results || []).filter(item => !item.skipped && !item.error).length;
    for (const cost of [run.jev?.costUsd, run.noticeFollowupJev?.costUsd]) {
      if (Number.isFinite(cost)) { jevUsd += cost; jevRecorded = true; }
    }
  }
  return {
    byOrigin:Object.fromEntries(Object.entries(byOrigin).map(([origin, b]) => [origin, {
      entered:b.entered, qualified:b.qualified, conversion:Number((b.qualified / b.entered).toFixed(3)),
      publishDaysMedian:b.publishDays.length ? days(median(b.publishDays)) : null,
    }])),
    entered:entered.length, qualified:qualified.length,
    conversion:entered.length ? Number((qualified.length / entered.length).toFixed(3)) : null,
    pendingNow:stuck.length, pendingDaysAverage:stuck.length ? days(stuck.reduce((a, b) => a + b, 0) / stuck.length) : null,
    pendingDaysMedian:stuck.length ? days(median(stuck)) : null,
    publishDaysMedian:toPublish.length ? days(median(toPublish)) : null, publishedInWindow:toPublish.length,
    // 只用自动发现与记录追溯的合格数做分母；人工整理不花搜索。
    searchCalls:calls, automatedQualified, searchCallsPerQualified:automatedQualified ? Number((calls / automatedQualified).toFixed(1)) : null,
    jevUsd:jevRecorded ? Number(jevUsd.toFixed(6)) : null, extractionUsd:null,
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function loadRuns(runsDir, plansDir = null) {
  // 重跑的轮次（有 replay.json）不算：它用的是原来那一轮的搜索结果，算进去会重复计数
  const runs = !fs.existsSync(runsDir) ? [] : fs.readdirSync(runsDir).filter(name => !fs.existsSync(path.join(runsDir, name, 'replay.json'))).map(name => ({
    time:runDirTime(name),
    baidu:readJson(path.join(runsDir, name, 'baidu-candidates.json')),
    noticeLeads:readJson(path.join(runsDir, name, 'notice-resolution-leads.json')),
    jev:readJson(path.join(runsDir, name, 'jev-filter-report.json')),
    noticeFollowupJev:readJson(path.join(runsDir, name, 'notice-followup-filter-report.json')),
  })).filter(run => Number.isFinite(run.time));
  const traces = !plansDir || !fs.existsSync(plansDir) ? [] : fs.readdirSync(plansDir)
    .filter(name => /^trace-drafts-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map(name => readJson(path.join(plansDir, name)))
    .filter(Boolean)
    .map(report => ({ time:Date.parse(report.at), traceDrafts:report }));
  return [...runs, ...traces];
}

async function main() {
  const argv = process.argv.slice(2);
  const days = Number(argv[argv.indexOf('--days') + 1]) || 28;
  const now = new Date();
  const out = argv.includes('--out') ? path.resolve(argv[argv.indexOf('--out') + 1])
    : path.join(HERE, 'reports', `route-ledger-${now.toISOString().slice(0, 10)}.json`);
  const require = createRequire(import.meta.url);
  const { registrationStatus } = require(path.join(HERE, 'cjs', 'publicCache.js'));
  const token = fs.readFileSync(path.join(HERE, '.admin-token'), 'utf8').trim();
  const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, action:'bootstrap' }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'bootstrap_failed');
  const ledger = buildRouteLedger(result.data.records, loadRuns(path.join(HERE, 'runs'), path.join(HERE, 'plans')), { now, days, registrationStatus });
  fs.mkdirSync(path.dirname(out), { recursive:true });
  fs.writeFileSync(out, JSON.stringify(ledger, null, 2));
  for (const r of ledger.routes) console.log(`${r.route}：调用 ${r.calls}｜发现 ${r.discovered}｜合格 ${r.qualified}（报名中/即将 ${r.qualifiedOpen}）｜待审 ${r.pending}｜未通过 ${r.failed}｜每次调用得分 ${r.scorePerCall ?? '-'}`);
  const m = ledger.metrics;
  console.log(`指标：待办 ${m.pendingNow} 条，平均已卡 ${m.pendingDaysAverage ?? '-'} 天（中位 ${m.pendingDaysMedian ?? '-'}）｜搜索 ${m.searchCalls} 次，自动来源合格 ${m.automatedQualified} 条，每条 ${m.searchCallsPerQualified ?? '-'} 次｜Jev $${m.jevUsd ?? '-'}`);
  for (const [origin, b] of Object.entries(m.byOrigin)) console.log(`  ${origin}：进入 ${b.entered}，合格 ${b.qualified}（${b.conversion}），发布耗时中位 ${b.publishDaysMedian ?? '-'} 天`);
  console.log(`台账：${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
