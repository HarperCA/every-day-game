import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {assessIntakeRecord}=require('./functions/adminData/competitionScope.js');
const token=fs.readFileSync('/opt/daily-contest/.admin-token','utf8').trim();
const response=await fetch('http://127.0.0.1:8787/api/adminData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken:token,action:'bootstrap'})});
const result=await response.json();if(!result.ok)throw Error(result.message);
const active=result.data.records.filter(r=>r.dataStatus!=='quarantined');
const rows=active.map(r=>({id:r.id,name:r.name,dataStatus:r.dataStatus,scope:assessIntakeRecord(r),url:r.sources?.[0]?.url}));
const report={at:new Date().toISOString(),version:result.data.stateVersions.records,total:result.data.records.length,active:active.length,quarantined:result.data.records.length-active.length,
  rejected:rows.filter(r=>r.scope.decision==='reject'),incomplete:rows.filter(r=>r.scope.decision==='pending'),eligibleByFields:rows.filter(r=>r.scope.decision==='eligible').length};
const output='/opt/daily-contest/reports/sla-audit-'+Date.now()+'.json';
fs.writeFileSync(output,JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify({output,total:report.total,active:report.active,quarantined:report.quarantined,rejected:report.rejected.length,incomplete:report.incomplete.length,eligibleByFields:report.eligibleByFields,
  definite:report.rejected.filter(r=>/通知|栏目|目录|报道|公示/.test(r.scope.reason)).map(r=>({id:r.id,name:r.name}))},null,2));
