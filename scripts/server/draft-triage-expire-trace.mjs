// 草稿分诊“需要追溯”组的到期出口：traceDue 已过、仍是草稿的条目统一隔离。
//
// 追溯成功的条目会在补正时改变状态（送系统验证/人工审核），不会被这里处理；
// 仍停在 draft 即视为到期未取得赛事当届官方通知原文。隔离可恢复为草稿。
// 用法：node draft-triage-expire-trace.mjs [--apply]   默认只预演。
import fs from 'node:fs';
const APPLY = process.argv.includes('--apply');
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
const due = state.records.filter(r => r.dataStatus === 'draft' && r.triage?.traceDue && Date.parse(r.triage.traceDue) < Date.now());
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', due: due.map(r => `${r.name}：${r.triage.traceTodo}`) }, null, 2));
if (!APPLY || !due.length) process.exit(0);
const ids = new Set(due.map(r => r.id));
const records = state.records.map(r => ids.has(r.id) ? {
  ...r, dataStatus: 'quarantined', manualReview: 'pending', systemValidation: 'not_run',
  recommendation: { ...r.recommendation, published_cache: false, manual_review: 'pending', system_validation: 'not_run' },
  quarantine: { at: nowIso, reason: `追溯到期（${r.triage.traceDue.slice(0, 10)}）仍未取得赛事当届官方通知原文：${r.triage.traceTodo}`, actor: 'draft-triage-expire-trace', ruleVersion: 'quarantine-v1', previousStatus: r.dataStatus, previousReview: { manualReview: r.manualReview, systemValidation: r.systemValidation } },
  updatedAt: nowIso, updatedBy: 'draft-triage-expire-trace',
} : r);
const result = await call({
  action: 'saveRecords', records, expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `draft-triage-expire-trace-${Date.now()}`, action: 'update', objectType: 'event_edition', recordId: 'batch',
    recordName: `追溯到期隔离 ${due.length} 条`, changedFields: ['dataStatus', 'quarantine'], actor: 'super_admin',
    reason: '草稿分诊“需要追溯”组到期仍未取得赛事当届官方通知原文', createdAt: nowIso,
  },
});
console.log('saved version', result.version);
