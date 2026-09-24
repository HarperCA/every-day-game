import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {assessIntakeRecord}=require('./functions/adminData/competitionScope.js');
const snapshotPath='/opt/daily-contest/backups/noncompliant-before-1790087322527.json';
const snapshot=JSON.parse(fs.readFileSync(snapshotPath,'utf8'));
const exact=new Set(['兰州城市学院创新创业学院','中国机械工程学会','张家口学院关于举办','教育部关于举办中国国际大学生','山西省物理学会','公告公示',
  '2026年7-8月举办的部分省级行业企业职业技能竞赛信息公告','2026年7月至8月举办的部分省级行业企业职业技能竞赛信息公告','2026年9—10月举办的部分省级行业企业职业技能竞赛信息公告',
  '江西省第二届高层次人才创新创业大赛生物医药专题赛复赛在我市开赛','智创青春 赛启新程 ——人工智能学院参加中国国际大学生创新大赛(2026)校级决赛',
  '报名通知 | 2026年第五届“医+X”融合创新校内赛','学校举办大学生创新大赛2026校级选拔赛']);
const key=r=>JSON.stringify([r.id,r.name]);
const digest=r=>createHash('sha256').update(JSON.stringify(r)).digest('hex');
const targets=snapshot.records.filter(r=>{
  const s=assessIntakeRecord(r);
  return exact.has(r.name)||(s.decision==='reject'&&/通知|栏目|目录|报道|公示/.test(s.reason));
});
console.log(JSON.stringify({count:targets.length,preview:targets.map(r=>({id:r.id,name:r.name,status:r.dataStatus}))},null,2));
if(!process.argv.includes('--apply'))process.exit(0);
const token=fs.readFileSync('/opt/daily-contest/.admin-token','utf8').trim();
async function call(body){const response=await fetch('http://127.0.0.1:8787/api/adminData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken:token,...body})});const result=await response.json();if(!result.ok)throw Error(result.message);return result.data;}
const stamp=Date.now();
const manifest='/opt/daily-contest/backups/noncompliant-deleted-'+stamp+'.json';
const ledger={snapshotPath,requestedAt:new Date().toISOString(),records:targets,batches:[]};
fs.writeFileSync(manifest,JSON.stringify(ledger,null,2),{mode:0o600});
for(let offset=0;offset<targets.length;offset+=25){
  const batch=targets.slice(offset,offset+25);
  const state=await call({action:'bootstrap'});
  const keys=new Set(batch.map(key));
  const found=state.records.filter(r=>keys.has(key(r)));
  if(found.length!==batch.length||found.some(r=>!batch.some(t=>key(t)===key(r)&&digest(t)===digest(r))))throw Error('目标已变化，停止删除，请重新核验');
  const next=state.records.filter(r=>!keys.has(key(r)));
  const out=await call({action:'saveRecords',records:next,expectedVersion:state.stateVersions.records,auditEntry:{id:'delete-noncompliant-'+stamp+'-'+offset,action:'delete',objectType:'event_edition',recordId:'batch',recordName:'完整删除已核实非赛事 '+found.length+' 条',changedFields:['record_removed'],actor:'super_admin',reason:'用户要求清除不符合标准的记录；逐条清单和完整备份：'+manifest,createdAt:new Date().toISOString()}});
  const after=await call({action:'bootstrap'});
  if(after.records.some(r=>keys.has(key(r))))throw Error('删除后读取核验失败');
  ledger.batches.push({deleted:found.length,version:out.version,remaining:after.records.length,verified:true});
  fs.writeFileSync(manifest,JSON.stringify(ledger,null,2),{mode:0o600});
  console.log(JSON.stringify(ledger.batches.at(-1)));
}
console.log(JSON.stringify({removed:targets.length,manifest}));
