// 按确定性标题规则清理存量赛事。不调用任何 AI；默认只预览。
// 服务器用法：node delete-blocked-titles.mjs --apply --expect-version N --expect-count N
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { blockedTitleReason } = require(path.join(HERE, 'cjs', 'noticeResolution.js'));
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const apply = process.argv.includes('--apply');
const argument = flag => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1];
};

const token = (await fs.readFile(path.join(HERE, '.admin-token'), 'utf8')).trim();
async function call(action, data = {}) {
  const response = await fetch(`${API_BASE}/api/adminData`, {
    method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({adminToken:token, action, ...data}),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.message || `adminData ${response.status}`);
  return result.data;
}

const snapshot = await call('bootstrap');
const records = snapshot.records;
const version = snapshot.stateVersions?.records;
if (!Array.isArray(records) || !Number.isInteger(version)) throw new Error('invalid_bootstrap_snapshot');
const matches = records.map((record, index) => ({
  index, id:record.id, name:record.name, editionName:record.editionName,
  status:record.dataStatus,
  reason:blockedTitleReason(record.name) || blockedTitleReason(record.editionName),
})).filter(item => item.reason);
console.log(JSON.stringify({ version, total:records.length, matched:matches.length, matches }, null, 2));

if (!apply || !matches.length) process.exit(0);
if (String(version) !== argument('--expect-version') || String(matches.length) !== argument('--expect-count')) {
  throw new Error('preview_changed_or_missing_expectation');
}
const positions = new Set(matches.map(item => item.index));
if (positions.size !== matches.length || matches.some(item => records[item.index]?.name !== item.name || records[item.index]?.editionName !== item.editionName)) {
  throw new Error('matching_positions_changed');
}
const next = records.filter((_, index) => !positions.has(index));
if (next.length !== records.length - matches.length) throw new Error('deletion_count_mismatch');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(HERE, 'backups', `blocked-titles-${stamp}`);
await fs.mkdir(backupDir, { recursive:true, mode:0o700 });
await fs.writeFile(path.join(backupDir, 'records-before.json'), JSON.stringify(snapshot, null, 2), { mode:0o600 });
await fs.writeFile(path.join(backupDir, 'removed-manifest.json'), JSON.stringify({ version, matches }, null, 2), { mode:0o600 });
console.log(`整库备份和删除清单：${backupDir}`);

const now = new Date().toISOString();
const saved = await call('saveRecords', { records:next, expectedVersion:version, auditEntry:{
  id:`delete-blocked-titles-${Date.now()}`,
  action:'delete', objectType:'event_edition', recordId:'batch',
  recordName:`标题硬规则删除 ${matches.length} 条`,
  changedFields:['record_removed'], actor:'super_admin',
  reason:`用户要求自动删除名称含通知、感叹号或正式启动等用语的赛事；备份 ${backupDir}`,
  createdAt:now,
} });
const verified = await call('bootstrap');
if (verified.records.length !== next.length || verified.records.some(record => blockedTitleReason(record.name) || blockedTitleReason(record.editionName))) {
  throw new Error('post_delete_verification_failed');
}
console.log(JSON.stringify({ deleted:matches.length, remaining:verified.records.length, version:saved.version, backupDir }, null, 2));
