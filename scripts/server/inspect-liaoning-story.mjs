import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, action:'bootstrap' }) });
const result = await response.json();
if (!result.ok) throw new Error(result.message);
for (const record of result.data.records.filter(item => /辽宁故事/.test(item.name))) {
  console.log(JSON.stringify({ id:record.id, name:record.name, status:record.dataStatus, registrationUrl:record.registrationUrl, sources:record.sources, aiReview:record.aiReview, lastVerifiedAt:record.lastVerifiedAt }, null, 2));
}
