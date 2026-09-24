// 一次性清理已明确过报名截止日、却仍未归档的历史记录。
import fs from 'node:fs';

const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
async function call(body) {
  const response = await fetch('http://127.0.0.1:8787/api/adminData', {
    method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, ...body }),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

const state = await call({ action:'bootstrap' });
if (!Array.isArray(state.records) || !state.records.length) throw new Error('拒绝覆盖空库');
const now = new Date();
const archived = [];
const records = state.records.map(record => {
  if (record.dataStatus === 'archived' || record.dataStatus === 'offline') return record;
  const end = record.schedule?.registration_end;
  if (!end || !Number.isFinite(Date.parse(end)) || Date.parse(end) >= now.getTime()) return record;
  archived.push({ id:record.id, name:record.name, end });
  return {
    ...record,
    dataStatus:'archived', archivedAt:now.toISOString(), archivedReason:'registration_closed',
    schedule:{ ...record.schedule, status_override:'已截止', status_override_reason:'报名截止时间已过' },
    updatedAt:now.toISOString(), updatedBy:'direct-expiry-review',
  };
});
if (!archived.length) { console.log('无待归档记录'); process.exit(0); }
const result = await call({ action:'saveRecords', records, expectedVersion:state.stateVersions.records, auditEntry:{
  id:`direct-archive-${Date.now()}`, action:'archive', objectType:'event_edition', recordId:'batch',
  recordName:`已过报名截止日归档 ${archived.length} 条`, changedFields:['dataStatus','schedule.status_override'],
  reason:'根据已有报名截止时间归档，并清除过期的报名中覆盖', createdAt:now.toISOString(),
} });
console.log(JSON.stringify({ archived, total:result.saved, version:result.version }, null, 2));
