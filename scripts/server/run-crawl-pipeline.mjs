// 发现新赛事的完整流水线：抓取 → 跨来源判重（对着库里当前真实状态，
// 不是静态种子快照）→ AI 抽取详情页 → 以草稿入库。
//
// 部署位置：/opt/daily-contest/run-crawl-pipeline.mjs
// 依赖：
//   ./crawler/crawl-*.mjs   各来源的抓取脚本（sync-crawler.sh 同步）
//   ./crawler/lib/dedupe.mjs
//   ./run-extract.mjs       已存在，AI 抽取
//   ./ingest-candidates.mjs 已存在，草稿入库（带乐观锁与三条纪律）
//   ./.admin-token          纯文本单行，和 ingest-candidates.mjs 共用
//
// 判重范围是「库里当前全部记录」，不是两天前的种子快照——每次流水线跑之前
// 先读一次 bootstrap，避免同一场比赛被两个来源分别抓两次都判成「new」。
// 同一次运行里，来源之间也共享这份不断增长的 masters 列表：A 来源判出的
// new 会在处理 B 来源之前追加进 masters，防止同一场比赛被两个来源
// 各判一次「新」而重复入库。
//
// 只有 classifyCandidates 判定为 new 的候选才会进入抽取；duplicate /
// likely_duplicate / uncertain 一律跳过、只记日志，不占用抽取额度，
// 也不会被写库——这些情况本来就该交给人工核对，和现有 merge-candidates.mjs
// 的策略一致。
//
// 用法：node run-crawl-pipeline.mjs [--sources tianchi,upln] [--dry-run] [--pages 5]
// 重跑某一轮（不重新搜索，用那一轮已经抓到的候选按现在的规则走完整个流程）：
//   node run-crawl-pipeline.mjs --sources baidu --from-run 2026-09-30T17-00-15-235Z --ignore-memory
//   --ignore-memory：不跳过“近 30 天被拒过的网址”（那一轮按旧规则被拒的，要按新规则重新判）
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCandidates, hostOf, matchByUrlOnly, matchCandidate, regionsOf } from './crawler/lib/dedupe.mjs';
import { buildMastersFromRecords } from './crawler/lib/masters.mjs';
import { collectMentions } from './known-event-mentions.mjs';
import { loadMemory, recentlyRejected, remember, saveMemory, urlKey as urlKeyOf } from './rejected-memory.mjs';
import { filterCandidatesWithJev } from './crawler/lib/jevCandidateFilter.mjs';
import { followupCandidatesFromReport, noticeFollowupCompleted, splitTrustedFollowups, withTraceName } from './resolve-notice-leads.mjs';
import { isUnreadableHost } from './unreadable-hosts.mjs';
import { stampDiscovery } from './discovery.mjs';
import { buildPipelineLedger } from './pipeline-ledger.mjs';
import { extractContestNames, precheckNotices } from './notice-precheck.mjs';
import { loadSiteMemory, rememberSite, resolveNotices, saveSiteMemory, triedNote } from './notice-resolver.mjs';
import { verifyOfficialSource } from './source-check.mjs';
import { defaultPageReader } from './page-reader.mjs';
import { deepseekEngine } from './search-engines.mjs';
import { loadBlockedSites } from './site-blocklist.mjs';
import { selectAmbiguous } from './arbitrate-dedupe.mjs';
import { FIXED_SOURCE_INTERVAL_DAYS, checkDue, loadSchedule, markCrawled, saveSchedule } from './source-schedule.mjs';
import { dueReadFollowups, leadKey, loadLeadFollowups, recordJevLeads, recordReadOutcomes, recordRediscoveries, saveLeadFollowups } from './lead-followups.mjs';
import { LOCK_CHILD_FLAG, runWithPipelineLock } from './pipeline-lock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(HERE, '.admin-token');
// 后端已迁到自有服务器（见 docs/migration-to-self-hosted.md）。走本机 /api。
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = path.join(HERE, 'runs', RUN_ID);
const STARTED_AT = new Date().toISOString();
let runOptions = { dryRun:false, filterOnly:false };
let lastRunEntry = {};

// 天池是"针对单个网站写死接口"的抓取器，统一放在 crawler/ 下、
// 命名 crawl-<source>.mjs、用 --pages 控制抓取量。百度AI搜索不是爬某个网站，
// 是问第三方搜索引擎，脚本独立放在顶层、用 --queries 控制用量，
// 产出的候选形状和前两个一致，能直接喂进同一条判重/抽取/入库流水线。
// uniqueUrls：来源平台给每场比赛一个唯一编号/网址。对它们“网址完全相同”才是判重依据，
// 名字像不像不说明问题（辽宁的赛事都叫“辽宁省大学生××大赛”，字面相似度 0.6~0.7），
// 所以名字相似但网址不同的“拿不准”按新候选处理。搜索来的候选仍按原规则。
const SOURCE_CONFIG = {
  // everyDays：固定来源（不是百度搜索的）每 7 天才抓一次，见 source-schedule.mjs；百度搜索每晚都跑
  tianchi: { script: 'crawler/crawl-tianchi.mjs', volumeFlag: '--pages', uniqueUrls: true, everyDays: FIXED_SOURCE_INTERVAL_DAYS },
  // DataFountain 已于 2026-09-30 停用：平台的“可报名”标记不可靠，每晚交来的 32 场全是已截止的旧比赛
  // 或 2099 年截止的练习题，还把一个大赛的每道赛题各列一条。用户决定整个来源不要了。
  baidu: { script: 'search-baidu.mjs', volumeFlag: '--queries' },
  // 辽宁省大学生创新创业管理共享平台：公开数据接口，经上海网页中转读取（platforms/upln.py）
  upln: { command: 'python3', script: 'platforms/upln.py', uniqueUrls: true, everyDays: FIXED_SOURCE_INTERVAL_DAYS },
};

