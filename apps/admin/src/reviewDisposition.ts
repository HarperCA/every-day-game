// Manual single/batch review follows the same structured identity decision as the scheduler.
export function applyReviewDisposition(record: any, review: any, now = new Date().toISOString()) {
  const updated = {...record, aiReview:review, updatedAt:now, updatedBy:'kimi-review-assistant'};
  const issue = review?.decision === 'needs_changes' && review?.risk_level === 'high'
    && review.issues?.find((item: any) => item.field === 'event_identity');
  if (!issue || record.dataStatus === 'quarantined') return updated;
  return {...updated, dataStatus:'quarantined', manualReview:'pending', systemValidation:'not_run',
    recommendation:{...record.recommendation,published_cache:false,manual_review:'pending',system_validation:'not_run'},
    quarantine:{at:now,reason:issue.finding,actor:'ai-identity-review',ruleVersion:'quarantine-v1',previousStatus:record.dataStatus,
      previousReview:{manualReview:record.manualReview,systemValidation:record.systemValidation}},updatedBy:'misimport-quarantine'};
}
