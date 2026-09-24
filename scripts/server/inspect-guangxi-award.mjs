import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({adminToken:token,action:'bootstrap'}) });
const result = await response.json();
if (!result.ok) throw new Error(result.message);
const rows = result.data.records.filter(x => /广西财经学院.*测绘/.test(x.name));
console.log(JSON.stringify({records:rows,audits:(result.data.audits || []).filter(x => rows.some(r => x.recordId===r.id) || /百度|直接入库|批量/.test(`${x.reason} ${x.recordName}`)).slice(0,20)},null,2));
