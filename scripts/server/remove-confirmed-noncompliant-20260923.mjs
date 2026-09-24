// 从赛事库移除确定不符合“独立大学生专业比赛”准入的记录；默认只读预览。
// 完整快照和移出条目（含来源）保存在备份中，可作为待追溯线索恢复。
// node remove-confirmed-noncompliant-20260923.mjs --apply --expect-version N --expect-count N
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const token = (await fs.readFile(path.join(HERE, '.admin-token'), 'utf8')).trim();
const directoryUrls = new Set([
  'https://jyt.fujian.gov.cn/xxgk/zywj/202605/t20260511_7146643.htm',
  'https://cxcyxy.hnust.edu.cn/docs/2026-03/57883ee81d034aefa495c2fab9be1567.pdf',
  'http://www.jsgjxh.cn/newsview/31221',
  'https://www2.scut.edu.cn/_upload/article/files/eb/59/808e406040f989ef6d349c0d8e83/b8c94043-1cf0-41c5-9987-c39717320808.pdf',
]);
const schoolIds = new Set([
  'edition-xmu-engineering-practice-2026',
  'edition-cupk-foreign-language-2026',
  'edition-global-campus-ai-algorithm-2026',
  'edition-challenge-cup-jxut-2026',
  'edition-sichuan-engineering-practice-2026',
  'edition-grad-information-retrieval-2026',
]);
const duplicateParents = new Map([
  ['edition-china-international-innovation-2026', 'edition-cmp001-2026'],
  ['edition-huawei-ict-practice-2026', 'edition-huawei-ict-competition-2026'],
  ['edition-huawei-ict-innovation-2026', 'edition-huawei-ict-competition-2026'],
  ['edition-huawei-ict-programming-2026', 'edition-huawei-ict-competition-2026'],
  ['edition-ai-energy-algorithm-2026', 'edition-global-campus-ai-algorithm-elite-2026'],
]);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
const byId = new Map(records.map(record => [record.id, record]));
const manifest = [];
for (const record of records) {
  let category = '';
  if (['draft','quarantined'].includes(record.dataStatus) && !record.registrationUrl
    && record.sources?.length === 1 && directoryUrls.has(record.sources[0].url)) {
    category = '仅有目录线索，无当届赛事页或报名入口';
  } else if (schoolIds.has(record.id)) {
    if (record.dataStatus !== 'quarantined' || record.parentEventId || !/校级|校内/.test(record.name)) throw new Error(`school_target_changed:${record.id}`);
    category = '校内选拔误作独立赛事';
  } else if (duplicateParents.has(record.id)) {
    const parent = byId.get(duplicateParents.get(record.id));
    if (record.dataStatus !== 'published' || parent?.dataStatus !== 'published') throw new Error(`duplicate_parent_changed:${record.id}`);
    if (record.id === 'edition-china-international-innovation-2026' && (record.name !== parent.name || record.editionName !== parent.editionName)) throw new Error('main_duplicate_identity_changed');
    if (record.id.startsWith('edition-huawei-ict-') && (!record.name.startsWith(`${parent.name}（`) || record.organizer !== parent.organizer || record.registrationUrl !== parent.registrationUrl)) throw new Error(`track_identity_changed:${record.id}`);
    if (record.id === 'edition-ai-energy-algorithm-2026' && (!record.name.startsWith(parent.name) || record.organizer !== parent.organizer)) throw new Error('energy_track_identity_changed');
    category = `已收录主体赛事的重复/赛道；保留 ${parent.id}`;
  }
  if (category) manifest.push({ id:record.id, name:record.name, status:record.dataStatus, category, hash:digest(record), record });
}
const counts = Object.entries(manifest.reduce((acc, item) => (acc[item.category.split('；')[0]] = (acc[item.category.split('；')[0]] || 0) + 1, acc), {}));
const summary = { version, total:records.length, remove:manifest.length, categories:counts,
  directTargets:manifest.filter(item=>!item.category.startsWith('仅有目录')).map(({id,name,status,category})=>({id,name,status,category})) };
console.log(JSON.stringify(summary, null, 2));
if (!process.argv.includes('--apply')) process.exit(0);
if (option('--expect-version') !== String(version) || option('--expect-count') !== String(manifest.length)) throw new Error('preview_changed_or_missing_expectation');
if (manifest.length !== 181 || manifest.filter(item=>item.category.startsWith('仅有目录')).length !== 170) throw new Error('unexpected_target_count');
if (new Set(manifest.map(item=>item.id)).size !== manifest.length) throw new Error('duplicate_target_id');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(HERE, 'backups', `noncompliant-removed-${stamp}`);
await fs.mkdir(backupDir, {recursive:true, mode:0o700});
await fs.writeFile(path.join(backupDir, 'records-before.json'), JSON.stringify(snapshot, null, 2), {mode:0o600});
await fs.writeFile(path.join(backupDir, 'removed-records-and-leads.json'), JSON.stringify({summary, manifest}, null, 2), {mode:0o600});
console.log(`完整备份及线索清单：${backupDir}`);

let deleted = 0;
for (let offset = 0; offset < manifest.length; offset += 25) {
  const batch = manifest.slice(offset, offset + 25);
  const current = await call('bootstrap');
  for (const item of batch) {
    const found = current.records.filter(record => record.id === item.id);
    if (found.length !== 1 || digest(found[0]) !== item.hash) throw new Error(`target_changed_stop:${item.id}`);
  }
  const ids = new Set(batch.map(item => item.id));
  const next = current.records.filter(record => !ids.has(record.id));
  if (next.length !== current.records.length - batch.length) throw new Error('unexpected_removed_count');
  await call('saveRecords', { records:next, expectedVersion:current.stateVersions.records, auditEntry:{
    id:`remove-confirmed-noncompliant-${Date.now()}-${offset}`, action:'delete', objectType:'event_edition',
    recordId:'batch', recordName:`移除不合格赛事记录 ${batch.length} 条`, changedFields:['record_removed'],
    actor:'super_admin', reason:`用户要求移出不符合准入的比赛；逐条身份和完整备份：${backupDir}`,
    createdAt:new Date().toISOString(),
  }});
  const after = await call('bootstrap');
  if (after.records.length !== next.length || after.records.some(record => ids.has(record.id))) throw new Error(`post_delete_verification_failed:${offset}`);
  deleted += batch.length;
  console.log(JSON.stringify({batch:offset / 25 + 1, deleted, remaining:after.records.length, verified:true}));
}
console.log(JSON.stringify({removed:deleted, backupDir, verified:true}));
