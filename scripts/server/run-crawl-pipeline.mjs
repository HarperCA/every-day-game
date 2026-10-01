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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCandidates, hostOf } from './crawler/lib/dedupe.mjs';
import { buildMastersFromRecords } from './crawler/lib/masters.mjs';
import { collectMentions } from './known-event-mentions.mjs';
import { loadMemory, recentlyRejected, remember, saveMemory } from './rejected-memory.mjs';
import { filterCandidatesWithJev } from './crawler/lib/jevCandidateFilter.mjs';
import { followupCandidatesFromReport, splitTrustedFollowups } from './resolve-notice-leads.mjs';
import { stampDiscovery } from './discovery.mjs';
import { buildPipelineLedger } from './pipeline-ledger.mjs';

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
  tianchi: { script: 'crawler/crawl-tianchi.mjs', volumeFlag: '--pages', uniqueUrls: true },
  // DataFountain 已于 2026-09-30 停用：平台的“可报名”标记不可靠，每晚交来的 32 场全是已截止的旧比赛
  // 或 2099 年截止的练习题，还把一个大赛的每道赛题各列一条。用户决定整个来源不要了。
  baidu: { script: 'search-baidu.mjs', volumeFlag: '--queries' },
  // 辽宁省大学生创新创业管理共享平台：公开数据接口，经上海网页中转读取（platforms/upln.py）
  upln: { command: 'python3', script: 'platforms/upln.py', uniqueUrls: true },
};

function parseArgs(argv) {
  const args = { sources: ['tianchi', 'upln', 'baidu'], dryRun: false, filterOnly:false, pages: 0, queries:0 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--sources') args.sources = argv[i + 1].split(',').map(s => s.trim()).filter(Boolean);
    if (argv[i] === '--dry-run') args.dryRun = true;
    if (argv[i] === '--filter-only') args.filterOnly = true;
    if (argv[i] === '--pages') args.pages = Number(argv[i + 1]) || 0;
    if (argv[i] === '--queries') args.queries = Number(argv[i + 1]) || 0;
  }
  return args;
}

