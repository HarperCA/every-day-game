// 手动跑一次"让模型自己决定要不要再看别的链接"的审核（Formula API 工具调用）。
//
// 和 apps/admin 里的 --ai-check（走 runCompetitionAiReview，一问一答）是
// 两条不同的路径：这里用的是 runCompetitionAiReviewAgentic，模型看完
// 我们给的证据后可以自己决定调用 fetch 工具再看一个链接。
//
// 部署位置：/opt/daily-contest/run-review-agentic.mjs
// 密钥：/opt/daily-contest/.moonshot-tools-key，单行纯文本，chmod 600
//       （Moonshot 平台账号的密钥，和 Kimi 编程订阅、.extract-key 都不是同一把——
//       fetch 工具只有 Moonshot 平台的 Formula API 才有）
// 管理员口令：/opt/daily-contest/.admin-token，和其它脚本共用，用来读一条真实记录。
//
// 用法：node run-review-agentic.mjs --record-id <id> [--max-turns 4]
//       不传 --record-id 就用库里第一条记录。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import cloudbase from '@cloudbase/js-sdk';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_KEY_FILE = path.join(HERE, '.moonshot-tools-key');
const ADMIN_TOKEN_FILE = path.join(HERE, '.admin-token');
const CJS_DIR = path.join(HERE, 'cjs');
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'daily-contest-dev-d8dbbhc653e221';

const require = createRequire(import.meta.url);
const { runCompetitionAiReviewAgentic } = require(path.join(CJS_DIR, 'competitionAiReview.js'));

function readSingleLineFile(file, label) {
  if (!fs.existsSync(file)) throw new Error(`缺少${label} ${file}`);
  const value = fs.readFileSync(file, 'utf8').trim();
  if (!value) throw new Error(`${label} ${file} 是空的`);
  return value;
}

function parseArgs(argv) {
  const args = { recordId:'', maxTurns:0 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--record-id') args.recordId = argv[i + 1];
    if (argv[i] === '--max-turns') args.maxTurns = Number(argv[i + 1]) || 0;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const toolsApiKey = readSingleLineFile(TOOLS_KEY_FILE, 'Moonshot 工具密钥');
  const adminToken = readSingleLineFile(ADMIN_TOKEN_FILE, '管理员口令');

  const app = cloudbase.init({ env:ENV_ID });
  const auth = app.auth();
  if (!await auth.getLoginState()) await auth.signInAnonymously();
  const rd = r => (typeof r?.result === 'string' ? JSON.parse(r.result) : r?.result);
  const call = async data => {
    const response = await app.callFunction({ name:'adminData', data:{ adminToken, ...data }, parse:true });
    const result = rd(response);
    if (!result?.ok) throw new Error(result?.message || 'adminData_failed');
    return result.data;
  };

  const bootstrap = await call({ action:'bootstrap' });
  const records = bootstrap.records || [];
  const record = args.recordId ? records.find(item => item.id === args.recordId) : records[0];
  if (!record) throw new Error(args.recordId ? `找不到记录 ${args.recordId}` : '库里没有记录');

  console.log(`审核对象: ${record.name}（${record.dataStatus}/${record.manualReview}）`);
  console.log(`来源数: ${(record.sources || []).length}\n`);

  const startedAt = Date.now();
  const result = await runCompetitionAiReviewAgentic(record, undefined, {
    apiKey:toolsApiKey,
    ...(args.maxTurns ? { maxToolTurns:args.maxTurns } : {}),
  });
  console.log(`耗时: ${Date.now() - startedAt}ms`);
  console.log(`工具调用次数: ${result.tool_calls.length}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error('审核失败:', error.message);
  process.exit(1);
});