function parseArgs(argv) {
  const args = { sources: ['tianchi', 'upln', 'baidu'], sourcesGiven: false, dryRun: false, filterOnly:false, pages: 0, queries:0, fromRun:'', ignoreMemory:false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--sources') { args.sources = argv[i + 1].split(',').map(s => s.trim()).filter(Boolean); args.sourcesGiven = true; }
    if (argv[i] === '--dry-run') args.dryRun = true;
    if (argv[i] === '--filter-only') args.filterOnly = true;
    if (argv[i] === '--pages') args.pages = Number(argv[i + 1]) || 0;
    if (argv[i] === '--queries') args.queries = Number(argv[i + 1]) || 0;
    if (argv[i] === '--from-run') args.fromRun = String(argv[i + 1] || '');
    if (argv[i] === '--ignore-memory') args.ignoreMemory = true;
  }
  return args;
}

function readAdminToken() {
  if (!fs.existsSync(TOKEN_FILE)) throw new Error(`缺少口令文件 ${TOKEN_FILE}`);
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  if (!token) throw new Error(`口令文件 ${TOKEN_FILE} 是空的`);
  return token;
}

// DeepSeek 的钥匙（抽取、判重裁决共用），追溯前查库认名字用
function readExtractKey() {
  try { return fs.readFileSync(path.join(HERE, '.extract-key'), 'utf8').trim(); } catch { return ''; }
}

function readOpenRouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  const keyFile = path.join(HERE, '.openrouter-key');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf8').trim().replace(/^OPENROUTER_API_KEY=/, '');
  // 仓库本地运行时读取根目录 .env；服务器部署不依赖这个路径。
  const envFile = path.resolve(HERE, '..', '..', '.env');
  if (!fs.existsSync(envFile)) return '';
  const match = fs.readFileSync(envFile, 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m);
  return match?.[1]?.trim() || '';
}

