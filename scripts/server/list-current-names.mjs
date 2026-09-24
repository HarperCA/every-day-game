import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, action:'bootstrap' }) });
const result = await response.json();
if (!result.ok) throw new Error(result.message);
console.log(result.data.records.map((item, index) => `${index + 1}\t${item.dataStatus}\t${item.name}`).join('\n'));
