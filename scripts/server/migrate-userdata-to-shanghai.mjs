// 把美国服务器上的账号、收藏、提醒迁到腾讯云开发上海环境（2026-10-01）。
// 原编号原样保留：小程序改走上海登录后，按微信身份找到的还是原来那个账号，收藏和提醒都在。
//
// 用法（在服务器上，需已登录腾讯云命令行 tcb，且上海环境里已部署临时函数 userMigrate）：
//   node migrate-userdata-to-shanghai.mjs            迁移并核对条数
//   node migrate-userdata-to-shanghai.mjs --dry-run  只看要迁多少
// 可以重复运行：按原编号覆盖写，结果一样。切换当天（新版小程序发布后）再跑一次，把这期间老版本写在美国的补过去。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.DB_FILE || path.join(HERE, 'server', 'data', 'app.db');
const ENV_ID = process.env.CLOUD_ENV_ID || 'daily-contest-dev-d8dbbhc653e221';
const COLLECTIONS = ['user_account', 'favorite', 'reminder'];
const BATCH = 50;
const dryRun = process.argv.includes('--dry-run');

function readCollection(name) {
  const out = execFileSync('sqlite3', ['-json', DB_FILE, `select id, data from documents where collection='${name}'`], { encoding:'utf8' }).trim();
  return (out ? JSON.parse(out) : []).map(row => ({ _id:row.id, ...JSON.parse(row.data) }));
}

function invoke(params) {
  const out = execFileSync('tcb', ['fn', 'invoke', 'userMigrate', '-e', ENV_ID, '--params', JSON.stringify(params)], { encoding:'utf8', input:'' });
  const match = out.replace(/\x1b\[[0-9;]*m/g, '').match(/Return result：(\{.*\})/);
  if (!match) throw new Error(`调用 userMigrate 没有返回结果：${out.slice(-300)}`);
  const result = JSON.parse(match[1]);
  if (!result.ok) throw new Error(`userMigrate 报错：${result.message}`);
  return result;
}

for (const collection of COLLECTIONS) {
  const docs = readCollection(collection);
  if (dryRun) { console.log(`${collection}：美国 ${docs.length} 条（试运行，不写）`); continue; }
  let written = 0;
  for (let i = 0; i < docs.length; i += BATCH) written += invoke({ action:'upsert', collection, docs:docs.slice(i, i + BATCH) }).written;
  const { total } = invoke({ action:'count', collection });
  console.log(`${collection}：美国 ${docs.length} 条 → 写入上海 ${written} 条，上海现有 ${total} 条`);
}
