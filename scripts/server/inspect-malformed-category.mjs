import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, action:'bootstrap' }) });
const result = await response.json();
if (!result.ok) throw new Error(result.message);
const records = result.data.records.filter(item => /竞赛分类|赛分类|&#x7ADE;|&[#a-z]/i.test(`${item.name} ${item.editionName}`));
console.log(JSON.stringify(records.map(item => ({ id:item.id, eventId:item.eventId, name:item.name, editionName:item.editionName, dataStatus:item.dataStatus, firstSeenAt:item.firstSeenAt, updatedAt:item.updatedAt, updatedBy:item.updatedBy, registrationUrl:item.registrationUrl, sources:item.sources, qualityIssues:item.qualityIssues, admissionVerdict:item.admissionVerdict, objectiveTags:item.objectiveTags, organizer:item.organizer, auditKeys:Object.keys(item).filter(key => /audit|crawl|search|extract/i.test(key)) })), null, 2));
