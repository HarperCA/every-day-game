// 给批次5（中国研究生创新实践系列大赛）17条记录补报名起止时间。
//
// 写入时我把这些标成了「报名起止时间待补：平台赛事主页未统一呈现」——那是我
// 读漏了。各赛事主页上就有「赛程安排 Competition Schedule」表，报名行写得很
// 明确，例如「报名 2026年03月20日 - 2026年06月30日」。17 条全部有，不是没公布。
//
// 时间取自官网赛程表原文，逐条回查核对过；北京时间，截止日按当日 23:59 计。
// 同时把对应的 qualityIssue 去掉——问题已经解决，留着就是假的待办。
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

// key -> [报名开始, 报名截止, 官网赛程表原文]
const SCHEDULE = JSON.parse(fs.readFileSync(new URL('./curation-200-batch5-schedule.json', import.meta.url)));
const byKey = new Map(SCHEDULE.map(s => [`edition-${s.key}`, s]));

const state = await call({ action: 'bootstrap' });
let touched = 0;
const next = state.records.map(record => {
  const s = byKey.get(record.id);
  if (!s || !s.start) return record;
  const start = `${s.start}T00:00:00+08:00`;
  const end = `${s.end}T23:59:00+08:00`;
  if (record.schedule?.registration_start === start && record.schedule?.registration_end === end) return record;
  touched += 1;
  return {
    ...record,
    schedule: { ...record.schedule, registration_start: start, registration_end: end, pending_announcement: false },
    registrationMethod: `通过中国研究生创新实践系列大赛管理平台注册并报名，官网赛程表载明报名时间为 ${s.start} 至 ${s.end}。`,
    // 时间已补齐，去掉对应的待办；其余待办（费用）保留
    qualityIssues: (record.qualityIssues || []).filter(issue => !issue.startsWith('报名起止时间待补')),
    recommendation: {
      ...record.recommendation,
      missing_information: (record.recommendation?.missing_information || []).filter(issue => !issue.startsWith('报名起止时间待补')),
    },
    sources: (record.sources || []).map(source => ({
      ...source,
      evidence_excerpt: `${source.evidence_excerpt || ''}｜官网赛程表：${s.raw}`.slice(0, 300),
      last_verified_at: now,
    })),
    lastVerifiedAt: now,
  };
});

if (!touched) { console.log('无需修改'); process.exit(0); }

const result = await call({
  action: 'saveRecords', records: next, expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `curation200-batch5-schedule-${Date.now()}`, action: 'update', objectType: 'event_edition', recordId: 'batch',
    recordName: `补齐 ${touched} 条研究生系列大赛的报名起止时间`,
    changedFields: ['schedule', 'registrationMethod', 'qualityIssues'], actor: 'super_admin',
    reason: '写入时误判为「主页未公布报名时间」，实为读漏了赛事主页的赛程安排表；时间取自官网赛程表原文并逐条回查核对', createdAt: now,
  },
});
console.log(JSON.stringify({ touched, version: result.version }, null, 2));
