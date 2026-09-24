// 2026-09-24 · 143条草稿分诊：每条进入一个有明确出口的分组
//
//   明确不合格 → 隔离（quarantined，可恢复为草稿，不删证据）
//   已过期     → 归档（archived，学生端显示为往届并附下一届估算；须先过公开缓存闸门）
//   需要追溯   → 仍为草稿，标准问题代码 + triage.traceDue；到期未找到当届官方通知的，
//                由 draft-triage-expire-trace.mjs 统一隔离
//   可补齐     → 枚举归位、说明性事实移入“缺失信息”，跑系统验证：通过即进入待人工审核
//
// 分诊方案 draft-triage-20260924-plan.json 由本地脚本生成，依据：现行范围闸/入库闸、
// 管理端系统验证规则、已付费取得的资料（AI审核意见、AI抽取引文、辽宁省平台缓存原文、
// 研究生系列赛程缓存）。本脚本只执行方案，不做新的判断。
//
// 每条被改动的记录都写入 triage.previous（原字段值），可据此逐条回滚。
// 用法：node draft-triage-20260924.mjs [--apply]   默认只预演。
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const FN = '/opt/daily-contest/functions/adminData';
const { toPublicCache } = require(`${FN}/publicCache.js`);
const { archiveRecord } = require(`${FN}/archiveSchedule.js`);
const { classifyCompetitionScope } = require(`${FN}/competitionScope.js`);

const APPLY = process.argv.includes('--apply');
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const now = new Date();
const nowIso = now.toISOString();
const RULE = 'draft-triage-20260924';
const TRACE_DUE = '2026-10-08T23:59:59+08:00';

async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

