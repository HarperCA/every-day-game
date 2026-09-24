// 仅恢复 2026-09-23 误移出的 170 条目录来源记录；默认预览。
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const token = (await fs.readFile(path.join(here,'.admin-token'),'utf8')).trim();
const backup = JSON.parse(await fs.readFile(path.join(here,'backups/noncompliant-removed-2026-09-23T11-22-18-131Z/removed-records-and-leads.json'),'utf8'));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function call(action,data={}) {
  const response = await fetch('http://127.0.0.1:8787/api/adminData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken:token,action,...data})});
  const result=await response.json();
  if (!response.ok || !result.ok) throw new Error(result.message||`adminData ${response.status}`);
  return result.data;
}
const entries=backup.manifest.filter(item=>item.category==='仅有目录线索，无当届赛事页或报名入口');
if(entries.length!==170 || new Set(entries.map(item=>item.id)).size!==170) throw new Error('unexpected_backup_targets');
for(const item of entries) if(digest(item.record)!==item.hash) throw new Error(`backup_hash_mismatch:${item.id}`);
const snapshot=await call('bootstrap');
const idSet=new Set(snapshot.records.map(item=>item.id));
const nameSet=new Set(snapshot.records.map(item=>item.name));
const duplicateIds=entries.filter(item=>idSet.has(item.id)).map(item=>item.id);
const duplicateNames=entries.filter(item=>nameSet.has(item.name)).map(item=>item.name);
console.log(JSON.stringify({version:snapshot.stateVersions.records,current:snapshot.records.length,restore:entries.length,duplicateIds,duplicateNames,
  status:entries.reduce((out,item)=>(out[item.status]=(out[item.status]||0)+1,out),{})},null,2));
if(!process.argv.includes('--apply')) process.exit(0);
const versionArg=process.argv[process.argv.indexOf('--expect-version')+1];
if(String(snapshot.stateVersions.records)!==versionArg || duplicateIds.length || duplicateNames.length) throw new Error('preview_changed');
const restoreDir=path.join(here,'backups',`directory-leads-restored-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await fs.mkdir(restoreDir,{recursive:true,mode:0o700});
await fs.writeFile(path.join(restoreDir,'records-before.json'),JSON.stringify(snapshot,null,2),{mode:0o600});
await fs.writeFile(path.join(restoreDir,'restored-ids.json'),JSON.stringify(entries.map(item=>({id:item.id,name:item.name,hash:item.hash})),null,2),{mode:0o600});
let restored=0;
for(let offset=0;offset<entries.length;offset+=25){
  const batch=entries.slice(offset,offset+25);
  const current=await call('bootstrap');
  const existingIds=new Set(current.records.map(item=>item.id));
  const existingNames=new Set(current.records.map(item=>item.name));
  for(const item of batch) if(existingIds.has(item.id)||existingNames.has(item.name)) throw new Error(`duplicate_before_restore:${item.id}`);
  const next=[...current.records,...batch.map(item=>item.record)];
  await call('saveRecords',{records:next,expectedVersion:current.stateVersions.records,auditEntry:{
    id:`restore-directory-leads-${Date.now()}-${offset}`,action:'create',objectType:'event_edition',recordId:'batch',
    recordName:`恢复目录来源记录 ${batch.length} 条`,changedFields:['record_restored'],actor:'super_admin',
    reason:`用户要求恢复此前误移出的 170 条；原备份及本次清单：${restoreDir}`,createdAt:new Date().toISOString()}});
  const after=await call('bootstrap');
  if(after.records.length!==next.length) throw new Error(`count_mismatch:${offset}`);
  for(const item of batch){const found=after.records.find(record=>record.id===item.id);if(!found||digest(found)!==item.hash)throw new Error(`restore_mismatch:${item.id}`)}
  restored+=batch.length;
  console.log(JSON.stringify({batch:Math.floor(offset/25)+1,restored,remaining:after.records.length,verified:true}));
}
console.log(JSON.stringify({restored,restoreDir,verified:true}));
