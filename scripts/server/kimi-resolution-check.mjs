import fs from 'node:fs';
const adminToken = fs.readFileSync('/opt/daily-contest/.admin-token','utf8').trim();
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const directory = '/opt/daily-contest/backups/kimi-resolution';
fs.mkdirSync(directory,{recursive:true});
async function call(action, extra = {}) {
  const response = await fetch('http://127.0.0.1:8787/api/adminData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken,action,...extra})});
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || JSON.stringify(result));
  return result.data;
}
const snapshot = await call('bootstrap');
const file = `${directory}/${stamp}-before.json`;
fs.writeFileSync(file,JSON.stringify(snapshot,null,2));
const counts = records => records.reduce((out,record) => ({...out,[record.dataStatus]:(out[record.dataStatus] || 0)+1}),{});
console.log(JSON.stringify({backup:file,version:snapshot.stateVersions?.records,count:snapshot.records.length,statuses:counts(snapshot.records)}));
if (process.argv.includes('--fix-date-only')) {
  const id = 'edition-huairou-ai-science-opc-2026';
  const record = snapshot.records.find(item => item.id === id);
  const before = record?.schedule?.registration_end;
  if (!record || !/未公布具体时刻/.test(record.schedule.time_note || '') || !/^\d{4}-\d{2}-\d{2}T00:00:00\+08:00$/.test(before || '')) throw new Error('date_only_repair_precondition_failed');
  const after = before.slice(0,10);
  const at = new Date().toISOString();
  const records = snapshot.records.map(item => item.id === id ? {...item,schedule:{...item.schedule,registration_end:after},updatedAt:at,updatedBy:'system:date-only-normalization'} : item);
  const saved = await call('saveRecords',{ records,expectedVersion:snapshot.stateVersions.records,auditEntry:{id:`date-only-${Date.now()}`,action:'update',objectType:'event_schedule',recordId:id,recordName:record.name,createdAt:at,changedFields:['registrationEnd'],changes:{registrationEnd:{before,after}},reason:'官方只公布截止日期，未公布具体时刻；移除自动补出的零点，用北京时间截止日结束计算，避免过早归档。'} });
  console.log(JSON.stringify({dateOnlyRepair:{id,before,after},saved}));
  const publicResult = await fetch('http://127.0.0.1:8787/api/publicData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'get',id})}).then(response => response.json());
  console.log(JSON.stringify({publicReceipt:publicResult}));
}
if (process.argv.includes('--run')) {
  const target = process.argv.find(arg => arg.startsWith('--target='))?.slice(9);
  const run = await call('runScheduledAiReview',target ? { recordIds:[target] } : {});
  console.log(JSON.stringify({run}));
  const after = await call('bootstrap');
  const afterFile = `${directory}/${stamp}-after.json`;
  fs.writeFileSync(afterFile,JSON.stringify(after,null,2));
  console.log(JSON.stringify({after:afterFile,version:after.stateVersions?.records,count:after.records.length,statuses:counts(after.records)}));
}
