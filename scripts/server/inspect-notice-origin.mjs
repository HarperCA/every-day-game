import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, action:'bootstrap' }) });
const result = await response.json();
if (!result.ok) throw new Error(result.message);
const rows = result.data.records.filter(item => /通知\s*$/.test(String(item.name || '')));
const count = values => Object.fromEntries([...new Set(values)].map(value => [value, values.filter(item => item === value).length]));
console.log(JSON.stringify({
  total:rows.length,
  idPrefix:count(rows.map(item => item.id?.startsWith('edition-direct-baidu-') ? '百度候选直接入库' : item.id?.startsWith('edition-search-') ? '抓取流水线' : '其他')),
  updatedBy:count(rows.map(item => item.updatedBy || '未更新')),
  sourceType:count(rows.map(item => item.sources?.[0]?.source_type || '无')),
  audits:(result.data.audits || []).filter(item => /抓取入库|直接入库候选|通知/.test(item.recordName || '')).slice(0, 15).map(item => ({ action:item.action, recordName:item.recordName, createdAt:item.createdAt, reason:item.reason })),
}, null, 2));