// ---- 与 apps/admin/src/validation.ts、adminWorkflow.ts 保持一致的系统验证 ----
const participationFormats = ['个人赛', '团队赛', '个人或团队均可', '暂未明确'];
const teamSizeCategories = ['1人', '2～3人', '4～5人', '6人及以上', '人数范围不固定', '暂未明确'];
const feeTypes = ['免费', '收费', '不同赛项费用不同', '暂未公布'];
const registrationOrganizations = ['自行报名', '学校统一报名', '两种方式均可', '需先校内选拔', '以赛区或学校通知为准', '暂未明确'];
const qualityIssueLabels = {
  source_reachability_not_checked: '来源链接尚未核验可访问性', track_requires_official_split: '组合赛项需按官方资料拆分',
  registration_time_pending: '报名时间待官方确认', registration_url_pending: '报名入口待官方确认', source_missing: '缺少官方数据来源',
  profession_mapping_pending: '适合专业待人工确认', notice_resolution_pending: '通知线索待追溯赛事官网及官方报名入口',
};
function validateAdminRecord(record) {
  const errors = [];
  if (!record.name?.trim()) errors.push('赛事名称不能为空');
  if (!record.editionName?.trim()) errors.push('届次名称不能为空');
  if (/(?:19|20)\d{2}|第[零〇一二三四五六七八九十百千万两\d]+届/.test(String(record.name || ''))) errors.push('赛事名称只保留正文；年份和第几届请填入独立字段');
  if (/通知/.test(String(record.name || '')) || /通知/.test(String(record.editionName || ''))) errors.push('名称含“通知”的条目只能作为线索，不得入赛事库');
  if (!participationFormats.includes(record.participationFormat)) errors.push('参赛形式不在允许范围内');
  if (!teamSizeCategories.includes(record.teamSizeCategory)) errors.push('队伍人数不在允许范围内');
  if (!feeTypes.includes(record.feeType)) errors.push('报名费用不在允许范围内');
  if (!registrationOrganizations.includes(record.registrationOrganization)) errors.push('报名组织方式不在允许范围内');
  if (record.participationFormat !== '暂未明确' && !record.teamSize?.trim()) errors.push('明确参赛形式时必须保留组队人数原文');
  if (record.registrationOrganization !== '暂未明确' && !record.registrationMethod?.trim()) errors.push('明确报名组织方式时必须保留报名方式原文');
  if (record.feeType !== '暂未公布' && !record.fees?.trim()) errors.push('明确费用类型时必须填写费用说明原文');
  return errors;
}
function systemReviewIssues(record) {
  const issues = [...validateAdminRecord(record)];
  if (!/^https?:\/\//i.test(record.registrationUrl || '')) issues.push('报名链接缺失或格式不正确');
  if (!record.lastVerifiedAt) issues.push('缺少最后核验时间');
  if (!(record.sources || []).some(s => s.is_official && !['discovery_notice', 'university_notice', 'search_candidate'].includes(s.source_type) && /^https?:\/\//i.test(s.url || ''))) issues.push('缺少有效格式的官方来源链接');
  if (!Array.isArray(record.professions) || !record.professions.length) issues.push('尚未配置适合专业');
  for (const issue of record.qualityIssues || []) issues.push(qualityIssueLabels[issue] || `待处理：${issue}`);
  return [...new Set(issues)];
}

const plan = JSON.parse(fs.readFileSync(new URL('./draft-triage-20260924-plan.json', import.meta.url)));
const state = await call({ action: 'bootstrap' });
const existing = state.records;
if (!Array.isArray(existing) || !existing.length) throw new Error('拒绝覆盖空库');
const byId = new Map(existing.map(r => [r.id, r]));

const stale = plan.filter(p => { const r = byId.get(p.id); return !r || r.dataStatus !== 'draft' || (r.updatedAt || null) !== p.snapshotUpdatedAt; });
if (stale.length) throw new Error(`以下记录在分诊后已被改动或不再是草稿，中止：\n${stale.map(p => p.name).join('\n')}`);

const summary = { quarantine: [], archive: [], trace: [], review: [], systemFailed: [] };
const changed = new Map();
for (const p of plan) {
  const r = byId.get(p.id);
  const previous = {
    dataStatus: r.dataStatus, eventLevel: r.eventLevel, rewardHighlights: r.rewardHighlights, teamSizeCategory: r.teamSizeCategory,
    registrationOrganization: r.registrationOrganization, participationFormat: r.participationFormat, qualityIssues: r.qualityIssues,
    missingInformation: r.recommendation?.missing_information, schedule: r.schedule, systemValidation: r.systemValidation, manualReview: r.manualReview,
  };
  const triage = { rule: RULE, at: nowIso, bucket: p.bucket, reason: p.reason, previous };

  if (p.action === 'quarantine') {
    changed.set(r.id, {
      ...r, dataStatus: 'quarantined', manualReview: 'pending', systemValidation: 'not_run',
      recommendation: { ...r.recommendation, published_cache: false, manual_review: 'pending', system_validation: 'not_run' },
      quarantine: { at: nowIso, reason: p.reason, actor: RULE, ruleVersion: 'quarantine-v1', previousStatus: r.dataStatus, previousReview: { manualReview: r.manualReview, systemValidation: r.systemValidation } },
      triage, updatedAt: nowIso, updatedBy: RULE,
    });
    summary.quarantine.push(r.name);
    continue;
  }

  const facts = [...new Set([...(r.recommendation?.missing_information || []).filter(x => !p.issueCodes.includes(x)), ...p.issueFacts])];
  let next = {
    ...r, ...p.normalize, qualityIssues: p.issueCodes,
    recommendation: { ...r.recommendation, missing_information: facts },
    triage, updatedAt: nowIso, updatedBy: RULE,
  };
  if (p.dateFix) {
    const { note, ...fields } = p.dateFix;
    next.schedule = { ...next.schedule, ...fields, pending_announcement: !(fields.registration_end ?? next.schedule?.registration_end) };
    next.recommendation.missing_information = [...new Set([...next.recommendation.missing_information, note])];
  }

  if (p.action === 'archive') {
    next = archiveRecord(next, now);
    next.archivedReason = 'registration_closed_before_publish';
    next.updatedBy = RULE;
    toPublicCache(next, now); // 公开缓存闸门：不通过就抛错，整批不写
    summary.archive.push(next.name);
  } else if (p.action === 'trace') {
    if (classifyCompetitionScope(next).decision === 'reject') throw new Error(`追溯条目被范围闸拒绝：${next.name}`);
    const codes = new Set(next.qualityIssues);
    if (!codes.size) codes.add('notice_resolution_pending');
    next.qualityIssues = [...codes];
    next.triage = { ...next.triage, traceDue: TRACE_DUE, traceTodo: p.reason, traceExit: '期限内取得赛事当届官方通知原文→按原文补正后送审；到期仍未取得→隔离' };
    summary.trace.push(next.name);
  } else if (p.action === 'fill_and_review') {
    const issues = systemReviewIssues(next);
    next = {
      ...next, systemValidation: issues.length ? 'failed' : 'passed', systemReviewIssues: issues, systemReviewedAt: nowIso,
      dataStatus: issues.length ? 'pending_system_validation' : 'pending_manual_review',
      recommendation: { ...next.recommendation, system_validation: issues.length ? 'failed' : 'passed' },
    };
    (issues.length ? summary.systemFailed : summary.review).push(issues.length ? `${next.name}：${issues.join('；')}` : next.name);
  } else {
    throw new Error(`未知动作：${p.action}`);
  }
  changed.set(r.id, next);
}

console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', counts: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v.length])), systemFailed: summary.systemFailed }, null, 2));
if (!APPLY) process.exit(0);

fs.writeFileSync(`/opt/daily-contest/backups/draft-triage-20260924-before.json`, JSON.stringify(plan.map(p => byId.get(p.id))));
const result = await call({
  action: 'saveRecords', records: existing.map(r => changed.get(r.id) || r), expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `${RULE}-${Date.now()}`, action: 'update', objectType: 'event_edition', recordId: 'batch',
    recordName: `草稿分诊：隔离${summary.quarantine.length}、归档${summary.archive.length}、追溯${summary.trace.length}、送人工审核${summary.review.length}、系统验证未过${summary.systemFailed.length}`,
    changedFields: ['dataStatus', 'eventLevel', 'rewardHighlights', 'teamSizeCategory', 'registrationOrganization', 'participationFormat', 'qualityIssues', 'recommendation', 'triage'],
    actor: 'super_admin', reason: '143条草稿按明确不合格/已过期/需要追溯/可补齐分诊，各自进入隔离/归档/追溯队列/人工审核', createdAt: nowIso,
  },
});
console.log('saved version', result.version);
