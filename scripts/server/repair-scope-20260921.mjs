import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { classifyCompetitionScope } = require('./cjs/competitionScope.js');
const base = '/opt/daily-contest';
const candidates = JSON.parse(fs.readFileSync(`${base}/runs/2026-09-20T17-00-12-696Z/combined-candidates.json`, 'utf8')).candidates;
const replay = candidates.map(candidate => ({ name:candidate.name, url:candidate.detailUrl, ...classifyCompetitionScope(candidate) }));
console.log('replay', JSON.stringify({ total:replay.length, counts:replay.reduce((out, item) => ({ ...out, [item.decision]:(out[item.decision] || 0) + 1 }), {}) }));
fs.writeFileSync(`${base}/reports/scope-replay-20260921.json`, JSON.stringify(replay, null, 2));
const token = fs.readFileSync(`${base}/.admin-token`, 'utf8').trim();
async function call(payload) {
  const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, ...payload }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message);
  return result.data;
}
const state = await call({ action:'bootstrap' });
const targets = state.records.filter(record => record.firstSeenAt === '2026-09-20T17:12:27.892Z' && classifyCompetitionScope(record).decision !== 'eligible');
console.log('cleanup', JSON.stringify(targets.map(record => ({ id:record.id, name:record.name, status:record.dataStatus, scope:classifyCompetitionScope(record) }))));
if (!process.argv.includes('--apply')) process.exit(0);
if (targets.length !== 10 || targets.some(record => record.dataStatus !== 'draft')) throw new Error('清理目标发生变化');
fs.writeFileSync(`${base}/backups/scope-quarantine-20260921.json`, JSON.stringify({ version:state.stateVersions.records, records:targets }, null, 2), { mode:0o600 });
const result = await call({ action:'saveRecords', records:state.records.filter(record => !targets.includes(record)), expectedVersion:state.stateVersions.records,
  auditEntry:{ id:`scope-cleanup-${Date.now()}`, action:'delete', objectType:'event_edition', recordId:'scope-cleanup-20260921', recordName:'清理今日10条范围不符或资格未证实的草稿', changedFields:['record_removed'], actor:'super_admin', reason:'按用户要求清理非大学生专业比赛；完整原始记录已隔离保存供追溯', createdAt:new Date().toISOString() } });
console.log('saved', JSON.stringify(result));
const after = await call({ action:'bootstrap' });
console.log('verified', JSON.stringify({ count:after.records.length, remaining:after.records.filter(record => record.firstSeenAt === '2026-09-20T17:12:27.892Z').length }));
