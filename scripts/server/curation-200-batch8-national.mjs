// 2026-09-23 · 批次6：全国性赛事，逐条核到赛事自己的官方章程/通知
//
// 来源不是目录，也不是高校转发通知，而是赛事官方站点上的当届章程与通知
// 正文——这是要求里「逐项找到比赛本身，核验当届名称、主办方、大学生参赛
// 资格、专业内容及官方入口」的做法。
//
// 线索从全国普通高校大学生竞赛排行榜（82项）与库存比对得出的 35 项未收录
// 清单出发；榜单只作线索，每条都必须回到赛事自己的官网核验才写入，核不到
// 官方正文的一律不写。
//
// 写入前逐条过：blockedTitleReason（标题不得含通知/感叹号/正式启动等）、
// classifyCompetitionScope、assessIntakeRecord 三道闸。
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { candidateToRecord } = require('./cjs/candidateToRecord.js');
const { classifyCompetitionScope, assessIntakeRecord } = require('./cjs/competitionScope.js');
const { blockedTitleReason } = require('./cjs/noticeResolution.js');
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const now = new Date().toISOString();
const RULE_VERSION = 'national-official-notice-v1';
const BATCH_TAG = 'curation200-national3-20260923';

async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

const entries = JSON.parse(fs.readFileSync(new URL('./curation-200-batch8-entries.json', import.meta.url)));

function toRecord(entry) {
  const record = candidateToRecord(
    { externalId: entry.key, name: entry.name, detailUrl: entry.url, tags: [], registration_start: entry.start, registration_end: entry.end },
    null, { now: new Date(now) },
  );
  record.organizer = entry.organizer;
  record.eventLevel = entry.eventLevel;
  record.professions = entry.professions;
  record.participants = entry.eligibility;
  record.eligibility = entry.eligibility;
  record.formatAndRules = entry.formatAndRules;
  record.teamSize = entry.teamSize;
  record.teamSizeCategory = entry.teamSizeCategory;
  record.participationFormat = entry.participationFormat;
  record.registrationMethod = entry.registrationMethod;
  record.registrationOrganization = entry.registrationOrganization;
  record.registrationUrl = entry.siteUrl || entry.url;
  record.feeType = entry.feeType;
  record.fees = entry.fees;
  record.rewardHighlights = entry.rewardHighlights || [];
  record.rewards = entry.rewards || '';
  record.rewardAmount = null;
  record.rewardTier = '暂未公布';
  record.schedule = { ...record.schedule, registration_start: entry.start || null, registration_end: entry.end || null, pending_announcement: !entry.end };
  record.firstSeenAt = now;
  record.admissionVerdict = 'admit';
  record.qualityIssues = entry.issues || [];
  record.track.name = entry.name;
  record.recommendation.recommendation = '信息不足';
  record.recommendation.missing_information = entry.issues || [];
  record.curationBatch = BATCH_TAG;
  record.ruleVersion = RULE_VERSION;
  record.verifiedBy = 'claude-curation-20260923';
  record.sources = [{
    id: `source-${entry.key}-official`, edition_id: record.id, url: entry.url, final_url: entry.url,
    source_type: 'organizer_notice', is_official: true, validity_status: 'valid',
    published_at: null, last_verified_at: now,
    evidence_excerpt: entry.evidence.slice(0, 300),
  }];
  return record;
}

const records = entries.map(toRecord);
const blocked = records.map(r => ({
  r, t: blockedTitleReason(r.name), s: classifyCompetitionScope(r), i: assessIntakeRecord(r),
})).filter(x => x.t || x.s.decision !== 'eligible' || x.i.decision !== 'eligible');
if (blocked.length) {
  console.log(JSON.stringify(blocked.map(x => ({ name: x.r.name, title: x.t, scope: x.s.reason, intake: x.i.reason })), null, 2));
  throw new Error(`${blocked.length} 条未通过入库门槛`);
}
if (records.length > 25) throw new Error(`单批超过25条：${records.length}`);

const state = await call({ action: 'bootstrap' });
const existing = state.records;
if (!Array.isArray(existing) || !existing.length) throw new Error('拒绝覆盖空库');
const additions = records.filter(record => !existing.some(old => old.id === record.id || old.name === record.name));
if (!additions.length) { console.log('无新增记录'); process.exit(0); }

const result = await call({
  action: 'saveRecords', records: [...existing, ...additions], expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `${BATCH_TAG}-${Date.now()}`, action: 'create', objectType: 'event_edition', recordId: 'batch',
    recordName: `全国性赛事官方章程核验新增 ${additions.length} 条草稿`,
    changedFields: ['dataStatus'], actor: 'super_admin',
    reason: '逐条核到赛事官方站点的当届章程与通知正文，核实主办方、参赛对象、赛制与日程后写入；榜单仅作线索', createdAt: now,
  },
});
console.log(JSON.stringify({ batch: BATCH_TAG, added: additions.length, names: additions.map(x => x.name), version: result.version }, null, 2));
