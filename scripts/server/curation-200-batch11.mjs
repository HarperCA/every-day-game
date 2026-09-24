// 2026-09-24 · 批次11：全国榜单缺项、秋季新一届、浙江省大学生科技竞赛委员会正式文件
//
// 12条，均取自主办方或竞赛委员会自己发布的原文：
//   工行杯（官网大赛介绍＋截止通知）、机械工程创新创意大赛（中国机械工程学会 机学教〔2026〕17号）、
//   全国大学生数学竞赛（中国数学会 2026-06-10 通知）、市场调查与分析大赛第十七届（中国商业统计学会 2026-09-20 通知，
//   上一届已归档，这里作为新一届写入并沿用赛事编号）、浙江省7项（浙科竞〔2026〕2/4/16/17/19/20/44号）、
//   全国大学生创新体验竞赛（中国创造学会 2025-12-02 通知）。
// 官方只写月份的日期一律留空；报名状态可由原文直接判定时写 status_override 并注明依据。
// 未写入：医学技术技能大赛、地质技能竞赛、能源经济学术创意大赛、CCPC、光电设计竞赛（核不到当届完整原文），
//         中美青年创客大赛（不限于大学生）、APMCM（正文不可读、商业平台承办）、国产软件应用大赛（只有赛道细则）。
//
// 写入前逐条过：枚举校验、blockedTitleReason、classifyCompetitionScope、assessIntakeRecord、系统验证；
// 系统验证通过的直接送人工审核（与 draft-triage-20260924 的 fill_and_review 出口一致），否则留在待系统验证。
// 用法：node curation-200-batch11.mjs [--apply]   默认只预演。
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { candidateToRecord } = require('./cjs/candidateToRecord.js');
const { classifyCompetitionScope, assessIntakeRecord } = require('./cjs/competitionScope.js');
const { blockedTitleReason } = require('./cjs/noticeResolution.js');
const APPLY = process.argv.includes('--apply');
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const now = new Date().toISOString();
const RULE_VERSION = 'official-notice-v2';
const BATCH_TAG = 'curation200-batch11-20260924';

async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

const ENUMS = {
  eventLevel: ['国际级', '国家级', '省级/区域级', '其他/未明确'],
  participationFormat: ['个人赛', '团队赛', '个人或团队均可', '暂未明确'],
  teamSizeCategory: ['1人', '2～3人', '4～5人', '6人及以上', '人数范围不固定', '暂未明确'],
  feeType: ['免费', '收费', '不同赛项费用不同', '暂未公布'],
  registrationOrganization: ['自行报名', '学校统一报名', '两种方式均可', '需先校内选拔', '以赛区或学校通知为准', '暂未明确'],
};
const REWARD_HIGHLIGHTS = ['保研考研加分', '实习或直通面试', '就业绿色通道', '创业扶持', '国际交流', '证书荣誉', '实物奖品', '现金奖金'];
const PROFESSIONS = ['综合/不限专业', '计算机与AI', '电子信息', '经管与商科', '生物与医药', '机械与自动化', '数学与统计', '材料与化工', '能源与环境', '设计与艺术', '人文与法学', '外语与教育', '建筑与土木'];
const STATUS = ['时间待公布', '即将报名', '报名中', '已截止'];

