// 从 CloudBase 把 7 个集合完整导出成本地 JSON，作为迁移的第一步。
//
// 只读，不写、不删 CloudBase 任何东西——迁移期间 CloudBase 侧原样保留，
// 随时可以回退。导出结果带条数和内容哈希，导入 SQLite 后逐表比对。
//
// admin_state / audit_log 这些管理侧数据走 adminData 云函数（要 ADMIN_TOKEN）；
// 公开缓存走 publicData（不需要口令）。user_account / favorite / reminder /
// feedback 这些按用户存的数据，云函数没有「全量导出」这个接口——
// 那是刻意的（普通用户不能拉别人的数据），所以这几张表需要另外的办法，
// 见文件末尾的说明。
//
// 用法：node migrate/export-from-cloudbase.mjs [--out ../../reports/cloudbase-export]
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import cloudbase from '@cloudbase/js-sdk';
import { canonicalHash } from './canonical.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const TOKEN_FILE = path.join(REPO_ROOT, '.admin-token.local');
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'daily-contest-dev-d8dbbhc653e221';

function parseArgs(argv) {
  const out = { out: path.join(REPO_ROOT, 'reports', 'cloudbase-export') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') out.out = path.resolve(argv[i + 1]);
  }
  return out;
}

function readAdminToken() {
  if (!fs.existsSync(TOKEN_FILE)) throw new Error(`缺少口令文件 ${TOKEN_FILE}`);
  const line = fs.readFileSync(TOKEN_FILE, 'utf8').split(/\r?\n/).find(l => /^\s*ADMIN_TOKEN\s*=/.test(l));
  const token = line?.replace(/^\s*ADMIN_TOKEN\s*=\s*/, '').trim();
  if (!token) throw new Error(`${TOKEN_FILE} 里没有 ADMIN_TOKEN`);
  return token;
}

// 规范化哈希：比内容，不比键顺序（见 canonical.mjs）
const hashOf = canonicalHash;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const adminToken = readAdminToken();

  const app = cloudbase.init({ env: ENV_ID });
  const auth = app.auth();
  if (!await auth.getLoginState()) await auth.signInAnonymously();

  const unwrap = response => (typeof response?.result === 'string' ? JSON.parse(response.result) : response?.result);
  const callAdmin = async data => {
    const result = unwrap(await app.callFunction({ name: 'adminData', data: { adminToken, ...data }, parse: true }));
    if (!result?.ok) throw new Error(result?.message || 'adminData 返回异常');
    return result.data;
  };

  await fsp.mkdir(args.out, { recursive: true });
  const manifest = { exportedAt: new Date().toISOString(), environment: ENV_ID, tables: {} };

  // bootstrap 一次性把管理侧的整表数据都带回来了：records / feedbacks /
  // ai_jobs / audit / 版本号，正好是 admin_state + audit_log 的全部内容。
  console.log('导出管理侧数据（admin_state + audit_log）…');
  const bootstrap = await callAdmin({ action: 'bootstrap' });

  // 注意 bootstrap.feedbacks 是「admin_state.feedbacks + feedback 集合」合并后的视图，
  // 不是 admin_state 里的原始内容。原始内容要走下面的 exportCollections。
  const adminTables = {
    'admin_state.competitions': { records: bootstrap.records || [], version: bootstrap.stateVersions?.records ?? 0 },
    'admin_state.ai_jobs': { records: bootstrap.aiJobs || [], version: bootstrap.stateVersions?.aiJobs ?? 0 },
    'audit_log': bootstrap.audits || [],
    'bootstrap-feedbacks-merged-view': bootstrap.feedbacks || [],
  };

  for (const [name, value] of Object.entries(adminTables)) {
    const file = path.join(args.out, `${name}.json`);
    await fsp.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
    const count = Array.isArray(value) ? value.length : (value.records?.length ?? 0);
    manifest.tables[name] = { count, hash: hashOf(value), file: path.basename(file) };
    console.log(`  ${name}: ${count} 条`);
  }

  // 按用户存的那几张表（user_account / favorite / reminder / feedback）和
  // 公开缓存，走 adminData 新加的只读导出接口——userData 刻意只让用户读自己
  // 的数据，没有全量接口，所以这个导出口子是专门为迁移开的，需要 ADMIN_TOKEN。
  console.log('导出用户侧数据与公开缓存（exportCollections）…');
  const rawCollections = ['admin_state.feedbacks', 'event_edition_public_cache', 'user_account', 'favorite', 'reminder', 'feedback'];
  const missing = [];
  for (const name of rawCollections) {
    try {
      const dump = await callAdmin({ action: 'exportCollection', collection: name });
      const file = path.join(args.out, `${name}.json`);
      await fsp.writeFile(file, JSON.stringify(dump, null, 2), 'utf8');
      const count = Array.isArray(dump) ? dump.length : (dump.records?.length ?? 0);
      manifest.tables[name] = { count, hash: hashOf(dump), file: path.basename(file) };
      console.log(`  ${name}: ${count} 条`);
    } catch (error) {
      missing.push(name);
      console.log(`  ⚠ ${name} 导出失败：${error.message}`);
    }
  }
  if (missing.length) manifest.pending = missing;

  await fsp.writeFile(path.join(args.out, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\n已导出到 ${args.out}`);
  const total = Object.values(manifest.tables).reduce((sum, item) => sum + item.count, 0);
  console.log(`共 ${Object.keys(manifest.tables).length} 张表、${total} 条记录`);
  if (manifest.pending?.length) console.log(`⚠ 未导出：${manifest.pending.join(', ')}`);
}

main().catch(error => {
  console.error('导出失败:', error.message);
  process.exit(1);
});
