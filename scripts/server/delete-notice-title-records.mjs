import fs from 'node:fs';

const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
async function call(payload) {
  const response = await fetch('http://127.0.0.1:8787/api/adminData', {
    method:'POST', headers:{ 'content-type':'application/json' },
    body:JSON.stringify({ adminToken:token, ...payload }),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

const snapshot = await call({ action:'bootstrap' });
if (!Array.isArray(snapshot.records) || !snapshot.records.length) throw new Error('比赛库为空或读取失败');
const siteSuffix = process.argv.includes('--site-suffix');
const pattern = siteSuffix ? /通知\s*_.*$/ : /通知\s*$/;
const matches = snapshot.records.filter(item => pattern.test(String(item.name || '')));
const summary = matches.map(item => ({ id:item.id, name:item.name, status:item.dataStatus }));
const statuses = Object.fromEntries([...new Set(matches.map(item => item.dataStatus))].map(status => [status, matches.filter(item => item.dataStatus === status).length]));
console.log(JSON.stringify({ total:snapshot.records.length, matched:summary.length, statuses, examples:summary.slice(0, 12), records:process.argv.includes('--list') ? summary : undefined }, null, 2));
if (!process.argv.includes('--apply')) process.exit(0);
if (!matches.length) process.exit(0);
const next = snapshot.records.filter(item => !matches.includes(item));
if (next.length !== snapshot.records.length - matches.length) throw new Error('删除目标计数不一致');
const now = new Date().toISOString();
const result = await call({ action:'saveRecords', records:next, expectedVersion:snapshot.stateVersions.records,
  auditEntry:{ id:`delete-notice-titles-${Date.now()}`, action:'delete', objectType:'event_edition',
    recordId:siteSuffix ? 'batch-notice-site-suffix' : 'batch-notice-title', recordName:siteSuffix ? `通知后附网站栏目后缀的误入库记录 ${matches.length} 条` : `名称以“通知”结尾的赛事 ${matches.length} 条`,
    changedFields:['record_removed'], actor:'super_admin',
    reason:siteSuffix ? '移除通知标题后附网站栏目后缀的误入库记录；删除清单见事前备份' : '按用户要求，完整移除所有赛事名称以“通知”结尾的记录；删除清单见执行日志与事前备份', createdAt:now } });
const manifest = siteSuffix ? '/opt/daily-contest/backups/notice-site-suffix-deleted-20260920.json' : '/opt/daily-contest/backups/notice-title-deleted-20260920.json';
fs.writeFileSync(manifest, JSON.stringify({ deletedAt:now, previousVersion:snapshot.stateVersions.records, nextVersion:result.version, records:summary }, null, 2));
fs.chmodSync(manifest, 0o600);
console.log(JSON.stringify({ removed:matches.length, remaining:result.saved, version:result.version }, null, 2));