function run(cmd, args) {
  console.log(`  $ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd: HERE, stdio: 'inherit' });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.fromRun && !/^\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(args.fromRun)) throw new Error(`--from-run 不是运行编号：${args.fromRun}`);
  runOptions = { dryRun:args.dryRun, filterOnly:args.filterOnly, ...(args.fromRun ? { replayOf:args.fromRun } : {}) };
  const adminToken = readAdminToken();
  fs.mkdirSync(RUN_DIR, { recursive: true });
  // 保存一次搜索接口的原始返回（plans/save-raw-once 标记存在时）：这一轮所有搜索（夜间百度搜索、通知追溯、补读找正式通知）
  // 的原样返回逐条写进运行目录的 search-raw.jsonl。子进程继承环境变量。这一轮跑完删掉标记，所以只保存一次。
  const rawMarker = path.join(HERE, 'plans', 'save-raw-once');
  if (fs.existsSync(rawMarker) && !args.fromRun) {
    process.env.SEARCH_RAW_FILE = path.join(RUN_DIR, 'search-raw.jsonl');
    console.log(`本轮保存搜索接口的原始返回：${process.env.SEARCH_RAW_FILE}`);
  }
  // 重跑的标记：路线台账（route-ledger.mjs）据此不重复计算那一轮的搜索
  if (args.fromRun) fs.writeFileSync(path.join(RUN_DIR, 'replay.json'), JSON.stringify({ replayOf:args.fromRun, at:new Date().toISOString(), sources:args.sources, ignoreMemory:args.ignoreMemory }, null, 2));

  console.log(`=== 发现新赛事流水线 ${new Date().toISOString()} ===`);
  console.log(`来源: ${args.sources.join(', ')}${args.dryRun || args.filterOnly ? '（不会写库）' : ''}`);
  console.log(`运行目录: ${RUN_DIR}\n`);

  // 1. 读库里当前真实状态，作为判重基准——不是种子快照。
  const bootstrapRes = await fetch(`${API_BASE}/api/adminData`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken, action: 'bootstrap' }),
    signal: AbortSignal.timeout(30000),
  });
  const bootstrap = await bootstrapRes.json();
  const records = validateBootstrap(bootstrap, bootstrapRes.ok);
  const masters = buildMastersFromRecords(records);
  const leadFollowupsFile = path.join(HERE, 'plans', 'lead-followups.json');
  let leadFollowups = loadLeadFollowups(leadFollowupsFile);
  const readRetryKeys = new Set();
  console.log(`库中现有 ${records.length} 条记录 → ${masters.length} 个赛事主条目\n`);

  // 2. 逐个来源抓取 + 判重，只留 new。
  const allNew = [];
  const summary = [];
  // 判重命中库里已有赛事的通知不再丢掉：整理成清单，02:15 记录追溯据此找官方来源（known-event-mentions.mjs）
  const recordsById = new Map(records.map(record => [record.id, record]));
  const mentionGroups = new Map();
  // 固定来源每 7 天才抓一次；手动指定了 --sources 的运行不受限制，也不更新记录
  const scheduleFile = path.join(HERE, 'plans', 'source-schedule.json');
  let schedule = loadSchedule(scheduleFile);
  const scheduleReport = [];
  const crawledFixedSources = [];
  // 固定来源只有在本轮后续核验和结果账都完成后才推进七天周期。
  // 否则详情抽取或入库失败会让尚未处理的候选被跳过整整一周。
  async function finishRun(entry) {
    await writeRunLog(entry);
    if (args.dryRun || args.filterOnly || args.sourcesGiven || args.fromRun || !crawledFixedSources.length) return;
    for (const source of crawledFixedSources) schedule = markCrawled(schedule, source, RUN_ID);
    saveSchedule(scheduleFile, schedule);
  }
  for (const source of args.sources) {
    const config = SOURCE_CONFIG[source];
    if (!config || !fs.existsSync(path.join(HERE, config.script))) {
      console.log(`跳过未知来源: ${source}`);
      continue;
    }
    const due = args.sourcesGiven ? { run:true, everyDays:config.everyDays || 0, reason:'手动指定来源，不受频率限制' } : checkDue(schedule, source, config.everyDays);
    scheduleReport.push({ source, ran:due.run, everyDays:due.everyDays || 0, lastCrawledAt:due.lastCrawledAt ?? schedule[source]?.lastCrawledAt ?? null, nextDueAt:due.nextDueAt || null, reason:due.reason });
    if (!due.run) {
      console.log(`--- ${source}：${due.reason}（下次约 ${due.nextDueAt?.slice(0, 10)}）---\n`);
      summary.push({ source, fetched:0, new:0, duplicate:0, likely_duplicate:0, uncertain:0, skippedBySchedule:true });
      continue;
    }
    const outFile = path.join(RUN_DIR, `${source}-candidates.json`);
    // 传绝对路径：crawl-*.mjs / search-baidu.mjs 都把 --out 解析成相对于
    // 它自己脚本文件所在目录，不是相对于 cwd——之前用 path.relative(HERE, …)
    // 传相对路径，实测文件写到了脚本自己目录下的 runs/…，和这里期望读取的
    // 路径对不上。
    const crawlArgs = [config.script, '--out', outFile];
    const volume = source === 'baidu' ? args.queries : args.pages;
    if (volume && config.volumeFlag) crawlArgs.push(config.volumeFlag, String(volume));
    // 当天有次日搜索计划（search-plan.mjs，北京时间 00:50 生成）就按计划搜。
    const planFile = path.join(HERE, 'plans', `search-plan-${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}.json`);
    if (source === 'baidu' && fs.existsSync(planFile)) crawlArgs.push('--plan', planFile);
    if (args.fromRun) {
      const previous = path.join(HERE, 'runs', args.fromRun, `${source}-candidates.json`);
      if (!fs.existsSync(previous)) { console.log(`--- ${source}：${args.fromRun} 那一轮没有这个来源的候选，跳过 ---\n`); continue; }
      fs.copyFileSync(previous, outFile);
      console.log(`--- ${source}：用 ${args.fromRun} 那一轮已经抓到的候选重跑（不重新搜索） ---`);
    } else {
      console.log(`--- 抓取 ${source} ---`);
      run(config.command || 'node', crawlArgs);
    }

    const candidates = (JSON.parse(fs.readFileSync(outFile, 'utf8')).candidates || []).map(candidate => stampDiscovery(candidate, source, RUN_ID));
    if (config.everyDays) crawledFixedSources.push(source);
    const buckets = classifyCandidates(candidates, masters);
    collectMentions([buckets], masters, recordsById, mentionGroups);
    const newCandidates = [...buckets.new, ...(config.uniqueUrls ? buckets.uncertain : [])].map(({ candidate }) => candidate);
    // 规则判不好的（名字像但说不清是不是同一场；库里只有往届旧记录、页面可能是新一届），把情况讲清楚交给 AI 裁决：
    // 不是同一场、或是新一届的继续走流水线（新的替代旧的），同一届、下级通知、看不出的仍然跳过
    const arbitration = await arbitrateAmbiguous(source, selectAmbiguous(buckets, masters, recordsById, { includeUncertain:!config.uniqueUrls }), [buckets.uncertain, buckets.likely_duplicate, buckets.duplicate]);
    for (const candidate of arbitration.promoted) if (!newCandidates.includes(candidate)) newCandidates.push(candidate);
    console.log(`${source}: 抓到 ${candidates.length} 条，new ${newCandidates.length}，`
      + `duplicate ${buckets.duplicate.length}，likely_duplicate ${buckets.likely_duplicate.length}，`
      + `uncertain ${buckets.uncertain.length}（命中已有赛事的整理进追溯清单，拿不准的跳过）`
      + (arbitration.asked ? `；其中 ${arbitration.asked} 条交 AI 裁决，${arbitration.promoted.length} 条继续往下走` : '') + '\n');

    for (const candidate of newCandidates) {
      masters.push({
        id: `pending-${candidate.externalId}`,
        standard_name: candidate.name,
        aliases: [],
        website_url: candidate.detailUrl,
        sourceHosts: [hostOf(candidate.detailUrl)],
      });
    }
    allNew.push(...newCandidates);
    summary.push({
      source, fetched: candidates.length, new: newCandidates.length,
      duplicate: buckets.duplicate.length, likely_duplicate: buckets.likely_duplicate.length, uncertain: buckets.uncertain.length,
      ...(arbitration.asked ? { arbitrated:arbitration.asked, arbitratedPromoted:arbitration.promoted.length } : {}),
    });
  }

  fs.writeFileSync(path.join(RUN_DIR, 'source-schedule.json'), JSON.stringify({ createdAt:new Date().toISOString(), sources:scheduleReport }, null, 2), 'utf8');
  const mentionsFile = path.join(RUN_DIR, 'known-event-mentions.json');
  fs.writeFileSync(mentionsFile, JSON.stringify({ createdAt:new Date().toISOString(), groups:[...mentionGroups.values()] }, null, 2), 'utf8');
  console.log(`提到库里已有赛事的通知：涉及 ${mentionGroups.size} 场赛事，清单 ${mentionsFile}
`);

  // 上轮详情读取失败的页面下一轮优先重读，不等固定来源的七天抓取周期。
  // 已经有同网址的新抓取或库中记录的，不再重复放入。
  if (!args.filterOnly && !args.dryRun) {
    const currentKeys = new Set(allNew.map(candidate => leadKey(candidate.detailUrl)));
    const recordMasters = buildMastersFromRecords(records);
    for (const { key, candidate } of dueReadFollowups(leadFollowups)) {
      if (matchByUrlOnly(candidate, recordMasters)) { delete leadFollowups.entries[key]; continue; }
      if (!currentKeys.has(key)) { allNew.push(candidate); currentKeys.add(key); }
      readRetryKeys.add(key);
    }
    saveLeadFollowups(leadFollowupsFile, leadFollowups);
    if (readRetryKeys.size) console.log(`待重读详情 ${readRetryKeys.size} 条，优先进入本轮核验`);
  }

  if (!allNew.length) {
    console.log('没有新候选，流水线到此结束（未调用 AI，未写库）。');
    await finishRun({ summary, extracted: 0, ingest: null });
    return;
  }

  // 近 30 天已经被拒过的网址不再处理（rejected-memory.mjs）：否则同一批赛题、栏目页每晚重复读详情再被拒
  const memoryFile = path.join(HERE, 'plans', 'rejected-urls.json');
  const memory = loadMemory(memoryFile);
  const beforeMemory = allNew.length;
  if (args.ignoreMemory) console.log('--ignore-memory：不跳过近 30 天被拒过的网址，全部按现在的规则重新判');
  const rememberedList = [];
  allNew.splice(0, allNew.length, ...allNew.filter(candidate => {
    if (args.ignoreMemory || !recentlyRejected(memory, candidate.detailUrl)) return true;
    const entry = memory.urls[urlKeyOf(candidate.detailUrl)] || {};
    rememberedList.push({ url:candidate.detailUrl, reason:entry.reason || '', stage:entry.stage || '', at:entry.at || '' });
    return false;
  }));
  const rememberedSkipped = beforeMemory - allNew.length;
  // 哪些网址是因为“近 30 天处理过”被跳过的：后台运行详情据此区分“已在库”和“近期处理过”（2026-10-04）
  try { fs.writeFileSync(path.join(RUN_DIR, 'memory-skipped.json'), JSON.stringify({ skipped:rememberedList }), 'utf8'); } catch { /* 写不了不影响本轮 */ }
  if (!args.dryRun && !args.filterOnly) {
    leadFollowups = recordRediscoveries(leadFollowups, allNew, new Date(), RUN_ID);
    saveLeadFollowups(leadFollowupsFile, leadFollowups);
  }
  // 已在信源、目录或人工核查队列的相同网址不再反复分类；
  // 尚未到期的详情重读也不随搜索结果提前执行。
  const beforeFollowup = allNew.length;
  allNew.splice(0, allNew.length, ...allNew.filter(candidate => {
    const task = leadFollowups.entries[leadKey(candidate.detailUrl)];
    if (task?.status === 'manual_review' && !args.ignoreMemory) return false;
    if (task?.status === 'retry_read' && !readRetryKeys.has(leadKey(candidate.detailUrl))) return false;
    return true;
  }));
  const followupSkipped = beforeFollowup - allNew.length;
  if (rememberedSkipped) console.log(`近 30 天已被拒过的 ${rememberedSkipped} 条跳过（被拒网址记忆）
`);
  if (followupSkipped) console.log(`已在后续任务中或未到重读时间的 ${followupSkipped} 条不重复处理`);
  if (!allNew.length) {
    console.log('去掉已被拒过的之后没有新候选，流水线结束（未调用 AI，未写库）。');
    await finishRun({ summary, rememberedSkipped, followupSkipped, extracted:0, ingest:null });
    return;
  }

  // 3. 内容下载前筛选：硬规则先处理目录、校赛、新闻等明确类型，
  // 剩余候选再交给 Jev 做有界分类。低置信度只进线索报告；Jev 不可用或
  // 调用失败时保持旧流程继续抓取，避免外部模型故障导致整条流水线零产出。
  // 平台登记的赛事（天池、辽宁平台）本身就是结构化的比赛条目，不需要 Jev 判断“是什么网页”，
  // 直接去读详情；Jev 只看搜索来的候选（2026-09-30：辽宁平台 11 场被 Jev 判“拿不准”、只留作线索）。
  const isPlatform = candidate => Boolean(SOURCE_CONFIG[candidate.discovery?.source]?.uniqueUrls);
  const platformNew = allNew.filter(candidate => isPlatform(candidate) || readRetryKeys.has(leadKey(candidate.detailUrl)));
  console.log(`=== Jev 前置筛选 ${allNew.length - platformNew.length} 条新候选（平台条目/待重读 ${platformNew.length} 条直接读详情） ===`);
  const jevResult = await filterCandidatesWithJev(allNew.filter(candidate => !platformNew.includes(candidate)), { apiKey:readOpenRouterKey() });
  for (const candidate of platformNew) {
    const retry = readRetryKeys.has(leadKey(candidate.detailUrl));
    jevResult.decisions.push({ candidate, action:'fetch', kind:retry ? 'read_retry' : 'platform_entry', confidence:1, source:retry ? 'followup' : 'platform', reason:retry ? '上轮详情读取失败，本轮有界重读' : '平台登记的赛事条目，跳过前置筛选直接读详情', probabilities:null, cost:0 });
    jevResult.fetch.push(candidate);
  }
  // 已知读不了的站（微信公众号等，robots 不让抓）：放行了也读不到，不去读，改成转进通知追溯，用标题或摘要里的赛事名去搜官网
  const unreadableSet = new Set();
  for (const decision of jevResult.decisions) {
    if (decision.action !== 'fetch' || isPlatform(decision.candidate) || !isUnreadableHost(decision.candidate.detailUrl)) continue;
    decision.action = 'trace';
    decision.unreadable = true;
    decision.reason = `${decision.reason}；但这个网站读不了（robots 不允许抓取），不读详情，转去通知追溯`;
    unreadableSet.add(decision.candidate);
  }
  if (unreadableSet.size) {
    jevResult.fetch = jevResult.fetch.filter(candidate => !unreadableSet.has(candidate));
    jevResult.trace = [...(jevResult.trace || []), ...unreadableSet];
    console.log(`读不了的网站 ${unreadableSet.size} 条（微信公众号等）：不读详情，转去通知追溯`);
  }
  const jevReport = path.join(RUN_DIR, 'jev-filter-report.json');
  fs.writeFileSync(jevReport, JSON.stringify({
    createdAt:new Date().toISOString(), model:'typesafe/jev-1.13', confidenceThreshold:0.8,
    total:allNew.length, fetch:jevResult.fetch.length,
    leads:jevResult.leads.length, rejected:jevResult.rejected.length, costUsd:jevResult.cost,
    decisions:jevResult.decisions.map(({ candidate, ...decision }) => ({ name:candidate.name, url:candidate.detailUrl, ...decision })),
  }, null, 2), 'utf8');
  console.log(`继续抓取 ${jevResult.fetch.length}｜仅保留线索 ${jevResult.leads.length}｜拦截 ${jevResult.rejected.length}`);
  console.log(`Jev 费用 $${jevResult.cost.toFixed(8)}，报告：${jevReport}\n`);

  const combinedFile = path.join(RUN_DIR, 'combined-candidates.json');
  // 通知只用于追溯，不以通知标题进入详情抽取或赛事库。
  const priority = new Map(jevResult.decisions.map(item => [item.candidate, item]));
  jevResult.fetch.sort((a, b) => Number(readRetryKeys.has(leadKey(b.detailUrl))) - Number(readRetryKeys.has(leadKey(a.detailUrl)))
    || (priority.get(b)?.probabilities?.competition_site || 0) + (priority.get(b)?.probabilities?.organizer_notice || 0) + (priority.get(b)?.probabilities?.registration_entry || 0)
    - ((priority.get(a)?.probabilities?.competition_site || 0) + (priority.get(a)?.probabilities?.organizer_notice || 0) + (priority.get(a)?.probabilities?.registration_entry || 0)));
  // 2026-09-29 起：所有通知类（校内选拔、学校转发、赛事报道，以及标题是通知的主办方通知）都追溯上级赛事，
  // 不再只取前 10 条；resolve-notice-leads 按上级赛事分组、按重要程度分配搜索额度。
  const formalNotices = jevResult.decisions
    .filter(item => item.action === 'trace' || (/通知|公告|通告/.test(item.candidate.name || '') && item.kind !== 'unrelated' && item.action !== 'reject'))
    // 标题没有信息量（只有日期时间地名）或读不了的页面：赛事名换成摘要里提取的；同一场比赛的会在追溯里按赛事名归成一组，只搜一次
    .map(item => withTraceName(item.candidate, { replaceTitle:item.kind === 'title_no_info' || item.unreadable === true }));
  // 标题为通知的 lead/review 会进入追溯，不能同时算成“只留线索”。
  // 历史回填同样排除了 formal-notices，保持实时队列与结果账一致。
  if (!args.dryRun && !args.filterOnly) {
    const tracedKeys = new Set(formalNotices.map(candidate => leadKey(candidate.detailUrl)));
    leadFollowups = recordJevLeads(leadFollowups, jevResult.decisions.filter(decision => !tracedKeys.has(leadKey(decision.candidate.detailUrl))), new Date(), RUN_ID);
    saveLeadFollowups(leadFollowupsFile, leadFollowups);
  }
  const noticeBudget = (() => {
    // 0 也是有效值（2026-10-10 起百度额度全给细分专业，通知追溯代理只用 Kimi 搜索），不能用 || 兜底
    try { const value = Number(JSON.parse(fs.readFileSync(planFileFor(), 'utf8')).trace?.noticeFollowups); return Number.isFinite(value) ? value : 10; } catch { return 10; }
  })();
  const followupFetch = [];
  if (formalNotices.length) {
    const noticesFile = path.join(RUN_DIR, 'formal-notices.json');
    const leadsFile = path.join(RUN_DIR, 'notice-resolution-leads.json');
    fs.writeFileSync(noticesFile, JSON.stringify({ candidates:formalNotices }, null, 2), 'utf8');
    // 追溯前查库（notice-precheck.mjs，2026-10-12）：先认出通知背后的比赛，库里已有的、同一晚已在追的不派代理。
    // 认不出或调用失败的照常追溯。结果写 notice-precheck.json，后台明细据此显示“追溯前查库：库里已有”。
    const traceFile = path.join(RUN_DIR, 'trace-notices.json');
    const agentFile = path.join(RUN_DIR, 'notice-agent-results.json');
    const siteMemoryFile = path.join(HERE, 'plans', 'official-sites.json');
    const writeLocal = !args.dryRun && !args.filterOnly;
    let traceNotices = formalNotices;
    let fixed = null;
    try {
      const names = await extractContestNames(formalNotices, { key:readExtractKey(), log:console.log });
      const pre = precheckNotices(formalNotices, names, { masters:buildMastersFromRecords(records), recordsById, match:matchCandidate, regions:regionsOf });
      traceNotices = pre.toTrace;
      fs.writeFileSync(path.join(RUN_DIR, 'notice-precheck.json'), JSON.stringify({ createdAt:new Date().toISOString(), total:formalNotices.length,
        named:names.size, toTrace:pre.toTrace.length, skipped:pre.skipped, checked:pre.checked }, null, 2), 'utf8');
      console.log(`追溯前查库：${formalNotices.length} 篇通知，认出比赛名 ${names.size} 篇；库里已有 ${pre.skipped.filter(item => item.kind === 'in_library').length} 篇、`
        + `同一晚重复 ${pre.skipped.filter(item => item.kind === 'same_night').length} 篇，不派代理；继续追溯 ${pre.toTrace.length} 篇`);
      // 库里已有的记 30 天，免得每晚重复认名字；同一晚重复的不记（下一晚那场还没追到的话还要再追）
      if (writeLocal) {
        saveMemory(memoryFile, remember(loadMemory(memoryFile), pre.skipped.filter(item => item.kind === 'in_library')
          .map(item => ({ url:item.url, reason:`追溯前查库：库里已有「${item.matched.name}」`, stage:'通知追溯前查库' }))));
      }
      // 固定步骤（notice-resolver.mjs，2026-10-12）：认出名字的先按固定步骤找官方来源，核到的不派代理；
      // 没核到的连同“试过什么”交给代理，认不出名字的直接交给代理。整步失败就全部交给代理。
      try {
        const extractKey = readExtractKey();
        fixed = await resolveNotices(pre.named, {
          // 2026-10-12 用户定：搜索用 DeepSeek 自带的联网搜索（只给标题和网址，打分够用），不占 Kimi 额度
          searchEngine:deepseekEngine({ key:extractKey }), readPage:await defaultPageReader(), siteMemory:loadSiteMemory(siteMemoryFile),
          verify:(name, title, pages) => verifyOfficialSource(name, title, pages, { key:extractKey }),
          blocked:await loadBlockedSites({ log:console.log }), log:console.log,
        });
        fs.writeFileSync(path.join(RUN_DIR, 'notice-fixed-results.json'), JSON.stringify({ createdAt:new Date().toISOString(), stats:fixed.stats, results:fixed.results,
          unresolved:fixed.unresolved.map(item => ({ url:item.notice.detailUrl, title:item.notice.name, name:item.name, reason:item.reason, tried:item.tried })) }, null, 2), 'utf8');
        if (writeLocal) saveSiteMemory(siteMemoryFile, fixed.siteMemory);
        traceNotices = [...fixed.unresolved.map(item => ({ ...item.notice, contestName:item.name, traceHint:triedNote(item.tried, item.reason) })),
          ...pre.unnamed.map(item => item.notice)];
        console.log(`固定步骤：${pre.named.length} 篇，核到官方来源 ${fixed.stats.resolved}、不是比赛 ${fixed.stats.notCompetition}（官网记忆 ${fixed.stats.fromMemory}），`
          + `没核到 ${fixed.stats.unresolved}；交给代理 ${traceNotices.length} 篇（含认不出名字的 ${pre.unnamed.length}）`);
      } catch (error) {
        fixed = null;
        console.log(`固定步骤失败，继续追溯的通知全部交给代理：${String(error?.message || error).slice(0, 160)}`);
      }
    } catch (error) {
      console.log(`追溯前查库失败，全部照常追溯：${String(error?.message || error).slice(0, 160)}`);
    }
    fs.writeFileSync(traceFile, JSON.stringify({ candidates:traceNotices }, null, 2), 'utf8');
    try {
      // 2026-10-10 起通知追溯改用 Kimi 代理（notice-agent.mjs）；2026-10-12 起只处理固定步骤没核到的
      // token 上限 150 万（2026-10-12）：默认 600 万，而 Kimi 每 5 小时的额度约 250 万，连着两晚代理一个人用掉 240～270 万，
      // 后面读详情、入库核验没有额度可用；到上限就停，没轮上的通知下一晚接着处理
      let agentReport = { results:[], tokens:0, verifyTokens:0, engines:[], stopReason:'' };
      if (traceNotices.length) {
        run('node', ['notice-agent.mjs', traceFile, agentFile, '--baidu-budget', String(noticeBudget), '--budget-tokens', '1500000']);
        agentReport = JSON.parse(fs.readFileSync(agentFile, 'utf8'));
      }
      // 两部分合并成原来的 notice-resolution-leads.json（格式不变，每条多一个 method：fixed / agent），后面的判重、读详情不用改
      fs.writeFileSync(leadsFile, JSON.stringify({ generatedAt:new Date().toISOString(), method:fixed ? 'fixed+agent' : 'kimi_agent', model:agentReport.model,
        tokens:agentReport.tokens, verifyTokens:(agentReport.verifyTokens || 0) + (fixed?.stats.verifyTokens || 0), tokenBudget:agentReport.tokenBudget, stopReason:agentReport.stopReason,
        engines:agentReport.engines, fixedStats:fixed?.stats || null, results:[...(fixed?.results || []), ...agentReport.results] }, null, 2), 'utf8');
      // 代理核实过的官网也记进官网记忆，下次同一场比赛直接读
      if (writeLocal) {
        let sites = loadSiteMemory(siteMemoryFile);
        for (const item of agentReport.results) if (item.agent?.outcome === 'found_official' && item.proposedName && item.leads?.[0]?.url) sites = rememberSite(sites, { name:item.proposedName, url:item.leads[0].url, by:'agent', runId:RUN_ID });
        saveSiteMemory(siteMemoryFile, sites);
      }
      // 已经搜索追溯过的通知记 30 天，避免同一篇通知每晚重复搜（额度不够没轮上的不记，下次还有机会）
      if (!args.dryRun && !args.filterOnly) {
        const traced = (JSON.parse(fs.readFileSync(leadsFile, 'utf8')).results || []).filter(item => noticeFollowupCompleted(item) && !item.error)
          .flatMap(item => (item.notices || [{ url:item.noticeUrl }]).map(notice => ({ url:notice.url, reason:`已追溯上级赛事：${item.proposedName}`, stage:'通知追溯' })));
        saveMemory(memoryFile, remember(loadMemory(memoryFile), traced));
      }
      console.log(`正式通知 ${formalNotices.length} 条，赛事官网追溯线索已保存：${leadsFile}`);
      const followups = followupCandidatesFromReport(JSON.parse(fs.readFileSync(leadsFile, 'utf8'))).map(candidate => stampDiscovery(candidate, '通知追溯', RUN_ID));
      const followupReport = path.join(RUN_DIR, 'notice-followup-filter-report.json');
      // 通知正文里写出的网址直接放行，只有搜索搜到的才交给 Jev 判（resolve-notice-leads.mjs 的 splitTrustedFollowups）
      const split = splitTrustedFollowups(followups);
      const jevFollowups = await filterCandidatesWithJev(split.others, { apiKey:readOpenRouterKey() });
      const followupDecisions = { ...jevFollowups, decisions:[...split.decisions, ...jevFollowups.decisions] };
      const followupMasters = buildMastersFromRecords(records);
      for (const original of jevResult.fetch) {
        if (/通知|公告|通告/.test(original.name || '')) continue;
        followupMasters.push({ id:`pending-${original.externalId}`, standard_name:original.name, aliases:[], website_url:original.detailUrl, sourceHosts:[hostOf(original.detailUrl)] });
      }
      for (const decision of followupDecisions.decisions) {
        if (decision.action !== 'fetch' || !['competition_site','registration_entry'].includes(decision.kind)) continue;
        if (/通知|公告|通告|校级|校内|选拔|获奖|喜报/.test(decision.candidate.name || '')) continue;
        const candidate = { ...decision.candidate, name:decision.candidate.proposedCompetitionName };
        // 通知正文里写出的官网只按网址判重（名字相似度对它们不可靠）；搜索搜到的仍按名字判
        const isDuplicate = candidate.fromNoticeText
          ? Boolean(matchByUrlOnly(candidate, followupMasters))
          : !classifyCandidates([candidate], followupMasters).new.length;
        if (isDuplicate) continue;
        followupFetch.push(candidate);
        followupMasters.push({ id:`pending-${candidate.externalId}`, standard_name:candidate.name, aliases:[], website_url:candidate.detailUrl, sourceHosts:[hostOf(candidate.detailUrl)] });
      }
      fs.writeFileSync(followupReport, JSON.stringify({ total:followups.length, fetch:followupFetch.length, costUsd:followupDecisions.cost,
        decisions:followupDecisions.decisions.map(({candidate,...decision}) => ({ title:candidate.name, proposedName:candidate.proposedCompetitionName, url:candidate.detailUrl, ...decision })) }, null, 2));
      console.log(`通知追溯网页 ${followups.length} 条，二次分类并判重后进入详情核验 ${followupFetch.length} 条`);
    } catch (error) {
      console.log(`正式通知追溯失败，仍保留原通知供复核：${String(error?.message || error).slice(0, 180)}`);
    }
  }

  const detailCandidates = [...jevResult.fetch.filter(candidate => !/通知|公告|通告/.test(candidate.name || '')), ...followupFetch];
  fs.writeFileSync(combinedFile, JSON.stringify({ candidates:detailCandidates }, null, 2), 'utf8');

  if (args.filterOnly) {
    console.log('--filter-only：抓取与 Jev 筛选已完成，未调用详情抽取或入库。');
    await finishRun({ summary, jev:{ fetch:jevResult.fetch.length, leads:jevResult.leads.length, rejected:jevResult.rejected.length, costUsd:jevResult.cost }, extracted:0, ingest:null });
    return;
  }

  if (!detailCandidates.length) {
    console.log('前置筛选后没有需要下载详情页的候选，流水线结束（未调用抽取，未写库）。');
    await finishRun({ summary, jev:{ fetch:0, leads:jevResult.leads.length, rejected:jevResult.rejected.length, costUsd:jevResult.cost }, extracted:0, ingest:null });
    return;
  }

  // 4. AI 抽取——只对判重且通过 Jev 前置筛选的候选跑。
  console.log(`=== AI 抽取 ${detailCandidates.length} 条新候选 ===`);
  const extractedFile = path.join(RUN_DIR, 'combined-extracted.json');
  run('node', ['run-extract.mjs', '--in', combinedFile, '--out', extractedFile]);
  if (!args.dryRun) {
    const extracted = JSON.parse(fs.readFileSync(extractedFile, 'utf8'));
    leadFollowups = recordReadOutcomes(leadFollowups, detailCandidates, extracted.results || []);
    saveLeadFollowups(leadFollowupsFile, leadFollowups);
  }

  // 5. 入库——admit 候选继续走自动核验；review 候选也作为草稿写入，
  // 让人工能看到证据不足或抓取失败的线索，而不是被静默跳过。
  // 乐观锁、跳过已被人工处理的记录，都是 ingest-candidates.mjs 自己的纪律。
  console.log(`\n=== 入库（admit 自动核验；review 入人工复核） ===`);
  const ingestArgs = ['ingest-candidates.mjs', '--candidates', combinedFile, '--extracted', extractedFile];
  if (args.dryRun) ingestArgs.push('--dry-run');
  run('node', ingestArgs);

  // 记住这一轮被拒的网址：前置筛选拦截的、读了详情但没能入库的（读详情失败的不记，下次还能再试）
  if (!args.dryRun) {
    const rejected = jevResult.decisions.filter(item => item.action === 'reject').map(item => ({ url:item.candidate.detailUrl, reason:item.reason, stage:'前置筛选' }));
    try {
      const held = JSON.parse(fs.readFileSync(`${combinedFile}.scope-review.json`, 'utf8')).held || [];
      rejected.push(...held.filter(item => item.extraction?.ok !== false).map(item => ({ url:item.candidate?.detailUrl, reason:item.scope?.reason || item.reason, stage:'入库关' })));
    } catch { /* 这一轮没有入库关报告 */ }
    saveMemory(memoryFile, remember(loadMemory(memoryFile), rejected.filter(item => item.url)));
    console.log(`被拒网址记忆：本轮记下 ${rejected.length} 条`);
  }

  await finishRun({ summary, rememberedSkipped, followupSkipped, jev:{ fetch:jevResult.fetch.length, leads:jevResult.leads.length, rejected:jevResult.rejected.length, costUsd:jevResult.cost }, noticeFollowups:followupFetch.length, extracted:detailCandidates.length, ingest:'see stdout above' });
}

// cloudbase SDK 的匿名会话会挂一个不自然结束的句柄（推测是 auth 的 keepalive/
// 实时连接），main() 跑完所有工作后进程并不会自己退出——实测跑完整条流水线后
// 进程还在，pipeline.log 也没追加最后一行。cron 场景下这会让每次调用都挂着
// 不退出，所以显式退出。


// 把判重拿不准的候选交给 AI（arbitrate-dedupe.mjs），返回被裁决为“继续往下走”的候选。
// 裁决结果（含 AI 的理由和思考过程）写在运行目录的 dedupe-arbitration-<来源>.json，后台运行详情据此显示。
// AI 不可用时一律保持原样（跳过），不影响流水线。
async function arbitrateAmbiguous(source, items, bucketLists) {
  const none = { asked:0, promoted:[] };
  if (!items.length) return none;
  const inFile = path.join(RUN_DIR, `dedupe-arbitration-${source}-input.json`);
  const outFile = path.join(RUN_DIR, `dedupe-arbitration-${source}.json`);
  fs.writeFileSync(inFile, JSON.stringify({ items }, null, 2), 'utf8');
  try {
    console.log(`--- 判重裁决 ${source}：${items.length} 条拿不准的交给 AI ---`);
    run('node', ['arbitrate-dedupe.mjs', inFile, outFile]);
  } catch (error) {
    console.log(`判重裁决失败，拿不准的仍然跳过：${String(error?.message || error).slice(0, 160)}`);
    return { asked:items.length, promoted:[] };
  }
  const decisions = JSON.parse(fs.readFileSync(outFile, 'utf8')).decisions || {};
  const byUrl = new Map(bucketLists.flat().map(entry => [entry.candidate.detailUrl, entry.candidate]));
  const promoted = [];
  for (const item of items) {
    const decision = decisions[item.key];
    const candidate = byUrl.get(item.key);
    if (!decision?.promote || !candidate) continue;
    candidate.dedupeArbitration = { relation:decision.relation, reason:decision.reason, supersedes:decision.supersedes || [], matched:decision.matched, candidateEdition:decision.candidate_edition || '' };
    promoted.push(candidate);
  }
  return { asked:items.length, promoted };
}

function planFileFor() {
  return path.join(HERE, 'plans', `search-plan-${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}.json`);
}

async function writeRunLog(entry) {
  lastRunEntry = { ...lastRunEntry, ...entry };
  // 这一轮已经保存过原始返回：删掉标记，下一轮不再保存（只保存一次）
  if (process.env.SEARCH_RAW_FILE) { try { fs.unlinkSync(path.join(HERE, 'plans', 'save-raw-once')); } catch { /* 已经删过 */ } }
  const logFile = path.join(HERE, 'pipeline.log');
  fs.mkdirSync(RUN_DIR, { recursive:true });
  fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
  const ledger = buildPipelineLedger(RUN_DIR, { ...lastRunEntry, startedAt:STARTED_AT, ...runOptions });
  fs.writeFileSync(path.join(RUN_DIR, 'result-ledger.json'), JSON.stringify(ledger, null, 2));
  const response = await fetch(`${API_BASE}/api/adminData`, {
    method:'POST', headers:{ 'content-type':'application/json' },
    body:JSON.stringify({ adminToken:readAdminToken(), action:'savePipelineRun', run:ledger }),
    signal:AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!result?.ok) throw new Error(`结果账写入失败：${result?.message || response.status}`);
}

export function validateBootstrap(result, httpOk = true) {
  if (!httpOk || result?.ok !== true || !Array.isArray(result?.data?.records)) {
    throw new Error('bootstrap 失败或 records 无效，拒绝使用空库继续判重：' + (result?.message || 'invalid response'));
  }
  return result.data.records;
}

// 作为模块导入时不执行流水线，便于单测纯函数（和 crawl-tianchi.mjs 同样的写法）。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.env[LOCK_CHILD_FLAG] !== '1') {
    try { process.exit(runWithPipelineLock({ directory:path.join(HERE, 'plans'), script:fileURLToPath(import.meta.url), args:process.argv.slice(2) })); }
    catch (error) { console.error(error.message); process.exit(1); }
  }
  main().then(() => process.exit(0)).catch(error => {
    console.error('流水线失败:', error.message);
    writeRunLog({ error:error.message }).catch(logError => console.error('结果账写入失败:', logError.message))
      .finally(() => process.exit(1));
  });
}
