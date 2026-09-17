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
// new 会在处理 B 来源之前追加进 masters，防止同一场比赛被天池和
// DataFountain 各判一次「新」而重复入库。
//
// 只有 classifyCandidates 判定为 new 的候选才会进入抽取；duplicate /
// likely_duplicate / uncertain 一律跳过、只记日志，不占用抽取额度，
// 也不会被写库——这些情况本来就该交给人工核对，和现有 merge-candidates.mjs
// 的策略一致。
//
// 用法：node run-crawl-pipeline.mjs [--sources tianchi,datafountain] [--dry-run] [--pages 5]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cloudbase from '@cloudbase/js-sdk';
import { classifyCandidates, hostOf } from './crawler/lib/dedupe.mjs';
import { buildMastersFromRecords } from './crawler/lib/masters.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(HERE, '.admin-token');
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'daily-contest-dev-d8dbbhc653e221';
const RUN_DIR = path.join(HERE, 'runs', new Date().toISOString().replace(/[:.]/g, '-'));

function parseArgs(argv) {
  const args = { sources: ['tianchi', 'datafountain'], dryRun: false, pages: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--sources') args.sources = argv[i + 1].split(',').map(s => s.trim()).filter(Boolean);
    if (argv[i] === '--dry-run') args.dryRun = true;
    if (argv[i] === '--pages') args.pages = Number(argv[i + 1]) || 0;
  }
  return args;
}

function readAdminToken() {
  if (!fs.existsSync(TOKEN_FILE)) throw new Error(`缺少口令文件 ${TOKEN_FILE}`);
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  if (!token) throw new Error(`口令文件 ${TOKEN_FILE} 是空的`);
  return token;
}

function run(cmd, args) {
  console.log(`  $ node ${args.join(' ')}`);
  execFileSync('node', args, { cwd: HERE, stdio: 'inherit' });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const adminToken = readAdminToken();
  fs.mkdirSync(RUN_DIR, { recursive: true });

  console.log(`=== 发现新赛事流水线 ${new Date().toISOString()} ===`);
  console.log(`来源: ${args.sources.join(', ')}${args.dryRun ? '（--dry-run，不会写库）' : ''}`);
  console.log(`运行目录: ${RUN_DIR}\n`);

  // 1. 读库里当前真实状态，作为判重基准——不是种子快照。
  const app = cloudbase.init({ env: ENV_ID });
  const auth = app.auth();
  if (!await auth.getLoginState()) await auth.signInAnonymously();
  const rd = r => (typeof r?.result === 'string' ? JSON.parse(r.result) : r?.result);
  const bootstrap = rd(await app.callFunction({ name: 'adminData', data: { adminToken, action: 'bootstrap' }, parse: true }));
  if (!bootstrap?.ok && !bootstrap?.data) throw new Error('bootstrap 失败：' + (bootstrap?.message || 'unknown'));
  const records = bootstrap.data.records || [];
  const masters = buildMastersFromRecords(records);
  console.log(`库中现有 ${records.length} 条记录 → ${masters.length} 个赛事主条目\n`);

  // 2. 逐个来源抓取 + 判重，只留 new。
  const allNew = [];
  const summary = [];
  for (const source of args.sources) {
    const crawlerScript = path.join('crawler', `crawl-${source}.mjs`);
    if (!fs.existsSync(path.join(HERE, crawlerScript))) {
      console.log(`跳过未知来源: ${source}`);
      continue;
    }
    const outFile = path.join(RUN_DIR, `${source}-candidates.json`);
    // 传绝对路径：crawl-*.mjs 把 --out 解析成相对于它自己脚本文件所在目录
    // （crawler/），不是相对于 cwd——之前用 path.relative(HERE, …) 传相对路径，
    // 实测文件写到了 crawler/runs/…，和这里期望读取的路径对不上。
    const crawlArgs = [crawlerScript, '--out', outFile];
    if (args.pages) crawlArgs.push('--pages', String(args.pages));
    console.log(`--- 抓取 ${source} ---`);
    run('node', crawlArgs);

    const candidates = JSON.parse(fs.readFileSync(outFile, 'utf8')).candidates || [];
    const buckets = classifyCandidates(candidates, masters);
    const newCandidates = buckets.new.map(({ candidate }) => candidate);
    console.log(`${source}: 抓到 ${candidates.length} 条，new ${newCandidates.length}，`
      + `duplicate ${buckets.duplicate.length}，likely_duplicate ${buckets.likely_duplicate.length}，`
      + `uncertain ${buckets.uncertain.length}（后三类跳过，交人工）\n`);

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

  const combinedFile = path.join(RUN_DIR, 'combined-candidates.json');
  fs.writeFileSync(combinedFile, JSON.stringify({ candidates: allNew }, null, 2), 'utf8');

  if (!allNew.length) {
    console.log('没有新候选，流水线到此结束（未调用 AI，未写库）。');
    writeRunLog({ startedAt: bootstrap ? new Date().toISOString() : null, summary, extracted: 0, ingest: null });
    return;
  }

  // 3. AI 抽取——只对刚判定为 new 的候选跑，不浪费额度在重复项上。
  console.log(`=== AI 抽取 ${allNew.length} 条新候选 ===`);
  const extractedFile = path.join(RUN_DIR, 'combined-extracted.json');
  run('node', ['run-extract.mjs', '--in', combinedFile, '--out', extractedFile]);

  // 4. 入库——草稿、乐观锁、跳过已被人工处理的记录，都是 ingest-candidates.mjs 自己的纪律，这里不重复实现。
  console.log(`\n=== 入库（只收admit档） ===`);
  const ingestArgs = ['ingest-candidates.mjs', '--candidates', combinedFile, '--extracted', extractedFile, '--only-admitted'];
  if (args.dryRun) ingestArgs.push('--dry-run');
  run('node', ingestArgs);

  writeRunLog({ summary, extracted: allNew.length, ingest: 'see stdout above' });
}

// cloudbase SDK 的匿名会话会挂一个不自然结束的句柄（推测是 auth 的 keepalive/
// 实时连接），main() 跑完所有工作后进程并不会自己退出——实测跑完整条流水线后
// 进程还在，pipeline.log 也没追加最后一行。cron 场景下这会让每次调用都挂着
// 不退出，所以显式退出。


function writeRunLog(entry) {
  const logFile = path.join(HERE, 'pipeline.log');
  fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
}

// 作为模块导入时不执行流水线，便于单测纯函数（和 crawl-tianchi.mjs 同样的写法）。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(() => process.exit(0)).catch(error => {
    console.error('流水线失败:', error.message);
    writeRunLog({ error: error.message });
    process.exit(1);
  });
}
