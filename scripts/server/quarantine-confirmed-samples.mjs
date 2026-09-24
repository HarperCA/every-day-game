import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {isolateMisimport}=require('./functions/adminData/quarantine.js');
const token=fs.readFileSync('/opt/daily-contest/.admin-token','utf8').trim();
async function call(body){const r=await fetch('http://127.0.0.1:8787/api/adminData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken:token,...body})});const j=await r.json();if(!j.ok)throw Error(j.message);return j.data;}
const state=await call({action:'bootstrap'});
const selected=state.records.filter(r=>/广西财经学院.*测绘|有哪些学科竞赛|送你一份全国大学生/.test(r.name));
const changes=selected.map(r=>isolateMisimport(r)).filter(r=>r.dataStatus==='quarantined' && selected.find(x=>x.id===r.id).dataStatus!=='quarantined');
console.log(JSON.stringify({preview:changes.map(r=>({id:r.id,name:r.name,reason:r.quarantine.reason}))},null,2));
if(!process.argv.includes('--apply')||!changes.length)process.exit(0);
const backup='/opt/daily-contest/backups/quarantine-samples-'+Date.now()+'.json';
fs.writeFileSync(backup,JSON.stringify({records:selected,version:state.stateVersions.records},null,2),{mode:0o600});
const records=state.records.map(r=>changes.find(c=>c.id===r.id)||r);
await call({action:'saveRecords',records,expectedVersion:state.stateVersions.records,auditEntry:{id:'quarantine-'+Date.now(),action:'update',objectType:'event_edition',recordId:'batch',recordName:'用户确认的新闻与清单误收样本',changedFields:['dataStatus','quarantine'],actor:'super_admin',reason:'可恢复隔离，不永久删除；备份 '+backup,createdAt:new Date().toISOString()}});
const after=await call({action:'bootstrap'});
if(changes.some(c=>after.records.find(r=>r.id===c.id)?.dataStatus!=='quarantined'))throw Error('readback_failed');
console.log(JSON.stringify({isolated:changes.length,backup,verified:true}));
