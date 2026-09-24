import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, action:'bootstrap' }) });
const result = await response.json();
if (!result.ok) throw new Error(result.message);
console.log(JSON.stringify(result.data.records.filter(item => /荣成学院|跨境电商赛道/.test(item.name)).map(item => ({ id:item.id, name:item.name, editionName:item.editionName, dataStatus:item.dataStatus, registrationUrl:item.registrationUrl, sources:item.sources })), null, 2));
