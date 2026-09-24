import fs from 'node:fs';

const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', {
  method:'POST', headers:{ 'content-type':'application/json' },
  body:JSON.stringify({ adminToken:token, action:'bootstrap' }),
});
const result = await response.json();
if (!result.ok) throw new Error(result.message || 'bootstrap failed');
const rows = result.data.records || [];
const start = Date.parse('2026-09-23T16:00:00Z');
const end = Date.parse('2026-09-24T16:00:00Z');
const inToday = value => { const time = Date.parse(value || ''); return Number.isFinite(time) && time >= start && time < end; };
const created = rows.filter(row => inToday(row.createdAt));
const firstSeen = rows.filter(row => inToday(row.firstSeenAt));
const audits = (result.data.audits || []).filter(item => inToday(item.createdAt));
const crawlerAudits = audits.filter(item => /抓取入库|ingest-/i.test(`${item.recordName || ''} ${item.id || ''}`));
const summarize = items => ({ count:items.length, byStatus:Object.fromEntries([...new Set(items.map(item => item.dataStatus))].map(status => [status, items.filter(item => item.dataStatus === status).length])), items:items.map(item => ({ id:item.id, name:item.name, status:item.dataStatus, createdAt:item.createdAt, firstSeenAt:item.firstSeenAt })) });
console.log(JSON.stringify({ day:'2026-09-24 Asia/Shanghai', currentTotal:rows.length, version:result.data.stateVersions?.records, createdAtToday:summarize(created), firstSeenToday:summarize(firstSeen), crawlerAudits:crawlerAudits.map(item => ({ id:item.id, recordName:item.recordName, createdAt:item.createdAt })) }, null, 2));
