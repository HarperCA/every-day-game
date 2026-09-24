import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, action:'bootstrap' }) });
const result = await response.json();
if (!result.ok) throw new Error(result.message);
const names = new Set(['大赛动态','国赛公告','通知公告']);
console.log(JSON.stringify(result.data.records.filter(item => names.has(String(item.name || '').trim())).map(item => ({ id:item.id, name:item.name, status:item.dataStatus, url:item.registrationUrl, sources:item.sources?.map(source => ({ url:source.url, type:source.source_type, validity:source.validity_status, official:source.is_official })), qualityIssues:item.qualityIssues, updatedBy:item.updatedBy })), null, 2));
