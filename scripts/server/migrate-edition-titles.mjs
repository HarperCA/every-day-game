// 一次性、可重跑的全库年份/届次拆分。默认只读预览，不调用 AI。
// 用法：node migrate-edition-titles.mjs --apply --expect-version N --expect-changes N
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { normalizeEditionTitle, titleHasEditionTokens } = require(path.join(HERE, 'cjs', 'editionTitle.js'));
const { toPublicCache } = require(path.join(HERE, 'functions', 'adminData', 'publicCache.js'));
const apply = process.argv.includes('--apply');
const option = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
};
const token = (await fs.readFile(path.join(HERE, '.admin-token'), 'utf8')).trim();
const apiBase = process.env.API_BASE || 'http://127.0.0.1:8787';
async function call(action, data = {}) {
  const response = await fetch(`${apiBase}/api/adminData`, {
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
const manifest = [];
const next = records.map((record, index) => {
  const metadata = normalizeEditionTitle(record);
  const changed = metadata.name !== record.name
    || metadata.editionYear !== String(record.editionYear || '')
    || metadata.editionOrdinal !== String(record.editionOrdinal || '');
  if (!changed) return record;
  if (!metadata.name || titleHasEditionTokens(metadata.name)) throw new Error(`无法规范化标题：${record.id} ${record.name}`);
  const updated = {...record, name:metadata.name, editionYear:metadata.editionYear, editionOrdinal:metadata.editionOrdinal};
  if (['published','archived'].includes(record.dataStatus)) toPublicCache(updated);
  manifest.push({index, id:record.id, before:record.name, after:updated.name, editionYear:updated.editionYear, editionOrdinal:updated.editionOrdinal, status:record.dataStatus, issues:metadata.issues});
  return updated;
});
const summary = { version, total:records.length, changes:manifest.length,
  nameChanges:manifest.filter(item => item.before !== item.after).length,
  yearFilled:manifest.filter(item => item.editionYear).length,
  ordinalFilled:manifest.filter(item => item.editionOrdinal).length,
  needsManualClarification:manifest.filter(item => item.issues.length).length };
console.log(JSON.stringify({...summary, clarification:manifest.filter(item => item.issues.length)}, null, 2));
if (!apply || !manifest.length) process.exit(0);
if (option('--expect-version') !== String(version) || option('--expect-changes') !== String(manifest.length)) throw new Error('preview_changed_or_missing_expectation');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(HERE, 'backups', `edition-title-migration-${stamp}`);
await fs.mkdir(backupDir, {recursive:true, mode:0o700});
await fs.writeFile(path.join(backupDir, 'records-before.json'), JSON.stringify(snapshot, null, 2), {mode:0o600});
await fs.writeFile(path.join(backupDir, 'migration-manifest.json'), JSON.stringify({summary, manifest}, null, 2), {mode:0o600});
console.log(`整库备份和迁移清单：${backupDir}`);

const saved = await call('saveRecords', {records:next, expectedVersion:version, auditEntry:{
  id:`edition-title-migration-${Date.now()}`, action:'update', objectType:'event_edition',
  recordId:'batch', recordName:`年份与届次从赛事标题拆分 ${manifest.length} 条`,
  changedFields:['name','editionYear','editionOrdinal'], actor:'super_admin',
  reason:`赛事标题仅保留正文，年份与第几届进入独立字段；无 AI 调用；整库备份 ${backupDir}`,
  createdAt:new Date().toISOString(),
}});
const verified = await call('bootstrap');
if (verified.records.length !== records.length) throw new Error('post_migration_count_mismatch');
for (const item of manifest) {
  const record = verified.records[item.index];
  if (!record || record.id !== item.id || record.name !== item.after || record.editionYear !== item.editionYear || record.editionOrdinal !== item.editionOrdinal) {
    throw new Error(`post_migration_verification_failed:${item.index}`);
  }
}
console.log(JSON.stringify({...summary, savedVersion:saved.version, backupDir, verified:true}, null, 2));
