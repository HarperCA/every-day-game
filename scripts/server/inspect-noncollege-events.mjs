import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, action:'bootstrap' }) });
const result = await response.json();
if (!result.ok) throw new Error(result.message);
const pattern = /中学生|中小学|初中|高中|小学生|青少年|少儿|儿童|中职/;
const rows = result.data.records.filter(item => pattern.test([item.name,item.participants,item.eligibility].filter(Boolean).join(' ')));
console.log(JSON.stringify({ total:result.data.records.length, matched:rows.length, rows:rows.map(item => ({ id:item.id, name:item.name, status:item.dataStatus, participants:item.participants, eligibility:item.eligibility, source:item.sources?.[0]?.url })) }, null, 2));
