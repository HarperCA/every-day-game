// 草稿分诊后续：3条归档记录只有报名截止日期、没有开始日期。
// publicQuery/publicCache 的 registrationStatus 在缺开始日期时一律返回“时间待公布”，
// 不看截止日期是否已过，导致这几条已截止的往届在学生端默认视图里显示为“时间待公布”。
// 截止日期有原文依据，这里用 status_override=已截止 表达；代码层面的判定顺序另行修复。
import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const nowIso = new Date().toISOString();
async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}
const state = await call({ action: 'bootstrap' });
const targets = state.records.filter(r => ['published', 'archived'].includes(r.dataStatus) && !r.schedule?.registration_start
  && r.schedule?.registration_end && Date.parse(r.schedule.registration_end) < Date.now() && !r.schedule?.status_override);
if (!targets.length) { console.log('无需处理'); process.exit(0); }
const ids = new Set(targets.map(r => r.id));
const records = state.records.map(r => ids.has(r.id)
  ? { ...r, schedule: { ...r.schedule, status_override: '已截止' }, updatedAt: nowIso, updatedBy: 'draft-triage-20260924' }
  : r);
const result = await call({
  action: 'saveRecords', records, expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `draft-triage-closed-override-${Date.now()}`, action: 'update', objectType: 'event_edition', recordId: 'batch',
    recordName: `${targets.length}条仅有截止日期的往届记录标为已截止`, changedFields: ['schedule'], actor: 'super_admin',
    reason: '报名截止日期有原文依据且已过，但缺开始日期时状态计算会落到“时间待公布”', createdAt: nowIso,
  },
});
console.log(JSON.stringify({ updated: targets.map(r => `${r.name}（截止${r.schedule.registration_end.slice(0, 10)}）`), version: result.version }, null, 2));
