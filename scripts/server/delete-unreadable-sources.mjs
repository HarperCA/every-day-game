import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {assessIntakeRecord}=require('./functions/adminData/competitionScope.js');
const baseline=JSON.parse(fs.readFileSync('/opt/daily-contest/backups/noncompliant-before-1790088631048.json','utf8'));
const key=r=>JSON.stringify([r.id,r.name]);
const hash=r=>createHash('sha256').update(JSON.stringify(r)).digest('hex');
// Reproduce the exact previously reported 64-record population, not a new broad deletion filter.
const unreadable=/robots|403|超时|不可达|无法访问|无法读取|读取失败|读取被|正文为空|正文仅|通用导航|导航与页脚/;
const originals=baseline.records.filter(r=>r.dataStatus==='quarantined'||assessIntakeRecord(r).decision!=='eligible').filter(r=>unreadable.test(assessIntakeRecord(r).reason+' '+(r.quarantine?.reason||'')+' '+(r.aiReview?.summary||'')));
if(originals.length!==64)throw Error('原清单不再对应64条，拒绝扩大删除范围');
const token=fs.readFileSync('/opt/daily-contest/.admin-token','utf8').trim();
async function call(body){const response=await fetch('http://127.0.0.1:8787/api/adminData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken:token,...body})});const result=await response.json();if(!result.ok)throw Error(result.message);return result.data;}
const current=await call({action:'bootstrap'});
const targets=[],skipped=[];
for(const original of originals){
 if(original.id==='edition-fujian-gjs202602'){skipped.push({id:original.id,name:original.name,reason:'统计误归类：正文可读但只有目录依据，不属于本次指定的来源不可读类别'});continue;}
 const matches=current.records.filter(r=>key(r)===key(original));
 if(matches.length!==1){skipped.push({id:original.id,name:original.name,reason:matches.length?'匹配不唯一':'已不在库'});continue;}
 const record=matches[0];
 if(hash(record)!==hash(original)){skipped.push({id:record.id,name:record.name,reason:'记录在统计后有变更，暂不删除'});continue;}
 targets.push(record);
}
console.log(JSON.stringify({total:current.records.length,original:64,toDelete:targets.length,skipped,preview:targets.map(r=>({id:r.id,name:r.name,review:r.aiReview?.summary}))},null,2));
if(!process.argv.includes('--apply'))process.exit(0);
const stamp=Date.now();
const backup='/opt/daily-contest/backups/unreadable-sources-before-'+stamp+'.json';
fs.writeFileSync(backup,JSON.stringify(current,null,2),{mode:0o600});
const manifest='/opt/daily-contest/backups/unreadable-sources-deleted-'+stamp+'.json';
const ledger={backup,records:targets,skipped,batches:[]};
fs.writeFileSync(manifest,JSON.stringify(ledger,null,2),{mode:0o600});
for(let offset=0;offset<targets.length;offset+=25){
 const batch=targets.slice(offset,offset+25),state=await call({action:'bootstrap'}),keys=new Set(batch.map(key));
 const found=state.records.filter(r=>keys.has(key(r)));
 if(found.length!==batch.length||found.some(r=>!batch.some(t=>key(t)===key(r)&&hash(t)===hash(r))))throw Error('批次目标发生变化，停止删除');
 const records=state.records.filter(r=>!keys.has(key(r)));
 const result=await call({action:'saveRecords',records,expectedVersion:state.stateVersions.records,auditEntry:{id:'delete-unreadable-'+stamp+'-'+offset,action:'delete',objectType:'event_edition',recordId:'batch',recordName:'删除来源正文无法核验记录 '+batch.length+' 条',changedFields:['record_removed'],actor:'super_admin',reason:'用户明确要求删除此前64条来源不可读取/仅导航页脚记录；完整备份及清单 '+manifest,createdAt:new Date().toISOString()}});
 const after=await call({action:'bootstrap'});
 if(after.records.some(r=>keys.has(key(r))))throw Error('写后核验失败');
 ledger.batches.push({removed:batch.length,remaining:after.records.length,version:result.version,verified:true});
 fs.writeFileSync(manifest,JSON.stringify(ledger,null,2),{mode:0o600});
 console.log(JSON.stringify(ledger.batches.at(-1)));
}
console.log(JSON.stringify({removed:targets.length,skipped:skipped.length,backup,manifest}));
