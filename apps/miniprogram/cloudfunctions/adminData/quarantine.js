// Reversible isolation. Never deletes the record or the original evidence.
const { classifyCompetitionScope } = require('./competitionScope');
const { assessIntakeRecord } = require('./competitionScope');
const { requirePublishGate } = require('./publicCache');
function isolateMisimport(record, now = new Date().toISOString()) {
  if (record.dataStatus === 'quarantined') return record;
  const scope = classifyCompetitionScope(record);
  const identityIssue = record.aiReview?.decision === 'needs_changes'
    && record.aiReview?.risk_level === 'high'
    && (record.aiReview.issues || []).find(issue => issue.field === 'event_identity');
  // Only explicit non-event title findings or structured AI identity findings.
  const titleReject = scope.decision === 'reject' && /通知|栏目|目录|报道|公示|下级选拔|校赛|院赛/.test(scope.reason);
  if (!titleReject && !identityIssue) return record;
  return {...record, dataStatus:'quarantined', manualReview:'pending', systemValidation:'not_run',
    recommendation:{...record.recommendation, published_cache:false, manual_review:'pending', system_validation:'not_run'},
    quarantine:{at:now, reason:identityIssue ? identityIssue.finding : scope.reason,
      actor:identityIssue ? 'ai-identity-review' : 'scope-rule', ruleVersion:'quarantine-v1',
      previousStatus:record.dataStatus, previousReview:{manualReview:record.manualReview,systemValidation:record.systemValidation}},
    updatedAt:now, updatedBy:'misimport-quarantine'};
}
function requireReviewDisposition(previous, next) {
  const byId = new Map(previous.map(record => [record.id, record]));
  for (const record of next) {
    const old = byId.get(record.id);
    if (JSON.stringify(old?.aiReview) === JSON.stringify(record.aiReview)) continue;
    const issue = record.aiReview?.decision === 'needs_changes' && record.aiReview?.risk_level === 'high'
      && record.aiReview.issues?.some(item => item.field === 'event_identity');
    if (issue && (record.dataStatus !== 'quarantined' || !record.quarantine?.reason)) throw new Error('赛事身份审核未通过，必须进入误收隔离，不能继续保留普通草稿');
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
module.exports = {isolateMisimport, requireReviewDisposition, requireQuarantineRecovery};
