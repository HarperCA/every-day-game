// 2026-09-22 新增 200 场核验任务 · 批次1：辽宁省教育厅官方竞赛平台（cxcy.upln.cn）
// 全部条目主办方均为"辽宁省教育厅"，来源为该平台 detail 接口返回的官方实施方案正文，
// 逐条核验当届名称/承办单位/时间/参赛资格后写入。收费信息来源正文未提及的一律标注"未说明收费"。
// 全部以 draft 入库（发布留给管理端人工审核流程），版本冲突时中止，不覆盖其他修改。
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { candidateToRecord } = require('./cjs/candidateToRecord.js');
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

const entries = JSON.parse(fs.readFileSync(new URL('./curation-200-batch1-entries.json', import.meta.url)));

function toRecord(entry) {
  const candidate = { externalId: entry.key, name: entry.name, detailUrl: entry.official, tags: [], registration_start: entry.start, registration_end: entry.end, rewards: entry.rewards || '' };
  const record = candidateToRecord(candidate, null, { now: new Date(now) });
  record.organizer = `${entry.organizer}（承办：${entry.undertake}）`;
  record.eventLevel = entry.eventLevel || '省级';
  record.professions = entry.professions;
  record.participants = entry.eligibility;
  record.eligibility = entry.eligibility;
  record.formatAndRules = entry.formatAndRules;
  record.teamSize = entry.teamSize;
  record.teamSizeCategory = entry.teamSizeCategory;
  record.participationFormat = entry.participationFormat || '团队赛';
  record.registrationMethod = entry.registrationMethod;
  record.registrationOrganization = entry.registrationOrganization || '学校统一报名';
  record.registrationUrl = entry.registration || entry.official;
  record.feeType = entry.feeType || '暂未公布';
  record.fees = entry.fees || '';
  record.rewardHighlights = entry.rewardHighlights || [];
  record.rewards = entry.rewards || '';
  record.rewardAmount = entry.rewardAmount || null;
  record.rewardTier = entry.rewardAmount ? '1万-10万' : '暂未公布';
  record.firstSeenAt = now;
  record.admissionVerdict = 'admit';
  record.qualityIssues = entry.issues || [];
  record.track.name = entry.name;
  record.recommendation.recommendation = '信息不足';
  record.recommendation.missing_information = entry.issues || [];
  record.curationBatch = BATCH_TAG;
  record.sources = [
    { id: `source-${entry.key}-notice`, edition_id: record.id, url: entry.official, source_type: 'organizer_notice', is_official: Boolean(entry.isOfficial), validity_status: 'valid', published_at: null, last_verified_at: now },
    ...(entry.registration2 ? [{ id: `source-${entry.key}-secondary`, edition_id: record.id, url: entry.registration2, source_type: 'organizer_website', is_official: true, validity_status: 'valid', published_at: null, last_verified_at: now }] : []),
  ];
  return record;
}

const state = await call({ action: 'bootstrap' });
const existing = state.records;
if (!Array.isArray(existing) || !existing.length) throw new Error('拒绝覆盖空库');
const additions = entries.map(toRecord).filter(record => !existing.some(old => old.id === record.id || old.name === record.name));
if (!additions.length) { console.log('无新增记录'); process.exit(0); }
if (additions.length > 25) throw new Error(`单批超过25条：${additions.length}`);
const result = await call({
  action: 'saveRecords', records: [...existing, ...additions], expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `${BATCH_TAG}-${Date.now()}`, action: 'create', objectType: 'event_edition', recordId: 'batch',
    recordName: `新增200场核验任务·批次1（辽宁省教育厅官方平台）新增 ${additions.length} 条赛事草稿`,
    changedFields: ['dataStatus'], actor: 'super_admin',
    reason: '逐条核对辽宁省大学生创新创业管理共享平台（cxcy.upln.cn）官方实施方案正文，核实当届名称、承办单位、时间与参赛资格后写入草稿', createdAt: now,
  },
});
console.log(JSON.stringify({ added: additions.map(x => ({ id: x.id, name: x.name, status: x.dataStatus })), total: result.saved, version: result.version }, null, 2));
