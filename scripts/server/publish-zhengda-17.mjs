import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { requirePublishGate, toPublicCache } = require('/opt/daily-contest/functions/adminData/publicCache.js');
const adminToken = fs.readFileSync('/opt/daily-contest/.admin-token','utf8').trim();
const directory = '/opt/daily-contest/backups/zhengda-17-2026';
const patch = JSON.parse(fs.readFileSync(`${directory}/patch.json`,'utf8'));
const id = 'edition-cssc-market-survey-17';
async function call(action, extra={}) {
  const response=await fetch('http://127.0.0.1:8787/api/adminData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken,action,...extra})});
  const result=await response.json();
  if(!response.ok || !result.ok) throw new Error(result.message || `http_${response.status}`);
  return result.data;
}
for(let attempt=0;attempt<3;attempt++) {
  const snapshot=await call('bootstrap');
  const before=snapshot.records.find(r=>r.id===id);
  if(!before || before.eventId!=='event-cmp024' || before.editionOrdinal!=='第十七届') throw new Error('record_identity_changed');
  const candidate={...before,...patch,schedule:{...before.schedule,...patch.schedule}};
  requirePublishGate(candidate);
  const expectedPublic=toPublicCache(candidate);
  if(expectedPublic.registration_status!=='报名中') throw new Error('unexpected_registration_status');
  fs.writeFileSync(`${directory}/apply-before-${attempt}.json`,JSON.stringify(snapshot,null,2));
  fs.writeFileSync(`${directory}/record-after.json`,JSON.stringify(candidate,null,2));
  try {
    const saved=await call('saveRecords',{expectedVersion:snapshot.stateVersions.records,records:snapshot.records.map(r=>r.id===id?candidate:r),auditEntry:{id:`zhengda17-${Date.now()}`,action:'update',objectType:'event_edition',recordId:id,recordName:before.name,createdAt:new Date().toISOString(),reason:'用户要求发布第十七届正大杯：实际已存在，补正大杯别名并核对当届官方报名入口、日期、专业不限资格；避免重复新增。备份 /opt/daily-contest/backups/zhengda-17-2026'}});
    fs.writeFileSync(`${directory}/receipt.json`,JSON.stringify({id,saved,expectedPublic},null,2));
    console.log(JSON.stringify({id,saved,status:expectedPublic.registration_status,aliases:candidate.aliases,registrationUrl:candidate.registrationUrl,registrationEnd:candidate.schedule.registration_end}));
    break;
  } catch(error) { if(attempt===2 || !/version|conflict|版本|冲突/i.test(error.message)) throw error; }
}
