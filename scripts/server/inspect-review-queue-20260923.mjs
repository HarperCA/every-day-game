// 只读查看待审核队列，不输出管理员令牌。
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const token = (await fs.readFile(path.join(here, '.admin-token'), 'utf8')).trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({adminToken:token,action:'bootstrap'})});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(result.message || `HTTP ${response.status}`);
const state = result.data;
console.log(JSON.stringify({version:state.stateVersions.records, count:state.records.length, statuses:state.records.reduce((o,r)=>(o[r.dataStatus]=(o[r.dataStatus]||0)+1,o),{}), review:state.records.filter(r=>['pending_manual_review','pending_system_validation'].includes(r.dataStatus)).map(r=>({id:r.id,name:r.name,dataStatus:r.dataStatus,status:r.status,registrationUrl:r.registrationUrl,website:r.website,schedule:r.schedule,qualityIssues:r.qualityIssues,sourceUrls:r.sources?.map(s=>s.url)}))},null,2));
