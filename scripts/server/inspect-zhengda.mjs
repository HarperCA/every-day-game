import fs from 'node:fs';
const token=fs.readFileSync('/opt/daily-contest/.admin-token','utf8').trim();
const result=await fetch('http://127.0.0.1:8787/api/adminData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'bootstrap',adminToken:token})}).then(r=>r.json());
if(!result.ok) throw new Error(result.message);
const matches=result.data.records.filter(r=>/市场调查|正大杯/.test(JSON.stringify([r.name,r.aliases])));
fs.mkdirSync('/opt/daily-contest/backups/zhengda-17-2026',{recursive:true});
fs.writeFileSync('/opt/daily-contest/backups/zhengda-17-2026/before.json',JSON.stringify(result.data,null,2));
console.log(JSON.stringify({version:result.data.stateVersions.records,matches},null,2));
