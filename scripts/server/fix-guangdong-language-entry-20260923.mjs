// 把赛事官网首页改为实际“选手报名”页；只改一条记录。
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));const token=(await fs.readFile(path.join(here,'.admin-token'),'utf8')).trim();
async function call(action,data={}){const r=await fetch('http://127.0.0.1:8787/api/adminData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken:token,action,...data})});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.message||`HTTP ${r.status}`);return j.data}
const state=await call('bootstrap');const id='edition-guangdong-no5',old=state.records.find(x=>x.id===id);
if(state.records.filter(x=>x.id===id).length!==1||old.registrationUrl!=='https://ucc.fltrp.com/'||old.dataStatus!=='draft')throw new Error('target_changed');
const entry='https://stu-ucc.fltrp.com/uchallenge/signUp.html';const r=await fetch(entry,{redirect:'follow',signal:AbortSignal.timeout(15000)});const h=await r.text();if(r.status!==200||r.url!==entry||!h.includes('报名'))throw new Error('entry_unverified');
console.log(JSON.stringify({version:state.stateVersions.records,id,oldUrl:old.registrationUrl,newUrl:entry,httpStatus:r.status,finalUrl:r.url}));
if(!process.argv.includes('--apply'))process.exit(0);if(process.argv[process.argv.indexOf('--expect-version')+1]!==String(state.stateVersions.records))throw new Error('preview_changed');
const backupDir=path.join(here,'backups',`guangdong-language-entry-${new Date().toISOString().replace(/[:.]/g,'-')}`);await fs.mkdir(backupDir,{recursive:true,mode:0o700});await fs.writeFile(path.join(backupDir,'records-before.json'),JSON.stringify(state,null,2),{mode:0o600});
const current=await call('bootstrap');if(current.stateVersions.records!==state.stateVersions.records||JSON.stringify(current.records.find(x=>x.id===id))!==JSON.stringify(old))throw new Error('concurrent_change');const now=new Date().toISOString();
const next=current.records.map(x=>x.id===id?{...x,registrationUrl:entry,updatedAt:now,updatedBy:'manual-official-entry-verification'}:x);
await call('saveRecords',{records:next,expectedVersion:current.stateVersions.records,auditEntry:{id:`fix-guangdong-language-entry-${Date.now()}`,action:'update',objectType:'event_edition',recordId:id,recordName:old.name,changedFields:['registrationUrl'],actor:'super_admin',reason:`官方赛事主页“校赛选手入口”实际跳转地址已核验；备份：${backupDir}`,createdAt:now}});
const after=await call('bootstrap');if(after.records.find(x=>x.id===id)?.registrationUrl!==entry)throw new Error('write_verification_failed');console.log(JSON.stringify({updated:id,entry,verified:true,backupDir}));
