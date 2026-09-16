// 服务器侧批量抽取。
//
// 为什么不放在云函数里：云函数有 60 秒硬上限，实测单次抽取 41-50 秒，
// 余量只有十秒，第一次调用就超时失败过。批量跑几百条时这个余量撑不住。
// 服务器没有这个限制，同一份抽取模块在这里可以给模型更充裕的时间。
//
// 部署位置：/opt/daily-contest/run-extract.mjs
// 抽取模块：/opt/daily-contest/cjs/（云函数那几个 CJS 文件的副本，
//          服务器 package.json 是 type:module，所以必须放在带自己
//          package.json 的子目录里）
// 密钥：/opt/daily-contest/.extract-key，单行纯文本，chmod 600
//
// 用法：node run-extract.mjs --in candidates.json [--limit 3] [--out report.json]
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.join(HERE, '.extract-key');
const CJS_DIR = path.join(HERE, 'cjs');

// 密钥只从文件读，不接受命令行参数 —— 命令行会进 shell 历史。
function readKey() {
  if (!fs.existsSync(KEY_FILE)) throw new Error(`缺少密钥文件 ${KEY_FILE}`);
  const key = fs.readFileSync(KEY_FILE, 'utf8').trim();
  if (!key) throw new Error(`密钥文件 ${KEY_FILE} 是空的，请先写入`);
  return key;
}

// 抽取模块从 process.env 读配置，所以必须在 require 之前设好。
process.env.EXTRACT_AI_API_KEY = readKey();
process.env.EXTRACT_AI_BASE_URL = process.env.EXTRACT_AI_BASE_URL || 'https://api.deepseek.com';
process.env.EXTRACT_AI_MODEL = process.env.EXTRACT_AI_MODEL || 'deepseek-flash';

const require = createRequire(import.meta.url);
const { extractFromDetailPage } = require(path.join(CJS_DIR, 'competitionExtract.js'));

// 服务器没有 60 秒上限，给模型更充裕的时间；仍然设上限，避免单条卡死拖垮整批。
const SERVER_BUDGET_MS = 180000;
const PER_CALL_DELAY_MS = 1200;
const USER_AGENT = 'competition-crawler/1.0 (+admin source verification; respects robots.txt)';

function parseArgs(argv) {
  const args = { in:'', out:'', limit:0 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') args.in = argv[i + 1];
    if (argv[i] === '--out') args.out = argv[i + 1];
    if (argv[i] === '--limit') args.limit = Number(argv[i + 1]) || 0;
  }
  if (!args.in) throw new Error('必须指定 --in <候选文件>');
  args.out = args.out || args.in.replace(/\.json$/, '') + '-extracted.json';
  return args;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 天池详情页是前后端分离的，静态抓取只有导航骨架（实测两个不同赛事抓出来
// 一字不差）。正文要走它自己的接口取，再经 text 传给抽取模块。
async function tianchiText(raceId) {
  const response = await fetch(
    `https://tianchi.aliyun.com/v3/proxy/competition/api/race/getDetail?raceId=${raceId}`,
    { headers:{ 'user-agent':USER_AGENT }, signal:AbortSignal.timeout(20000) },
  );
  if (!response.ok) return '';
  const race = (await response.json())?.data?.race || {};
  return [race.name, race.introduction, race.rule, race.reward, race.currentSeason?.rule, race.currentSeason?.reward]
    .filter(value => typeof value === 'string').join('\n');
}

// 按站点决定怎么取正文。取不到就返回空串，让抽取模块自己去抓页面。
async function sourceTextFor(candidate) {
  const url = String(candidate.detailUrl || candidate.url || '');
  const tianchi = /tianchi\.aliyun\.com\/competition\/entrance\/(\d+)/.exec(url);
  if (tianchi) {
    try {
      return await tianchiText(tianchi[1]);
    } catch (error) {
      return '';
    }
  }
  return '';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = JSON.parse(await fsp.readFile(path.resolve(HERE, args.in), 'utf8'));
  const candidates = (payload.candidates || payload.new || payload).slice(0, args.limit || undefined);

  console.log(`供应商 ${process.env.EXTRACT_AI_MODEL} @ ${process.env.EXTRACT_AI_BASE_URL}`);
  console.log(`待抽取 ${candidates.length} 条\n`);

  const results = [];
  for (const [index, candidate] of candidates.entries()) {
    const url = String(candidate.detailUrl || candidate.url || '');
    const name = String(candidate.name || candidate.candidate || '');
    const started = Date.now();
    let outcome;
    try {
      const text = await sourceTextFor(candidate);
      outcome = await extractFromDetailPage(url, undefined, {
        contestName:name, text, totalBudgetMs:SERVER_BUDGET_MS, chatTimeoutMs:SERVER_BUDGET_MS,
      });
    } catch (error) {
      // 单条失败不能中断整批 —— 其余候选仍然值得跑完。
      outcome = { ok:false, status:'threw', url, error:String(error?.message || error).slice(0, 300) };
    }
    const elapsed = Date.now() - started;
    results.push({ name, url, elapsedMs:elapsed, ...outcome });
    const suffix = outcome.ok
      ? `建议${outcome.suggestions?.length ?? 0}条 丢弃${outcome.droppedCount ?? 0}条`
      : `失败 ${outcome.status}`;
    console.log(`[${index + 1}/${candidates.length}] ${String(elapsed).padStart(6)}ms  ${suffix}  ${name.slice(0, 30)}`);
    if (index < candidates.length - 1) await sleep(PER_CALL_DELAY_MS);
  }

  const ok = results.filter(item => item.ok);
  const report = {
    generatedAt:new Date().toISOString(),
    model:process.env.EXTRACT_AI_MODEL,
    baseUrl:process.env.EXTRACT_AI_BASE_URL,
    policy:'抽取只产出建议，不写库。每条建议都带回原文定位得到的引文。',
    total:results.length,
    succeeded:ok.length,
    medianElapsedMs:ok.length
      ? ok.map(item => item.elapsedMs).sort((a, b) => a - b)[Math.floor(ok.length / 2)]
      : null,
    totalDropped:ok.reduce((sum, item) => sum + (item.droppedCount || 0), 0),
    results,
  };
  const outPath = path.resolve(HERE, args.out);
  await fsp.writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`\n成功 ${ok.length}/${results.length}  中位耗时 ${report.medianElapsedMs}ms  累计丢弃 ${report.totalDropped} 条`);
  console.log(`写入 ${outPath}`);
}

main().catch(error => {
  console.error('批量抽取失败:', error.message);
  process.exit(1);
});