// 与管理端 validateAdminRecord / getSystemReviewIssues 同一套规则（draft-triage-20260924 的移植版，另加赛事级别）。
function systemReviewIssues(record) {
  const issues = [];
  if (!record.name?.trim()) issues.push('赛事名称不能为空');
  if (!record.editionName?.trim()) issues.push('届次名称不能为空');
  if (/(?:19|20)\d{2}|第[零〇一二三四五六七八九十百千万两\d]+届/.test(String(record.name || ''))) issues.push('赛事名称只保留正文；年份和第几届请填入独立字段');
  if (/通知/.test(`${record.name || ''}${record.editionName || ''}`)) issues.push('名称含“通知”');
  for (const [field, allowed] of Object.entries(ENUMS)) if (!allowed.includes(record[field])) issues.push(`${field} 不在允许范围内`);
  if (record.participationFormat !== '暂未明确' && !record.teamSize?.trim()) issues.push('明确参赛形式时必须保留组队人数原文');
  if (record.registrationOrganization !== '暂未明确' && !record.registrationMethod?.trim()) issues.push('明确报名组织方式时必须保留报名方式原文');
  if (record.feeType !== '暂未公布' && !record.fees?.trim()) issues.push('明确费用类型时必须填写费用说明原文');
  if (!/^https?:\/\//i.test(record.registrationUrl || '')) issues.push('报名链接缺失或格式不正确');
  if (!record.lastVerifiedAt) issues.push('缺少最后核验时间');
  if (!(record.sources || []).some(s => s.is_official && /^https?:\/\//i.test(s.url || ''))) issues.push('缺少有效格式的官方来源链接');
  if (!record.professions?.length) issues.push('尚未配置适合专业');
  for (const issue of record.qualityIssues || []) issues.push(`待处理：${issue}`);
  return issues;
}

const entries = JSON.parse(fs.readFileSync(new URL('./curation-200-batch11-entries.json', import.meta.url)));
const entryErrors = entries.flatMap(entry => [
  ...Object.entries(ENUMS).filter(([field, allowed]) => !allowed.includes(entry[field])).map(([field]) => `${entry.name}：${field}=${entry[field]}`),
  ...(entry.rewardHighlights || []).filter(v => !REWARD_HIGHLIGHTS.includes(v)).map(v => `${entry.name}：rewardHighlights=${v}`),
  ...(entry.professions || []).filter(v => !PROFESSIONS.includes(v)).map(v => `${entry.name}：professions=${v}`),
  ...(entry.statusOverride && !STATUS.includes(entry.statusOverride) ? [`${entry.name}：statusOverride=${entry.statusOverride}`] : []),
  ...(entry.statusOverride && !entry.statusOverrideReason ? [`${entry.name}：写了报名状态却没写依据`] : []),
  ...[entry.start, entry.end].filter(v => v && Number.isNaN(Date.parse(v))).map(v => `${entry.name}：日期无法解析 ${v}`),
]);
if (entryErrors.length) throw new Error(`条目不合法：\n${entryErrors.join('\n')}`);

const state = await call({ action: 'bootstrap' });
const existing = state.records;
if (!Array.isArray(existing) || !existing.length) throw new Error('拒绝覆盖空库');

function toRecord(entry) {
  const record = candidateToRecord({ externalId: entry.key, name: entry.name, detailUrl: entry.url, tags: [] }, null, { now: new Date(now) });
  if (entry.editionYear) record.editionYear = entry.editionYear;
  if (entry.sameEventAs) {
    const prior = existing.find(old => old.name === entry.sameEventAs && old.eventId);
    if (!prior) throw new Error(`找不到上一届：${entry.sameEventAs}`);
    record.eventId = prior.eventId;
  }
  Object.assign(record, {
    organizer: entry.organizer, eventLevel: entry.eventLevel, professions: entry.professions,
    participants: entry.eligibility, eligibility: entry.eligibility, formatAndRules: entry.formatAndRules,
    teamSize: entry.teamSize, teamSizeCategory: entry.teamSizeCategory, participationFormat: entry.participationFormat,
    registrationMethod: entry.registrationMethod, registrationOrganization: entry.registrationOrganization,
    registrationUrl: entry.siteUrl || entry.url, feeType: entry.feeType, fees: entry.fees,
    rewardHighlights: entry.rewardHighlights || [], rewards: entry.rewards || '', rewardAmount: null, rewardTier: '暂未公布',
    firstSeenAt: now, admissionVerdict: 'admit', qualityIssues: [],
    curationBatch: BATCH_TAG, ruleVersion: RULE_VERSION, verifiedBy: 'claude-curation-20260924',
  });
  record.schedule = {
    ...record.schedule, registration_start: entry.start || null, registration_end: entry.end || null,
    pending_announcement: false, status_override: entry.statusOverride || null, status_override_reason: entry.statusOverrideReason || null,
    time_note: entry.statusOverrideReason || '',
  };
  record.track.name = record.name;
  record.recommendation = { ...record.recommendation, recommendation: '信息不足', missing_information: entry.issues || [] };
  record.sources = [{
    id: `source-${entry.key}-official`, edition_id: record.id, url: entry.url, final_url: entry.url,
    source_type: 'organizer_notice', is_official: true, validity_status: 'valid', published_at: null, last_verified_at: now,
    evidence_excerpt: entry.evidence.slice(0, 300),
  }, ...(entry.extraSources || []).map((extra, index) => ({
    id: `source-${entry.key}-official-${index + 2}`, edition_id: record.id, url: extra.url, final_url: extra.url,
    source_type: 'organizer_notice', is_official: true, validity_status: 'valid', published_at: null, last_verified_at: now,
    evidence_excerpt: extra.excerpt.slice(0, 300),
  }))];
  const issues = systemReviewIssues(record);
  return {
    ...record, systemValidation: issues.length ? 'failed' : 'passed', systemReviewIssues: issues, systemReviewedAt: now,
    dataStatus: issues.length ? 'pending_system_validation' : 'pending_manual_review',
    recommendation: { ...record.recommendation, system_validation: issues.length ? 'failed' : 'passed' },
  };
}

const records = entries.map(toRecord);
const gate = records.map(r => ({ r, t: blockedTitleReason(r.name), s: classifyCompetitionScope(r), i: assessIntakeRecord(r) }))
  .filter(x => x.t || x.s.decision !== 'eligible' || x.i.decision !== 'eligible');
if (gate.length) {
  console.log(JSON.stringify(gate.map(x => ({ name: x.r.name, title: x.t, scope: x.s.reason, intake: x.i.reason })), null, 2));
  throw new Error(`${gate.length} 条未通过入库门槛`);
}
if (records.length > 25) throw new Error(`单批超过25条：${records.length}`);

// 同一届已在库（同编号，或同名同年份）则跳过；同名不同年份是新一届，照常写入。
const additions = records.filter(record => !existing.some(old => old.id === record.id
  || (old.name === record.name && String(old.editionYear || '') === String(record.editionYear || ''))));
console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run', total: records.length, additions: additions.length,
  rows: additions.map(r => ({ name: r.name, year: r.editionYear, ordinal: r.editionOrdinal, status: r.dataStatus, reg: [r.schedule.registration_start, r.schedule.registration_end, r.schedule.status_override], issues: r.systemReviewIssues })),
}, null, 2));
if (!APPLY || !additions.length) process.exit(0);

fs.writeFileSync(`/opt/daily-contest/backups/${BATCH_TAG}-before-version.json`, JSON.stringify({ version: state.stateVersions.records, count: existing.length }));
const result = await call({
  action: 'saveRecords', records: [...existing, ...additions], expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `${BATCH_TAG}-${Date.now()}`, action: 'create', objectType: 'event_edition', recordId: 'batch',
    recordName: `官方原文核验新增 ${additions.length} 条`, changedFields: ['dataStatus'], actor: 'super_admin',
    reason: '逐条核到主办方或竞赛委员会发布的当届通知原文后写入；只写原文有的字段，只写到月份的日期留空', createdAt: now,
  },
});
console.log(JSON.stringify({ batch: BATCH_TAG, added: additions.length, version: result.version, publicCache: [result.publicCachePublished, result.publicCacheRemoved] }));
