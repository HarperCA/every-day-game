// 移出未核验的搜索结果草稿。默认预览，--apply 时先完整备份。
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const token = (await fs.readFile(path.join(here, '.admin-token'), 'utf8')).trim();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function call(action, data={}) {
  const response = await fetch('http://127.0.0.1:8787/api/adminData', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({adminToken:token, action, ...data})});
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.message || `adminData ${response.status}`);
  return result.data;
}
const snapshot = await call('bootstrap');
const target = snapshot.records.filter(record => record.dataStatus === 'draft'
  && record.id.startsWith('edition-direct-baidu-')
  && record.sources?.length === 1
  && record.sources[0].source_type === 'search_candidate'
  && record.sources[0].validity_status === 'unreachable'
  && !record.organizer && !record.participants && !record.eligibility);
const summary = {version:snapshot.stateVersions.records, total:snapshot.records.length, remove:target.length,
  records:target.map(record=>({id:record.id,name:record.name,url:record.sources[0].url}))};
console.log(JSON.stringify(summary,null,2));
if (!process.argv.includes('--apply')) process.exit(0);
const versionArg = process.argv[process.argv.indexOf('--expect-version')+1];
if (String(summary.version) !== versionArg || target.length !== 13) throw new Error('preview_changed');
const backupDir = path.join(here,'backups',`search-only-leads-removed-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await fs.mkdir(backupDir,{recursive:true,mode:0o700});
await fs.writeFile(path.join(backupDir,'records-before.json'),JSON.stringify(snapshot,null,2),{mode:0o600});
await fs.writeFile(path.join(backupDir,'removed-records.json'),JSON.stringify(target,null,2),{mode:0o600});
const current = await call('bootstrap');
if (current.stateVersions.records !== summary.version) throw new Error('version_changed');
const currentHashes = new Map();
for (const record of current.records) currentHashes.set(hash(record),(currentHashes.get(hash(record))||0)+1);
for (const record of target) {
  const key = hash(record);
  if (!currentHashes.get(key)) throw new Error(`target_changed:${record.id}`);
  currentHashes.set(key,currentHashes.get(key)-1);
}
const ids = new Set(target.map(item=>item.id));
const next = current.records.filter(item=>!ids.has(item.id));
if (next.length !== current.records.length - target.length) throw new Error('unexpected_removed_count');
await call('saveRecords',{records:next,expectedVersion:summary.version,auditEntry:{
  id:`remove-search-only-leads-${Date.now()}`,action:'delete',objectType:'event_edition',recordId:'batch',
  recordName:'移出未核验搜索结果草稿 13 条',changedFields:['record_removed'],actor:'super_admin',
  reason:`无主办方、参赛资格及已核验来源，用户要求移出不符合准入记录；备份：${backupDir}`,
  createdAt:new Date().toISOString()}});
const after = await call('bootstrap');
if (after.records.length!==next.length || after.records.some(item=>ids.has(item.id))) throw new Error('post_delete_verification_failed');
console.log(JSON.stringify({removed:target.length,remaining:after.records.length,backupDir,verified:true}));
