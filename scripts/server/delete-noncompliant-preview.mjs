import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {assessIntakeRecord}=require('./functions/adminData/competitionScope.js');
const token=fs.readFileSync('/opt/daily-contest/.admin-token','utf8').trim();
async function call(body){const response=await fetch('http://127.0.0.1:8787/api/adminData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken:token,...body})});const result=await response.json();if(!result.ok)throw Error(result.message);return result.data;}
const state=await call({action:'bootstrap'});
const stamp=Date.now();
const snapshot='/opt/daily-contest/backups/noncompliant-before-'+stamp+'.json';
fs.writeFileSync(snapshot,JSON.stringify(state,null,2),{mode:0o600});
console.log(JSON.stringify({snapshot,version:state.stateVersions.records,total:state.records.length,rows:state.records.map(r=>({id:r.id,name:r.name,status:r.dataStatus,scope:assessIntakeRecord(r),reason:r.quarantine?.reason,url:r.sources?.[0]?.url})).filter(r=>r.status==='quarantined'||r.scope.decision!=='eligible')},null,2));
