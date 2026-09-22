// Reversible isolation. Never deletes the record or the original evidence.
const { classifyCompetitionScope } = require('./competitionScope');
function isolateMisimport(record, now = new Date().toISOString()) {
  if (record.dataStatus === 'quarantined') return record;
  const scope = classifyCompetitionScope(record);
  const identityIssue = record.aiReview?.decision === 'needs_changes'
    && record.aiReview?.risk_level === 'high'
    && (record.aiReview.issues || []).find(issue => issue.field === 'event_identity');
  // Only explicit non-event title findings or structured AI identity findings.
  const titleReject = scope.decision === 'reject' && /通知|栏目|目录|报道|公示/.test(scope.reason);
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
module.exports = {isolateMisimport, requireReviewDisposition};
