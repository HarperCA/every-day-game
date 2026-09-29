// Manual single/batch review follows the same structured identity decision as the scheduler.
// 已发布记录只打“需人工核对”标记，不自动隔离（与 cloudfunctions/adminData/quarantine.js 一致）。
const IDENTITY_FLAG = 'AI身份审核：';

export function applyReviewDisposition(record: any, review: any, now = new Date().toISOString()) {
  const updated = {...record, aiReview:review, updatedAt:now, updatedBy:'kimi-review-assistant'};
  const issue = review?.decision === 'needs_changes' && review?.risk_level === 'high'
    && review.issues?.find((item: any) => item.field === 'event_identity');
  if (record.dataStatus === 'published') {
    const rest = (record.qualityIssues || []).filter((item: string) => !String(item).startsWith(IDENTITY_FLAG));
    if (!issue) {
      if (rest.length === (record.qualityIssues || []).length) return updated;
      return {...updated, qualityIssues:rest, needsManualReview:rest.some((item: string) => String(item).startsWith('周检：'))};
    }
    return {...updated, needsManualReview:true, updatedBy:'ai-identity-review',
      qualityIssues:[...rest, `${IDENTITY_FLAG}${issue.finding}（已发布记录不自动隔离，请人工核对）`]};
  }
  if (!issue || record.dataStatus === 'quarantined') return updated;
  return {...updated, dataStatus:'quarantined', manualReview:'pending', systemValidation:'not_run',
    recommendation:{...record.recommendation,published_cache:false,manual_review:'pending',system_validation:'not_run'},
    quarantine:{at:now,reason:issue.finding,actor:'ai-identity-review',ruleVersion:'quarantine-v1',previousStatus:record.dataStatus,
      previousReview:{manualReview:record.manualReview,systemValidation:record.systemValidation}},updatedBy:'misimport-quarantine'};
}
