// 修正批次1（辽宁）21条记录的 registrationUrl：原先误填平台首页，
// 改为各自的官方详情页链接（该平台报名动作在详情页完成，是目前能给到的最准确入口）。
import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const now = new Date().toISOString();
const BATCH_TAG = 'curation200-batch1-liaoning-20260922';

async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

const state = await call({ action: 'bootstrap' });
const existing = state.records;
let changed = 0;
const next = existing.map(record => {
  if (record.curationBatch !== BATCH_TAG) return record;
  const officialUrl = record.sources?.find(s => s.source_type === 'organizer_notice')?.url;
  if (!officialUrl || record.registrationUrl === officialUrl) return record;
  changed += 1;
  return { ...record, registrationUrl: officialUrl, lastVerifiedAt: now };
});

if (!changed) { console.log('无需修改'); process.exit(0); }

const result = await call({
  action: 'saveRecords', records: next, expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `${BATCH_TAG}-fix-registrationurl-${Date.now()}`, action: 'update', objectType: 'event_edition', recordId: 'batch',
    recordName: `修正批次1（辽宁）${changed} 条记录的 registrationUrl：由平台首页改为具体详情页链接`,
    changedFields: ['registrationUrl'], actor: 'super_admin',
    reason: '原先误填平台首页，非具体报名入口；改为各自官方详情页链接', createdAt: now,
  },
});
console.log(JSON.stringify({ changed, total: result.saved, version: result.version }, null, 2));
