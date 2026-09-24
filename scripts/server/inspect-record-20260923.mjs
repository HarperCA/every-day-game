// 只读输出指定记录和规范名近似重复项；不输出管理员口令。
import fs from 'node:fs/promises';
const id = process.argv[2];
if (!id) throw new Error('record_id_required');
const token = (await fs.readFile('/opt/daily-contest/.admin-token', 'utf8')).trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken:token,action:'bootstrap'})});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(result.message || `HTTP ${response.status}`);
const target = result.data.records.find(record => record.id === id);
if (!target) throw new Error('record_not_found');
const compact = value => String(value || '').replace(/(?:19|20)\d{2}/g,'').replace(/第[零〇一二三四五六七八九十百千万两\d]+届/g,'').replace(/[\s（）()“”"'·—–-]/g,'');
const key = compact(target.name);
const related = result.data.records.filter(record => record.id !== id && (compact(record.name).includes(key) || key.includes(compact(record.name))));
console.log(JSON.stringify({version:result.data.stateVersions.records,target,related:related.map(record=>({id:record.id,name:record.name,dataStatus:record.dataStatus,registrationEnd:record.schedule?.registration_end}))},null,2));
