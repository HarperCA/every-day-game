import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
async function call(payload) {
  const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, ...payload }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message);
  return result.data;
}
const snapshot = await call({ action:'bootstrap' });
const patterns = [/^大赛动态$/, /^国赛公告$/, /^通知公告$/, /^前沿之声\|5月学术资讯速递$/, /^竞赛分类[:：]$/, /全省普通高校本专科生学科竞赛省级赛事目录的公示/, /河南工程学院A、B、C类学科竞赛目录清单/, /附件 福建省2026年大学生学科专业竞赛项目目录/, /AI赋能千行百业超级联赛人工智能\+广电视听创新应用大赛决赛在京举行/];
const matches = snapshot.records.filter(item => patterns.some(pattern => pattern.test(String(item.name || '').trim())));
console.log(JSON.stringify({ total:snapshot.records.length, matched:matches.length, names:Object.fromEntries([...new Set(matches.map(item => item.name))].map(name => [name, matches.filter(item => item.name === name).length])), statuses:Object.fromEntries([...new Set(matches.map(item => item.dataStatus))].map(status => [status, matches.filter(item => item.dataStatus === status).length])) }, null, 2));
if (!process.argv.includes('--apply')) process.exit(0);
if (matches.length !== 20 || matches.some(item => item.dataStatus !== 'draft')) throw new Error('核对清单已变化，拒绝删除');
const next = snapshot.records.filter(item => !matches.includes(item));
const now = new Date().toISOString();
const result = await call({ action:'saveRecords', records:next, expectedVersion:snapshot.stateVersions.records,
  auditEntry:{ id:`delete-non-events-${Date.now()}`, action:'delete', objectType:'event_edition', recordId:'batch-non-events', recordName:'栏目、目录与赛后资讯误入库草稿20条', changedFields:['record_removed'], actor:'super_admin', reason:'按已核实的标题和来源清理非单场赛事草稿；事前备份与清单已保存', createdAt:now } });
const manifest = '/opt/daily-contest/backups/non-events-deleted-20260920.json';
fs.writeFileSync(manifest, JSON.stringify({ deletedAt:now, previousVersion:snapshot.stateVersions.records, nextVersion:result.version, records:matches.map(item => ({ id:item.id, name:item.name, url:item.registrationUrl, status:item.dataStatus })) }, null, 2));
fs.chmodSync(manifest, 0o600);
console.log(JSON.stringify({ removed:matches.length, remaining:result.saved, version:result.version }, null, 2));
