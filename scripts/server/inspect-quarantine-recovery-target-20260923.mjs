// 只读检查首个隔离恢复候选及同名记录。
import fs from 'node:fs/promises';
const token = (await fs.readFile('/opt/daily-contest/.admin-token', 'utf8')).trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({adminToken:token, action:'bootstrap'})});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(result.message || `HTTP ${response.status}`);
const target = result.data.records.find(record => record.id === 'edition-hunan-grad-law-case-2026');
const related = result.data.records.filter(record => /湖南省.*研究生.*法律案例大赛/.test(record.name || ''));
console.log(JSON.stringify({version:result.data.stateVersions.records,target,related:related.map(record=>({id:record.id,name:record.name,dataStatus:record.dataStatus,registrationEnd:record.schedule?.registration_end}))},null,2));
