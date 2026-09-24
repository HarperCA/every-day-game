// 仅将旧周检笼统提示替换为取证/日期/名称/链接的具体待办。默认只读预览。
// node reclassify-weekly-verification.mjs --apply --expect-version N --expect-changes N
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { LEGACY_ISSUE, classifyFieldVerificationIssues, replaceFieldVerificationIssues } = require(path.join(HERE, 'cjs', 'fieldVerificationIssues.js'));
const { toPublicCache } = require(path.join(HERE, 'functions', 'adminData', 'publicCache.js'));
const token = (await fs.readFile(path.join(HERE, '.admin-token'), 'utf8')).trim();
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
async function call(action, data = {}) {
  const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({adminToken:token, action, ...data}) });
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
  if (!(record.qualityIssues || []).some(issue => String(issue).includes(LEGACY_ISSUE))) return record;
  if (!record.fieldVerification) throw new Error(`missing_field_verification:${record.id}`);
  const issues = classifyFieldVerificationIssues(record, record.fieldVerification);
  if (!issues.length) throw new Error(`unclassified_weekly_issue:${record.id}`);
  const updated = { ...record, qualityIssues:replaceFieldVerificationIssues(record.qualityIssues, issues), needsManualReview:true };
  if (['published','archived'].includes(record.dataStatus)) toPublicCache(updated);
  manifest.push({ index, id:record.id, name:record.name, status:record.dataStatus, issues });
  return updated;
});
const summary = { version, total:records.length, changes:manifest.length,
  sourceUnreadable:manifest.filter(x=>x.issues.some(issue=>issue.includes('来源正文未能读取'))).length,
  startDateUnsupported:manifest.filter(x=>x.issues.some(issue=>issue.includes('报名开始时间在库中有精确日期'))).length,
  endDateUnsupported:manifest.filter(x=>x.issues.some(issue=>issue.includes('报名截止时间在库中有精确日期'))).length,
  nameUnconfirmed:manifest.filter(x=>x.issues.some(issue=>issue.includes('赛事名称未获来源确认'))).length,
  urlUnconfirmed:manifest.filter(x=>x.issues.some(issue=>issue.includes('链接未获来源确认'))).length };
console.log(JSON.stringify(summary, null, 2));
if (!process.argv.includes('--apply') || !manifest.length) process.exit(0);
if (option('--expect-version') !== String(version) || option('--expect-changes') !== String(manifest.length)) throw new Error('preview_changed_or_missing_expectation');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(HERE, 'backups', `weekly-verification-reclassify-${stamp}`);
await fs.mkdir(backupDir, {recursive:true, mode:0o700});
await fs.writeFile(path.join(backupDir, 'records-before.json'), JSON.stringify(snapshot, null, 2), {mode:0o600});
await fs.writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify({summary, manifest}, null, 2), {mode:0o600});
console.log(`备份及逐条分类清单：${backupDir}`);
const saved = await call('saveRecords', { records:next, expectedVersion:version, auditEntry:{
  id:`weekly-verification-reclassify-${Date.now()}`, action:'update', objectType:'event_edition',
  recordId:'batch', recordName:`周检存量问题分类 ${manifest.length} 条`,
  changedFields:['qualityIssues'], actor:'super_admin',
  reason:`仅替换笼统周检问题文案，不修改赛事事实字段、不调用 AI；备份 ${backupDir}`,
  createdAt:new Date().toISOString(),
}});
const verified = await call('bootstrap');
if (verified.records.length !== records.length) throw new Error('post_migration_count_mismatch');
for (const item of manifest) {
  const actual = verified.records[item.index];
  if (!actual || actual.id !== item.id || actual.qualityIssues.some(issue => String(issue).includes(LEGACY_ISSUE)) || !item.issues.every(issue => actual.qualityIssues.includes(issue))) {
    throw new Error(`post_migration_verification_failed:${item.index}`);
  }
}
console.log(JSON.stringify({...summary, savedVersion:saved.version, backupDir, verified:true}, null, 2));
