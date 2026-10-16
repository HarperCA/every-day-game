// Reversible isolation. Never deletes the record or the original evidence.
const { classifyCompetitionScope } = require('./competitionScope');
const { assessIntakeRecord } = require('./competitionScope');
const { requirePublishGate } = require('./publicCache');
// 2026-10-09 起（用户要求）：身份有问题（不是独立比赛）不再直接隔离，统一交给 Kimi 处置代理——
// 记录保留 needs_changes 的审核结论，下一轮定时审核会把它当作“未处理的审核问题”交给代理（kimiReviewDisposition.js）：
// 是真比赛就补官方来源后发布或归档，确认不是比赛就删除（删除前备份）。已隔离的旧记录保持原样。
const QUARANTINE_ON_IDENTITY = false;
function isolateMisimport(input, now = new Date().toISOString()) {
  if (input.dataStatus === 'quarantined') return input;
  const record = noteSourceQuality(input);
  if (!QUARANTINE_ON_IDENTITY) {
    // 标题规则判出“不是一场比赛”（通知、目录、校赛、获奖报道等）而 Kimi 没指出的：补一条身份问题，
    // 让下一轮定时审核同样交给处置代理处理，而不是隔离
    const scope = classifyCompetitionScope(record);
    const titleReject = scope.decision === 'reject' && /通知|栏目|目录|报道|公示|下级选拔|校赛|院赛/.test(scope.reason);
    let next = record;
    const hasIdentity = (record.aiReview?.issues || []).some(issue => issue.field === 'event_identity');
    if (titleReject && !hasIdentity) {
      next = { ...record, aiReview:{ ...(record.aiReview || {}), decision:'needs_changes', risk_level:'high', reviewed_at:record.aiReview?.reviewed_at || now,
        issues:[...(record.aiReview?.issues || []), { field:'event_identity', finding:scope.reason, recommendation:'交给处置代理核实', evidence_ref:'' }] } };
    }
    const identity = next.aiReview?.decision === 'needs_changes' && next.aiReview?.risk_level === 'high'
      && (next.aiReview.issues || []).find(issue => issue.field === 'event_identity');
    return next.dataStatus === 'published' ? flagPublishedIdentity(next, identity, now) : next;
  }
  const scope = classifyCompetitionScope(record);
  const identityIssue = record.aiReview?.decision === 'needs_changes'
    && record.aiReview?.risk_level === 'high'
    && (record.aiReview.issues || []).find(issue => issue.field === 'event_identity');
  // Only explicit non-event title findings or structured AI identity findings.
  const titleReject = scope.decision === 'reject' && /通知|栏目|目录|报道|公示|下级选拔|校赛|院赛/.test(scope.reason);
  // 已发布记录经过人工审核：AI 的身份结论只作为待核对问题，不自动撤下（2026-09-29 一轮周审误撤 16 条）。
  // 标题规则（确定性的）仍按原样隔离。
  if (!titleReject && record.dataStatus === 'published') return flagPublishedIdentity(record, identityIssue, now);
  if (!titleReject && !identityIssue) return record;
  return {...record, dataStatus:'quarantined', manualReview:'pending', systemValidation:'not_run',
    recommendation:{...record.recommendation, published_cache:false, manual_review:'pending', system_validation:'not_run'},
    quarantine:{at:now, reason:identityIssue ? identityIssue.finding : scope.reason,
      actor:identityIssue ? 'ai-identity-review' : 'scope-rule', ruleVersion:'quarantine-v1',
      previousStatus:record.dataStatus, previousReview:{manualReview:record.manualReview,systemValidation:record.systemValidation}},
    updatedAt:now, updatedBy:'misimport-quarantine'};
}
const IDENTITY_FLAG = 'AI身份审核：';
const SOURCE_FLAG = 'AI来源审核：';
const withoutIdentityFlag = issues => (Array.isArray(issues) ? issues : []).filter(item => !String(item).startsWith(IDENTITY_FLAG));
// 字段周检（周检：…）和来源审核的问题也会让 needsManualReview 为真，撤掉身份标记时要保留它们的结论。
const hasOtherManualIssues = issues => issues.some(item => /^(周检：|AI来源审核：)/.test(String(item)));

// AI 认为来源不是赛事官方原文（学校转发、校内通知、新闻等）：只记问题，任何状态都不隔离。
// 草稿会停在草稿——发布门槛本来就要求官方来源；已发布的打“需人工核对”。
function noteSourceQuality(record) {
  const issue = (record.aiReview?.issues || []).find(item => item.field === 'source_quality');
  const rest = (Array.isArray(record.qualityIssues) ? record.qualityIssues : []).filter(item => !String(item).startsWith(SOURCE_FLAG));
  if (!issue) {
    if (rest.length === (record.qualityIssues || []).length) return record;
    const next = { ...record, qualityIssues:rest };
    if (record.dataStatus === 'published') next.needsManualReview = rest.some(item => /^(周检：|AI身份审核：)/.test(String(item)));
    return next;
  }
  const next = { ...record, qualityIssues:[...rest, `${SOURCE_FLAG}${issue.finding}`] };
  if (record.dataStatus === 'published') next.needsManualReview = true;
  return next;
}

