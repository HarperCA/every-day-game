import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {isolateMisimport}=require('./functions/adminData/quarantine.js');
const token=fs.readFileSync('/opt/daily-contest/.admin-token','utf8').trim();
async function call(body){const r=await fetch('http://127.0.0.1:8787/api/adminData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken:token,...body})});const j=await r.json();if(!j.ok)throw Error(j.message);return j.data;}
const state=await call({action:'bootstrap'});
const changes=state.records.map((record,index)=>({record,index,updated:isolateMisimport(record)})).filter(x=>x.record!==x.updated).slice(0,25);
console.log(JSON.stringify({preview:changes.map(x=>({id:x.record.id,name:x.record.name,reason:x.updated.quarantine.reason}))},null,2));
if(!process.argv.includes('--apply')||!changes.length)process.exit(0);
const backup='/opt/daily-contest/backups/quarantine-clear-'+Date.now()+'.json';
fs.writeFileSync(backup,JSON.stringify({records:state.records,version:state.stateVersions.records},null,2),{mode:0o600});
// Historical IDs are not all unique. Match by snapshot position, never by ID alone.
const records=state.records.map((r,index)=>changes.find(x=>x.index===index)?.updated||r);
await call({action:'saveRecords',records,expectedVersion:state.stateVersions.records,auditEntry:{id:'quarantine-'+Date.now(),action:'update',objectType:'event_edition',recordId:'batch',recordName:'隔离明确非赛事条目 '+changes.length+' 条',changedFields:['dataStatus','quarantine'],actor:'super_admin',reason:'依据逐条预览隔离目录、新闻、通知等；原始快照 '+backup,createdAt:new Date().toISOString()}});
const after=await call({action:'bootstrap'});
if(changes.some(x=>!after.records.some(r=>r.id===x.record.id&&r.name===x.record.name&&r.dataStatus==='quarantined')))throw Error('readback_failed');
console.log(JSON.stringify({isolated:changes.length,backup,verified:true}));
