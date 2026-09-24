// 清理触发「标题规则」的存量记录：标题是宣传/报道式写法（含感叹号、
// 「正式启动」等），不是赛事条目本身。赛事名就在标题里，属有效线索，
// 隔离而非删除，追溯出赛事本身后可恢复。
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blockedTitleReason } = require('./cjs/noticeResolution.js');
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const now = new Date().toISOString();
async function call(b) {
  const res = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...b }) });
  const j = await res.json(); if (!j.ok) throw new Error(j.message); return j.data;
}
const state = await call({ action: 'bootstrap' });
const targets = state.records.filter(r => r.dataStatus !== 'quarantined' && blockedTitleReason(r.name));
if (!targets.length) { console.log('无需清理'); process.exit(0); }
console.log(JSON.stringify(targets.map(t => ({ name: t.name, status: t.dataStatus, reason: blockedTitleReason(t.name) })), null, 2));
const ids = new Set(targets.map(t => t.id));
const next = state.records.map(r => ids.has(r.id) ? {
  ...r, dataStatus: 'quarantined',
  quarantine: { at: now, reason: blockedTitleReason(r.name), actor: 'curation-title-rule-fix', ruleVersion: 'blocked-title-v1', previousStatus: r.dataStatus, previousReview: { manualReview: r.manualReview, systemValidation: r.systemValidation } },
} : r);
const result = await call({ action: 'saveRecords', records: next, expectedVersion: state.stateVersions.records, auditEntry: {
  id: `quarantine-blocked-title-${Date.now()}`, action: 'archive', objectType: 'event_edition', recordId: 'batch',
  recordName: `隔离 ${targets.length} 条宣传/报道式标题记录`, changedFields: ['dataStatus'], actor: 'super_admin',
  reason: '标题含感叹号或「正式启动」等活动报道用语，按 blockedTitleReason 规则不得作为赛事条目；保留为线索可恢复', createdAt: now } });
console.log(JSON.stringify({ quarantined: targets.length, version: result.version }, null, 2));
