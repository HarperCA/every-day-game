import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, action:'bootstrap' }) });
const result = await response.json();
if (!result.ok) throw new Error(result.message);
console.log(JSON.stringify(result.data.records.filter(item => /福建省教育厅|省级大学生学科专业竞赛项目/.test(item.name)).map(item => ({ id:item.id, name:item.name, status:item.dataStatus, registrationUrl:item.registrationUrl, sources:item.sources, qualityIssues:item.qualityIssues, updatedBy:item.updatedBy })), null, 2));
