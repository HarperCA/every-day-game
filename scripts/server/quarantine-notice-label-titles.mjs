// 把「栏目标签式通知标题」的记录隔离为线索。
//
// 用户 2026-09-23 指出库里混进了「竞赛通知丨"共同关切"——2026全国大学生花园
// 设计建造竞赛【社区花园赛道】」——标题本身就是一篇通知，不是赛事条目。
// 查下来是 isNoticeTitle 的漏洞：原先只认「赛事通知：」一种写法，不认
// 「竞赛通知」这个标签，也不认 丨(U+4E28) 这种分隔符。规则已修（见
// noticeResolution.js），这里清理规则修复前已经入库的存量。
//
// 用隔离而不是删除：赛事名就在标题后半截，这是有效线索，
// 追溯出赛事本身后可以按正常流程恢复为草稿。
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isNoticeTitle, isNonEventTitle } = require('./cjs/noticeResolution.js');
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const now = new Date().toISOString();

async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

const state = await call({ action: 'bootstrap' });
const targets = state.records.filter(r => r.dataStatus !== 'quarantined' && (isNoticeTitle(r.name) || isNonEventTitle(r.name)));
if (!targets.length) { console.log('没有需要隔离的记录'); process.exit(0); }
console.log(JSON.stringify(targets.map(t => ({ id: t.id, name: t.name, status: t.dataStatus })), null, 2));

const ids = new Set(targets.map(t => t.id));
const next = state.records.map(record => ids.has(record.id) ? {
  ...record,
  dataStatus: 'quarantined',
  quarantine: {
    at: now,
    reason: '标题为栏目标签式通知（如「竞赛通知丨…」），是一篇通知而非赛事条目；赛事名需从标题后半截追溯',
    actor: 'curation-notice-label-fix',
    ruleVersion: 'notice-label-v1',
    previousStatus: record.dataStatus,
    previousReview: { manualReview: record.manualReview, systemValidation: record.systemValidation },
  },
} : record);

const result = await call({
  action: 'saveRecords', records: next, expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `quarantine-notice-label-${Date.now()}`, action: 'archive', objectType: 'event_edition', recordId: 'batch',
    recordName: `隔离 ${targets.length} 条栏目标签式通知记录`,
    changedFields: ['dataStatus'], actor: 'super_admin',
    reason: 'isNoticeTitle 漏掉「竞赛通知丨」这类标签+分隔符写法，规则已修；清理规则修复前入库的存量，保留为线索可恢复', createdAt: now,
  },
});
console.log(JSON.stringify({ quarantined: targets.length, version: result.version }, null, 2));
