// 移除已核实为校赛的独立记录；保留全国赛。默认仅预览。
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const token = (await fs.readFile(path.join(here, '.admin-token'), 'utf8')).trim();
const targetId = 'edition-anqing-foreign-language-2026';
const parentId = 'edition-cmp028-2026';
async function call(action, data = {}) {
  const response = await fetch('http://127.0.0.1:8787/api/adminData', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({adminToken: token, action, ...data}),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.message || `HTTP ${response.status}`);
  return result.data;
}
const state = await call('bootstrap');
const target = state.records.filter(record => record.id === targetId);
const parent = state.records.filter(record => record.id === parentId);
if (target.length !== 1 || parent.length !== 1) throw new Error('target_or_parent_not_unique');
if (target[0].dataStatus !== 'pending_manual_review' || !target[0].name.includes('校赛') ||
    !parent[0].name.includes('外研社') || parent[0].dataStatus === 'archived') {
  throw new Error('record_identity_changed');
}
const officialPage = 'https://jwc.aqnu.edu.cn/info/1711/26381.htm';
if (!target[0].sources?.some(source => source.url === officialPage)) throw new Error('official_source_missing');
console.log(JSON.stringify({version: state.stateVersions.records, remove: {id: targetId, name: target[0].name, status: target[0].dataStatus}, keep: {id: parentId, name: parent[0].name, status: parent[0].dataStatus}, countBefore: state.records.length}));
if (!process.argv.includes('--apply')) process.exit(0);
const expected = process.argv[process.argv.indexOf('--expect-version') + 1];
if (expected !== String(state.stateVersions.records)) throw new Error('preview_version_changed');
const backupDir = path.join(here, 'backups', `anqing-school-selection-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await fs.mkdir(backupDir, {recursive: true, mode: 0o700});
await fs.writeFile(path.join(backupDir, 'records-before.json'), JSON.stringify(state, null, 2), {mode: 0o600});
const current = await call('bootstrap');
if (current.stateVersions.records !== state.stateVersions.records ||
    JSON.stringify(current.records.find(record => record.id === targetId)) !== JSON.stringify(target[0]) ||
    JSON.stringify(current.records.find(record => record.id === parentId)) !== JSON.stringify(parent[0])) {
  throw new Error('concurrent_change');
}
const now = new Date().toISOString();
await call('saveRecords', {
  records: current.records.filter(record => record.id !== targetId),
  expectedVersion: current.stateVersions.records,
  auditEntry: {id: `remove-anqing-school-selection-${Date.now()}`, action: 'delete', objectType: 'event_edition', recordId: targetId, recordName: target[0].name, actor: 'super_admin', reason: `正式来源为安庆师范大学校赛，全国赛已有独立记录；备份：${backupDir}`, createdAt: now},
});
const after = await call('bootstrap');
if (after.records.some(record => record.id === targetId) || !after.records.some(record => record.id === parentId) || after.records.length !== state.records.length - 1) throw new Error('write_verification_failed');
console.log(JSON.stringify({removed: targetId, retained: parentId, backupDir, countAfter: after.records.length, verified: true}));
