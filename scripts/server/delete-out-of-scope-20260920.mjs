import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isClearlyOutOfScope } = require('./cjs/competitionScope.js');
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
async function call(payload) {
  const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, ...payload }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message);
  return result.data;
}
const snapshot = await call({ action:'bootstrap' });
const matches = snapshot.records.filter(isClearlyOutOfScope);
console.log(JSON.stringify({ total:snapshot.records.length, matches:matches.map(item => ({ id:item.id, name:item.name, status:item.dataStatus })) }, null, 2));
if (!process.argv.includes('--apply')) process.exit(0);
if (matches.length < 15 || matches.length > 45) throw new Error('清理范围异常，拒绝删除');
const now = new Date().toISOString();
const next = snapshot.records.filter(item => !matches.includes(item));
const result = await call({ action:'saveRecords', records:next, expectedVersion:snapshot.stateVersions.records,
  auditEntry:{ id:`delete-out-of-scope-${Date.now()}`, action:'delete', objectType:'event_edition', recordId:'batch-out-of-scope', recordName:`非大学生专业赛事 ${matches.length} 条`, changedFields:['record_removed'], actor:'super_admin', reason:'清理中小学、青少年及兴趣体育活动；事前已备份', createdAt:now } });
const manifest = '/opt/daily-contest/backups/out-of-scope-deleted-20260920.json';
fs.writeFileSync(manifest, JSON.stringify({ deletedAt:now, previousVersion:snapshot.stateVersions.records, nextVersion:result.version, records:matches }, null, 2));
fs.chmodSync(manifest, 0o600);
console.log(JSON.stringify({ removed:matches.length, remaining:result.saved, version:result.version }, null, 2));
