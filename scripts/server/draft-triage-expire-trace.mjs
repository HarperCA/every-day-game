// 草稿分诊“需要追溯”到期时，只标记待核查事项。证据不足不等于误收。
// 用法：node draft-triage-expire-trace.mjs [--apply]   默认只预演。
import fs from 'node:fs';
import { markOverdueTrace } from './trace-expiry.mjs';
const APPLY = process.argv.includes('--apply');
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const now = new Date();
async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}
const state = await call({ action: 'bootstrap' });
const records = state.records.map(record => markOverdueTrace(record, now));
const changed = records.filter((record, index) => record !== state.records[index]);
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', overdue: changed.map(record => `${record.name}：${record.triage.traceTodo}`) }, null, 2));
if (!APPLY || !changed.length) process.exit(0);
const result = await call({
  action: 'saveRecords', records, expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `draft-triage-expire-trace-${Date.now()}`, action: 'update', objectType: 'event_edition', recordId: 'batch',
    recordName: `追溯逾期标记 ${changed.length} 条`, changedFields: ['qualityIssues'], actor: 'super_admin',
    reason: '草稿分诊“需要追溯”已到期，标记待核查；保留草稿状态', createdAt: now.toISOString(),
  },
});
console.log('saved version', result.version);
