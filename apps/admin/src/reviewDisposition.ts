// Manual single/batch review follows the same structured identity decision as the scheduler.
// 与 cloudfunctions/adminData/quarantine.js 一致：
//   - 来源不是官方原文（source_quality）：只记问题，任何状态都不隔离；
//   - 已发布记录的身份问题（event_identity）只打“需人工核对”标记，不自动隔离。
const IDENTITY_FLAG = 'AI身份审核：';
const SOURCE_FLAG = 'AI来源审核：';
const QUARANTINE_ON_IDENTITY = false;

function noteSourceQuality(record: any, review: any) {
  const issue = review?.issues?.find((item: any) => item.field === 'source_quality');
  const rest = (record.qualityIssues || []).filter((item: string) => !String(item).startsWith(SOURCE_FLAG));
  if (!issue) {
    if (rest.length === (record.qualityIssues || []).length) return record;
    const next = {...record, qualityIssues:rest};
    if (record.dataStatus === 'published') next.needsManualReview = rest.some((item: string) => /^(周检：|AI身份审核：)/.test(String(item)));
    return next;
  }
  const next = {...record, qualityIssues:[...rest, `${SOURCE_FLAG}${issue.finding}`]};
  if (record.dataStatus === 'published') next.needsManualReview = true;
  return next;
}

export function applyReviewDisposition(input: any, review: any, now = new Date().toISOString()) {
  const record = input.dataStatus === 'quarantined' ? input : noteSourceQuality(input, review);
  const updated = {...record, aiReview:review, updatedAt:now, updatedBy:'kimi-review-assistant'};
  const issue = review?.decision === 'needs_changes' && review?.risk_level === 'high'
    && review.issues?.find((item: any) => item.field === 'event_identity');
  if (record.dataStatus === 'published') {
    const rest = (record.qualityIssues || []).filter((item: string) => !String(item).startsWith(IDENTITY_FLAG));
    if (!issue) {
      if (rest.length === (record.qualityIssues || []).length) return updated;
      return {...updated, qualityIssues:rest, needsManualReview:rest.some((item: string) => /^(周检：|AI来源审核：)/.test(String(item)))};
    }
    return {...updated, needsManualReview:true, updatedBy:'ai-identity-review',
      qualityIssues:[...rest, `${IDENTITY_FLAG}${issue.finding}（已发布记录不自动隔离，请人工核对）`]};
  }
  // 2026-10-09 起：身份有问题不再直接隔离。保留 needs_changes 的审核结论，
  // 下一轮定时审核会交给 Kimi 处置代理：是真比赛就补官方来源后发布或归档，确认不是比赛就删除（先备份）。
  if (!issue || record.dataStatus === 'quarantined' || !QUARANTINE_ON_IDENTITY) return updated;
  return {...updated, dataStatus:'quarantined', manualReview:'pending', systemValidation:'not_run',
    recommendation:{...record.recommendation,published_cache:false,manual_review:'pending',system_validation:'not_run'},
    quarantine:{at:now,reason:issue.finding,actor:'ai-identity-review',ruleVersion:'quarantine-v1',previousStatus:record.dataStatus,
      previousReview:{manualReview:record.manualReview,systemValidation:record.systemValidation}},updatedBy:'misimport-quarantine'};
}
