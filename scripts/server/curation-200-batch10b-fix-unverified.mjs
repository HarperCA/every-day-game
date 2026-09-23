// 2026-09-23 · 修正批次9/10中未在原文核到的字段：“没找到就不要写进去”
//
// 外教社杯：章程只写校赛“2026年5-9月/4-10月”，原先推成 start=4月1日；报名方式、
// 奖项、参赛资格有几处不是原文表述（按38页章程重核后改写）。
// 睿抗：盖章通知只写报名“2026年4月—7月”，原先推成4月1日至7月31日。按通知报名期
// 已过，用 status_override=已截止 表达，而不是编造起止日。
//
// 字段值直接取自已提交的 batch9/batch10 entries.json，保持脚本与库一致。
import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const now = new Date().toISOString();

async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

const sflep = JSON.parse(fs.readFileSync(new URL('./curation-200-batch9-entries.json', import.meta.url)))[0];
const raicom = JSON.parse(fs.readFileSync(new URL('./curation-200-batch10-entries.json', import.meta.url))).find(e => e.key === 'raicom-robot-developer-2026');
const fixes = {
  'edition-sflep-ict-competition-9': { entry: sflep, override: null },
  'edition-raicom-robot-developer-2026': { entry: raicom, override: raicom.statusOverride },
};

const state = await call({ action: 'bootstrap' });
const existing = state.records;
if (!Array.isArray(existing) || !existing.length) throw new Error('拒绝覆盖空库');
const missing = Object.keys(fixes).filter(id => !existing.some(r => r.id === id));
if (missing.length) throw new Error(`找不到记录：${missing.join('、')}`);

const next = existing.map(record => {
  const fix = fixes[record.id];
  if (!fix) return record;
  const { entry, override } = fix;
  return {
    ...record,
    participants: entry.eligibility,
    eligibility: entry.eligibility,
    participationFormat: entry.participationFormat,
    registrationMethod: entry.registrationMethod,
    registrationOrganization: entry.registrationOrganization,
    rewardHighlights: entry.rewardHighlights,
    rewards: entry.rewards,
    schedule: { ...record.schedule, registration_start: entry.start, registration_end: entry.end, pending_announcement: !entry.end, status_override: override },
    qualityIssues: entry.issues,
    recommendation: { ...record.recommendation, missing_information: entry.issues },
  };
});

const result = await call({
  action: 'saveRecords', records: next, expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `curation200-fix-unverified-${Date.now()}`, action: 'update', objectType: 'event_edition', recordId: 'batch',
    recordName: '修正2条记录中未在原文核到的字段',
    changedFields: ['schedule', 'eligibility', 'participants', 'registrationMethod', 'registrationOrganization', 'rewards', 'rewardHighlights', 'participationFormat', 'qualityIssues'],
    actor: 'super_admin',
    reason: '外教社杯、睿抗的报名起止日期系由“X月—Y月”推断，原文无具体日期，改为留空；外教社杯报名方式、奖项、参赛资格按章程原文重写', createdAt: now,
  },
});
for (const id of Object.keys(fixes)) {
  const r = next.find(x => x.id === id);
  console.log(JSON.stringify({ id, name: r.name, start: r.schedule.registration_start, end: r.schedule.registration_end, override: r.schedule.status_override, registrationOrganization: r.registrationOrganization }));
}
console.log('version', result.version);
