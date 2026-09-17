// 手动跑一次"让模型自己决定要不要再看别的链接"的审核（自己定义的
// fetch_url 工具，不是某个平台托管的官方工具）。
//
// 和 apps/admin 里的 --ai-check（走 runCompetitionAiReview，一问一答）是
// 两条不同的路径：这里用的是 runCompetitionAiReviewAgentic，模型看完
// 我们给的证据后可以自己决定调用工具再看一个链接。
//
// tool_calls 是模型的通用能力，不需要额外开一个新账号——这里直接复用
// 服务器上已经配好的抽取密钥（.extract-key，DeepSeek），不用再等新密钥。
//
// 部署位置：/opt/daily-contest/run-review-agentic.mjs
// 密钥：/opt/daily-contest/.extract-key（和 run-extract.mjs 共用同一把）
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
const KEY_FILE = path.join(HERE, '.extract-key');
const ADMIN_TOKEN_FILE = path.join(HERE, '.admin-token');
const CJS_DIR = path.join(HERE, 'cjs');
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'daily-contest-dev-d8dbbhc653e221';

function readSingleLineFile(file, label) {
  if (!fs.existsSync(file)) throw new Error(`缺少${label} ${file}`);
  const value = fs.readFileSync(file, 'utf8').trim();
  if (!value) throw new Error(`${label} ${file} 是空的`);
  return value;
}

// 读配置模块要用的环境变量必须在 require 之前设好（和 run-extract.mjs 同一个写法）。
process.env.AI_API_KEY = readSingleLineFile(KEY_FILE, '抽取密钥');
process.env.AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.deepseek.com';
process.env.AI_MODEL = process.env.AI_MODEL || 'deepseek-chat';

const require = createRequire(import.meta.url);
const { runCompetitionAiReviewAgentic } = require(path.join(CJS_DIR, 'competitionAiReview.js'));

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

  console.log(`供应商 ${process.env.AI_MODEL} @ ${process.env.AI_BASE_URL}`);
  console.log(`审核对象: ${record.name}（${record.dataStatus}/${record.manualReview}）`);
  console.log(`来源数: ${(record.sources || []).length}\n`);

  const startedAt = Date.now();
  const result = await runCompetitionAiReviewAgentic(record, undefined, args.maxTurns ? { maxToolTurns:args.maxTurns } : {});
  console.log(`耗时: ${Date.now() - startedAt}ms`);
  console.log(`工具调用次数: ${result.tool_calls.length}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error('审核失败:', error.message);
  process.exit(1);
});
