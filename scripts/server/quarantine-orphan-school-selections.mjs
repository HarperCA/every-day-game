import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isolateMisimport } = require('./cjs/quarantine.js');
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const pattern = /校级(?:选拔赛|初赛)|校内(?:选拔赛|初赛|赛)|院级(?:选拔赛|初赛)|学院选拔赛/;
async function call(body) {
  const response = await fetch(api, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken:token,...body})});
  const result = await response.json();
  if (!result.ok) throw Error(result.message || 'adminData_failed');
  return result.data;
}
const state = await call({action:'bootstrap'});
const targets = state.records.filter(r => pattern.test(r.name || '') && !r.parentEventId && r.dataStatus !== 'quarantined');
console.log(JSON.stringify({version:state.stateVersions.records,count:targets.length,targets:targets.map(r=>({id:r.id,name:r.name,status:r.dataStatus}))},null,2));
if (!process.argv.includes('--apply') || !targets.length) process.exit(0);
const now = new Date().toISOString();
const backup = `/opt/daily-contest/backups/orphan-school-selections-${Date.now()}.json`;
fs.writeFileSync(backup,JSON.stringify({version:state.stateVersions.records,records:state.records,targets},null,2),{mode:0o600,flag:'wx'});
const ids = new Set(targets.map(r=>r.id));
const next = state.records.map(r=>ids.has(r.id) ? isolateMisimport(r,now) : r);
await call({action:'saveRecords',records:next,expectedVersion:state.stateVersions.records,auditEntry:{
  id:`quarantine-orphan-school-selections-${Date.now()}`,action:'update',objectType:'event_edition',recordId:'batch',
  recordName:`隔离未关联父赛事的校级/校内/院级选拔 ${targets.length} 条`,changedFields:['dataStatus','manualReview','systemValidation','quarantine'],actor:'super_admin',
  reason:`修复赛事身份筛选：下级选拔不得作为独立比赛发布；完整备份：${backup}`,createdAt:now,
}});
const after=await call({action:'bootstrap'});
const failed=after.records.filter(r=>ids.has(r.id)&&r.dataStatus!=='quarantined');
if(failed.length) throw Error(`隔离后核验失败：${failed.map(r=>r.id).join(',')}`);
console.log(JSON.stringify({verified:true,quarantined:targets.length,version:after.stateVersions.records,backup}));
