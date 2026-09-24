// 2026-09-24 · 下架两条单校赛事（用户决定）
// 两条都是本校学生才能参加、没有上级赛事的校级比赛，不属于本库收录范围。
// 做法与后台“下架”按钮一致：dataStatus → offline，公开缓存随保存一起删除。
// 用法：node unpublish-school-only-20260924.mjs [--apply]   默认只预演。
import fs from 'node:fs';
const APPLY = process.argv.includes('--apply');
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const nowIso = new Date().toISOString();
const REASON = '单校赛事：仅面向本校学生，无上级赛事，不属于收录范围';
const TARGETS = {
  'edition-hdu-life-science-2026': '2026-09-20T12:55:29.635Z',
  'edition-qingdao-anti-smuggling-creation-2026': '2026-09-20T22:10:21.704Z',
};
async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}
const state = await call({ action: 'bootstrap' });
const byId = new Map(state.records.map(r => [r.id, r]));
for (const [id, updatedAt] of Object.entries(TARGETS)) {
  const r = byId.get(id);
  if (!r) throw new Error(`找不到 ${id}`);
  if (r.updatedAt !== updatedAt) throw new Error(`${r.name} 在核对后被改动过，中止`);
  if (r.dataStatus !== 'published') throw new Error(`${r.name} 当前不是已发布（${r.dataStatus}），中止`);
}
const records = state.records.map(r => !TARGETS[r.id] ? r : {
  ...r,
  dataStatus: 'offline', offlineAt: nowIso, offlineReason: REASON, updatedAt: nowIso, updatedBy: 'super_admin',
  recommendation: { ...r.recommendation, published_cache: false },
});
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', targets: Object.keys(TARGETS).map(id => byId.get(id).name) }));
if (!APPLY) process.exit(0);
fs.writeFileSync('/opt/daily-contest/backups/unpublish-school-only-20260924-before.json', JSON.stringify(Object.keys(TARGETS).map(id => byId.get(id))));
const result = await call({
  action: 'saveRecords', records, expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `unpublish-school-only-${Date.now()}`, action: 'unpublish', objectType: 'event_edition', recordId: 'batch',
    recordName: '下架单校赛事 2 条', changedFields: ['dataStatus', 'offlineAt', 'offlineReason'],
    actor: 'super_admin', reason: REASON, createdAt: nowIso,
  },
});
console.log('saved version', result.version, 'publicCache', result.publicCachePublished ?? '-', result.publicCacheRemoved ?? '-');
