// 2026-09-24 · 非草稿记录的枚举值归位（草稿已在 draft-triage-20260924 中处理）
//
// 只做同义归位，不新增事实：
//   赛事级别  省级/市级→省级/区域级；校级、国家级赛事校赛/校内选拔→其他/未明确；国际级保留
//   奖励亮点  证书类→证书荣誉，奖金类→现金奖金，实习/奖杯等归入对应项；作品展示、晋级资格等无对应项的删去
//   队伍人数  按分类原值或组队原文归入合法选项，判断不了的填“暂未明确”
//   报名组织  “暂未公布”→“暂未明确”；“……个人/团队报名”且未提学校组织→自行报名；
//             明确学校统一组织/报送→学校统一报名；个人与学校两种都写了→两种方式均可；其余→暂未明确
//   费用类型  分阶段收费→收费（费用原文保留在 fees）
// 原值写入 enumNormalization.previous，可逐条回滚。
// 用法：node enum-cleanup-20260924.mjs [--apply]   默认只预演。
import fs from 'node:fs';
const APPLY = process.argv.includes('--apply');
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const nowIso = new Date().toISOString();
const RULE = 'enum-cleanup-20260924';
async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}
const plan = JSON.parse(fs.readFileSync(new URL('./enum-cleanup-20260924-plan.json', import.meta.url)));
const state = await call({ action: 'bootstrap' });
const byId = new Map(state.records.map(r => [r.id, r]));
const stale = plan.filter(p => { const r = byId.get(p.id); return !r || (r.updatedAt || null) !== p.updatedAt; });
if (stale.length) throw new Error(`以下记录在方案生成后已被改动，中止：\n${stale.map(p => p.name).join('\n')}`);

const changes = new Map(plan.map(p => [p.id, p.changes]));
const records = state.records.map(r => {
  const ch = changes.get(r.id);
  if (!ch) return r;
  const next = { ...r, enumNormalization: { rule: RULE, at: nowIso, previous: Object.fromEntries(Object.entries(ch).map(([k, [before]]) => [k, before])) } };
  for (const [k, [, after]] of Object.entries(ch)) next[k] = after;
  return next;
});
const counts = {}; for (const p of plan) counts[p.status] = (counts[p.status] || 0) + 1;
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', records: plan.length, byStatus: counts }));
if (!APPLY) process.exit(0);
fs.writeFileSync('/opt/daily-contest/backups/enum-cleanup-20260924-before.json', JSON.stringify(plan.map(p => byId.get(p.id))));
const result = await call({
  action: 'saveRecords', records, expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `${RULE}-${Date.now()}`, action: 'update', objectType: 'event_edition', recordId: 'batch',
    recordName: `非草稿记录枚举归位 ${plan.length} 条`,
    changedFields: ['eventLevel', 'rewardHighlights', 'teamSizeCategory', 'registrationOrganization', 'participationFormat', 'feeType'],
    actor: 'super_admin', reason: '把不在合法选项内的自由文本归位到管理端与小程序筛选使用的枚举值，只做同义归位不新增事实', createdAt: nowIso,
  },
});
console.log('saved version', result.version, 'publicCache', result.publicCachePublished ?? '-', result.publicCacheRemoved ?? '-');
