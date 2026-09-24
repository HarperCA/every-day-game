import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({adminToken:token,action:'bootstrap'}) });
const result = await response.json();
if (!result.ok) throw new Error(result.message);
console.log(JSON.stringify(result.data.records.filter(x => /有哪些学科竞赛|送你一份全国大学生/.test(x.name)).map(x => ({id:x.id,name:x.name,dataStatus:x.dataStatus,firstSeenAt:x.firstSeenAt,updatedAt:x.updatedAt,updatedBy:x.updatedBy,aiReview:x.aiReview,manualReview:x.manualReview,systemValidation:x.systemValidation,admissionVerdict:x.admissionVerdict,qualityIssues:x.qualityIssues})),null,2));
