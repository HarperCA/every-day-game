// 2026-09-23 · 批次10：全国性赛事，逐条核到赛事自己的官方章程/通知
//
// 5条均取自组委会/主办方自己发布的盖章通知或章程原文：服务外包（fwwb.org.cn）、
// 周培源力学（中国力学学会《力学与实践》刊发）、物联网设计（iot.sjtu.edu.cn）、
// 睿抗（工信人才〔2026〕53号，官网接口附件）、税收风险管控（组委会通知+规程+延期公告）。
// 光电设计、百度之星核不到当届组委会原文，中华经典诵写讲为全民文化活动，均未写入。
//
// 同批修正批次9“外教社杯”：rewardHighlights 用了枚举外的值（会被静默丢弃），
// 短视频赛允许个人参赛，参赛形式改为“个人或团队均可”。
//
// 写入前逐条过：枚举校验、blockedTitleReason、classifyCompetitionScope、assessIntakeRecord。
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
const BATCH_TAG = 'curation200-national5-20260923';

async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

const entries = JSON.parse(fs.readFileSync(new URL('./curation-200-batch10-entries.json', import.meta.url)));

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
  }, ...(entry.extraSources || []).map((extra, index) => ({
    id: `source-${entry.key}-official-${index + 2}`, edition_id: record.id, url: extra.url, final_url: extra.url,
    source_type: 'organizer_notice', is_official: true, validity_status: 'valid',
    published_at: null, last_verified_at: now,
    evidence_excerpt: extra.excerpt.slice(0, 300),
  }))];
  return record;
}

const ENUMS = {
  participationFormat: ['个人赛', '团队赛', '个人或团队均可', '暂未明确'],
  teamSizeCategory: ['1人', '2～3人', '4～5人', '6人及以上', '人数范围不固定', '暂未明确'],
  feeType: ['免费', '收费', '不同赛项费用不同', '暂未公布'],
  registrationOrganization: ['自行报名', '学校统一报名', '两种方式均可', '需先校内选拔', '以赛区或学校通知为准', '暂未明确'],
};
const REWARD_HIGHLIGHTS = ['保研考研加分', '实习或直通面试', '就业绿色通道', '创业扶持', '国际交流', '证书荣誉', '实物奖品', '现金奖金'];
const enumErrors = entries.flatMap(entry => [
  ...Object.entries(ENUMS).filter(([field, allowed]) => !allowed.includes(entry[field])).map(([field]) => `${entry.name}：${field}=${entry[field]}`),
  ...(entry.rewardHighlights || []).filter(value => !REWARD_HIGHLIGHTS.includes(value)).map(value => `${entry.name}：rewardHighlights=${value}`),
]);
if (enumErrors.length) throw new Error(`枚举值不合法：\n${enumErrors.join('\n')}`);

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

const SFLEP_ID = 'edition-sflep-ict-competition-9';
const patched = existing.map(record => record.id === SFLEP_ID && record.curationBatch === 'curation200-national4-20260923'
  ? { ...record, rewardHighlights: ['证书荣誉'], participationFormat: '个人或团队均可' }
  : record);
const patchCount = patched.filter((record, index) => record !== existing[index]).length;
if (!additions.length && !patchCount) { console.log('无新增或修正记录'); process.exit(0); }

const result = await call({
  action: 'saveRecords', records: [...patched, ...additions], expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `${BATCH_TAG}-${Date.now()}`, action: 'create', objectType: 'event_edition', recordId: 'batch',
    recordName: `全国性赛事官方章程核验新增 ${additions.length} 条草稿`,
    changedFields: ['dataStatus'], actor: 'super_admin',
    reason: '逐条核到赛事官方站点的当届章程与通知正文，核实主办方、参赛对象、赛制与日程后写入；榜单仅作线索', createdAt: now,
  },
});
console.log(JSON.stringify({ batch: BATCH_TAG, added: additions.length, names: additions.map(x => x.name), patched: patchCount, version: result.version }, null, 2));