function flagPublishedIdentity(record, identityIssue, now) {
  const rest = withoutIdentityFlag(record.qualityIssues);
  if (!identityIssue) {
    if (rest.length === (record.qualityIssues || []).length) return record;
    return { ...record, qualityIssues:rest, needsManualReview:hasOtherManualIssues(rest) };
  }
  const note = `${IDENTITY_FLAG}${identityIssue.finding}（已发布记录不自动隔离，请人工核对）`;
  return { ...record, needsManualReview:true, qualityIssues:[...rest, note], updatedAt:now, updatedBy:'ai-identity-review' };
}

const isFlaggedPublished = record => record.dataStatus === 'published' && record.needsManualReview
  && (record.qualityIssues || []).some(item => String(item).startsWith(IDENTITY_FLAG));

function requireReviewDisposition(previous, next) {
  if (!QUARANTINE_ON_IDENTITY) return; // 身份问题交给处置代理，不再强制隔离
  const byId = new Map(previous.map(record => [record.id, record]));
  for (const record of next) {
    const old = byId.get(record.id);
    if (JSON.stringify(old?.aiReview) === JSON.stringify(record.aiReview)) continue;
    const issue = record.aiReview?.decision === 'needs_changes' && record.aiReview?.risk_level === 'high'
      && record.aiReview.issues?.some(item => item.field === 'event_identity');
    if (issue && !isFlaggedPublished(record) && (record.dataStatus !== 'quarantined' || !record.quarantine?.reason)) throw new Error('赛事身份审核未通过，必须进入误收隔离，不能继续保留普通草稿');
  }
}

function requireQuarantineRecovery(previous, next, now = new Date()) {
  const oldById = new Map(previous.map(record => [record.id, record]));
  for (const record of next) {
    const old = oldById.get(record.id);
    if (old?.dataStatus !== 'quarantined' || record.dataStatus === 'quarantined') continue;
    if (!['draft','published','archived'].includes(record.dataStatus)) throw new Error('隔离记录只允许恢复草稿、发布或归档');
    const resolution = record.quarantineResolution;
    if (resolution?.actor !== 'manual_admin' || resolution.from !== 'quarantined'
      || resolution.to !== record.dataStatus || !Number.isFinite(Date.parse(resolution.at || ''))
      || !String(resolution.reason || '').trim()) throw new Error('隔离恢复必须有人工处置记录');
    const intake = assessIntakeRecord(record);
    if (intake.decision !== 'eligible') throw new Error(`隔离恢复前请补齐并核验赛事资料：${intake.reason}`);
    if (record.dataStatus === 'draft') {
      if (record.manualReview !== 'pending' || record.systemValidation !== 'not_run') throw new Error('恢复草稿后需重新审核');
      continue;
    }
    const eventSource = (record.sources || []).some(source => source?.id && source.is_official
      && source.validity_status === 'valid'
      && !['discovery_notice','university_notice','search_candidate','competition_directory','directory','school_notice'].includes(source.source_type)
      && /^https?:\/\//i.test(source.url || ''));
    if (!eventSource || (record.qualityIssues || []).includes('notice_resolution_pending')) {
      throw new Error('发布或归档前必须找到并核实这届比赛本身的官方来源');
    }
    const reviewedAt = Date.parse(record.manualReviewedAt || '');
    const validatedAt = Date.parse(record.systemReviewedAt || '');
    const quarantinedAt = Date.parse(old.quarantine?.at || '');
    if (record.manualReview !== 'passed' || record.systemValidation !== 'passed'
      || !Number.isFinite(reviewedAt) || !Number.isFinite(validatedAt)
      || (Number.isFinite(quarantinedAt) && (reviewedAt < quarantinedAt || validatedAt < quarantinedAt))) {
      throw new Error('隔离后必须重新完成人工审核和系统验证');
    }
    if (record.dataStatus === 'published') {
      const end = Date.parse(record.schedule?.registration_end || '');
      if (Number.isFinite(end) && end < now.getTime()) throw new Error('报名已截止的届次不能直接发布，请归档');
      requirePublishGate(record);
      if (!record.lastVerifiedAt) throw new Error('发布前必须记录本次官方来源核验时间');
      continue;
    }
    const end = Date.parse(record.schedule?.registration_end || '');
    if (!Number.isFinite(end) || end >= now.getTime()) throw new Error('归档仅适用于报名截止日期已核实且已过的届次');
  }
}
module.exports = {isolateMisimport, requireReviewDisposition, requireQuarantineRecovery, flagPublishedIdentity, IDENTITY_FLAG, SOURCE_FLAG};