function readAdminToken() {
  if (!fs.existsSync(TOKEN_FILE)) throw new Error(`缺少口令文件 ${TOKEN_FILE}`);
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  if (!token) throw new Error(`口令文件 ${TOKEN_FILE} 是空的`);
  return token;
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
  runOptions = { dryRun:args.dryRun, filterOnly:args.filterOnly };
  const adminToken = readAdminToken();
  fs.mkdirSync(RUN_DIR, { recursive: true });

  console.log(`=== 发现新赛事流水线 ${new Date().toISOString()} ===`);
  console.log(`来源: ${args.sources.join(', ')}${args.dryRun || args.filterOnly ? '（不会写库）' : ''}`);
  console.log(`运行目录: ${RUN_DIR}\n`);

  // 1. 读库里当前真实状态，作为判重基准——不是种子快照。
  const bootstrapRes = await fetch(`${API_BASE}/api/adminData`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken, action: 'bootstrap' }),
  });
  const bootstrap = await bootstrapRes.json();
  if (!bootstrap?.ok && !bootstrap?.data) throw new Error('bootstrap 失败：' + (bootstrap?.message || 'unknown'));
  const records = bootstrap.data.records || [];
  const masters = buildMastersFromRecords(records);
  console.log(`库中现有 ${records.length} 条记录 → ${masters.length} 个赛事主条目\n`);

  // 2. 逐个来源抓取 + 判重，只留 new。
  const allNew = [];
  const summary = [];
  // 判重命中库里已有赛事的通知不再丢掉：整理成清单，02:15 记录追溯据此找官方来源（known-event-mentions.mjs）
  const recordsById = new Map(records.map(record => [record.id, record]));
  const mentionGroups = new Map();
  for (const source of args.sources) {
    const config = SOURCE_CONFIG[source];
    if (!config || !fs.existsSync(path.join(HERE, config.script))) {
      console.log(`跳过未知来源: ${source}`);
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
    console.log(`--- 抓取 ${source} ---`);
    run(config.command || 'node', crawlArgs);

    const candidates = (JSON.parse(fs.readFileSync(outFile, 'utf8')).candidates || []).map(candidate => stampDiscovery(candidate, source, RUN_ID));
    const buckets = classifyCandidates(candidates, masters);
    collectMentions([buckets], masters, recordsById, mentionGroups);
    const newCandidates = [...buckets.new, ...(config.uniqueUrls ? buckets.uncertain : [])].map(({ candidate }) => candidate);
    console.log(`${source}: 抓到 ${candidates.length} 条，new ${newCandidates.length}，`
      + `duplicate ${buckets.duplicate.length}，likely_duplicate ${buckets.likely_duplicate.length}，`
      + `uncertain ${buckets.uncertain.length}（命中已有赛事的整理进追溯清单，拿不准的跳过）\n`);

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
    });
  }

  const mentionsFile = path.join(RUN_DIR, 'known-event-mentions.json');
  fs.writeFileSync(mentionsFile, JSON.stringify({ createdAt:new Date().toISOString(), groups:[...mentionGroups.values()] }, null, 2), 'utf8');
  console.log(`提到库里已有赛事的通知：涉及 ${mentionGroups.size} 场赛事，清单 ${mentionsFile}
`);

  if (!allNew.length) {
    console.log('没有新候选，流水线到此结束（未调用 AI，未写库）。');
    await writeRunLog({ summary, extracted: 0, ingest: null });
    return;
  }

  // 近 30 天已经被拒过的网址不再处理（rejected-memory.mjs）：否则同一批赛题、栏目页每晚重复读详情再被拒
  const memoryFile = path.join(HERE, 'plans', 'rejected-urls.json');
  const memory = loadMemory(memoryFile);
  const beforeMemory = allNew.length;
  allNew.splice(0, allNew.length, ...allNew.filter(candidate => !recentlyRejected(memory, candidate.detailUrl)));
  if (beforeMemory !== allNew.length) console.log(`近 30 天已被拒过的 ${beforeMemory - allNew.length} 条跳过（被拒网址记忆）
`);
  if (!allNew.length) {
    console.log('去掉已被拒过的之后没有新候选，流水线结束（未调用 AI，未写库）。');
    await writeRunLog({ summary, rememberedSkipped:beforeMemory, extracted:0, ingest:null });
    return;
  }

  // 3. 内容下载前筛选：硬规则先处理目录、校赛、新闻等明确类型，
  // 剩余候选再交给 Jev 做有界分类。低置信度只进线索报告；Jev 不可用或
  // 调用失败时保持旧流程继续抓取，避免外部模型故障导致整条流水线零产出。
  // 平台登记的赛事（天池、辽宁平台）本身就是结构化的比赛条目，不需要 Jev 判断“是什么网页”，
  // 直接去读详情；Jev 只看搜索来的候选（2026-09-30：辽宁平台 11 场被 Jev 判“拿不准”、只留作线索）。
  const isPlatform = candidate => Boolean(SOURCE_CONFIG[candidate.discovery?.source]?.uniqueUrls);
  const platformNew = allNew.filter(isPlatform);
  console.log(`=== Jev 前置筛选 ${allNew.length - platformNew.length} 条新候选（平台条目 ${platformNew.length} 条直接读详情） ===`);
  const jevResult = await filterCandidatesWithJev(allNew.filter(candidate => !isPlatform(candidate)), { apiKey:readOpenRouterKey() });
  for (const candidate of platformNew) {
    jevResult.decisions.push({ candidate, action:'fetch', kind:'platform_entry', confidence:1, source:'platform', reason:'平台登记的赛事条目，跳过前置筛选直接读详情', probabilities:null, cost:0 });
    jevResult.fetch.push(candidate);
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
  jevResult.fetch.sort((a, b) => (priority.get(b)?.probabilities?.competition_site || 0) + (priority.get(b)?.probabilities?.organizer_notice || 0) + (priority.get(b)?.probabilities?.registration_entry || 0)
    - ((priority.get(a)?.probabilities?.competition_site || 0) + (priority.get(a)?.probabilities?.organizer_notice || 0) + (priority.get(a)?.probabilities?.registration_entry || 0)));
  // 2026-09-29 起：所有通知类（校内选拔、学校转发、赛事报道，以及标题是通知的主办方通知）都追溯上级赛事，
  // 不再只取前 10 条；resolve-notice-leads 按上级赛事分组、按重要程度分配搜索额度。
  const formalNotices = jevResult.decisions
    .filter(item => item.action === 'trace' || (/通知|公告|通告/.test(item.candidate.name || '') && item.kind !== 'unrelated' && item.action !== 'reject'))
    .map(item => item.candidate);
  const noticeBudget = (() => {
    try { return Number(JSON.parse(fs.readFileSync(planFileFor(), 'utf8')).trace?.noticeFollowups) || 10; } catch { return 10; }
  })();
  const followupFetch = [];
  if (formalNotices.length) {
    const noticesFile = path.join(RUN_DIR, 'formal-notices.json');
    const leadsFile = path.join(RUN_DIR, 'notice-resolution-leads.json');
    fs.writeFileSync(noticesFile, JSON.stringify({ candidates:formalNotices }, null, 2), 'utf8');
    try {
      run('node', ['resolve-notice-leads.mjs', noticesFile, leadsFile, '--budget', String(noticeBudget)]);
      // 已经搜索追溯过的通知记 30 天，避免同一篇通知每晚重复搜（额度不够没轮上的不记，下次还有机会）
      if (!args.dryRun) {
        const traced = (JSON.parse(fs.readFileSync(leadsFile, 'utf8')).results || []).filter(item => item.followupQuery)
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
        if (!classifyCandidates([candidate], followupMasters).new.length) continue;
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
    await writeRunLog({ summary, jev:{ fetch:jevResult.fetch.length, leads:jevResult.leads.length, rejected:jevResult.rejected.length, costUsd:jevResult.cost }, extracted:0, ingest:null });
    return;
  }

  if (!detailCandidates.length) {
    console.log('前置筛选后没有需要下载详情页的候选，流水线结束（未调用抽取，未写库）。');
    await writeRunLog({ summary, jev:{ fetch:0, leads:jevResult.leads.length, rejected:jevResult.rejected.length, costUsd:jevResult.cost }, extracted:0, ingest:null });
    return;
  }

  // 4. AI 抽取——只对判重且通过 Jev 前置筛选的候选跑。
  console.log(`=== AI 抽取 ${detailCandidates.length} 条新候选 ===`);
  const extractedFile = path.join(RUN_DIR, 'combined-extracted.json');
  run('node', ['run-extract.mjs', '--in', combinedFile, '--out', extractedFile]);

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

  await writeRunLog({ summary, rememberedSkipped:beforeMemory - allNew.length, jev:{ fetch:jevResult.fetch.length, leads:jevResult.leads.length, rejected:jevResult.rejected.length, costUsd:jevResult.cost }, noticeFollowups:followupFetch.length, extracted:detailCandidates.length, ingest:'see stdout above' });
}

// cloudbase SDK 的匿名会话会挂一个不自然结束的句柄（推测是 auth 的 keepalive/
// 实时连接），main() 跑完所有工作后进程并不会自己退出——实测跑完整条流水线后
// 进程还在，pipeline.log 也没追加最后一行。cron 场景下这会让每次调用都挂着
// 不退出，所以显式退出。


function planFileFor() {
  return path.join(HERE, 'plans', `search-plan-${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}.json`);
}

async function writeRunLog(entry) {
  lastRunEntry = { ...lastRunEntry, ...entry };
  const logFile = path.join(HERE, 'pipeline.log');
  fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
  const ledger = buildPipelineLedger(RUN_DIR, { ...lastRunEntry, startedAt:STARTED_AT, ...runOptions });
  fs.writeFileSync(path.join(RUN_DIR, 'result-ledger.json'), JSON.stringify(ledger, null, 2));
  const response = await fetch(`${API_BASE}/api/adminData`, {
    method:'POST', headers:{ 'content-type':'application/json' },
    body:JSON.stringify({ adminToken:readAdminToken(), action:'savePipelineRun', run:ledger }),
  });
  const result = await response.json();
  if (!result?.ok) throw new Error(`结果账写入失败：${result?.message || response.status}`);
}

// 作为模块导入时不执行流水线，便于单测纯函数（和 crawl-tianchi.mjs 同样的写法）。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(() => process.exit(0)).catch(error => {
    console.error('流水线失败:', error.message);
    writeRunLog({ error:error.message }).catch(logError => console.error('结果账写入失败:', logError.message))
      .finally(() => process.exit(1));
  });
}
