// 旧总表（admin_state/competitions）每条记录的字段，用来核对“每个旧字段都有去处”。
// 来源：2026-10-30 从美国服务器导出的线上 380 条的实际字段、10-22 快照、后台新建模板 apps/admin/src/newCompetition.ts、
// 入库模板 candidateToRecord.js，以及线上代码里读写记录的字段。
export const OLD_FIELDS = [
  'id', 'eventId', 'name', 'editionName', 'editionYear', 'editionOrdinal', 'aliases', 'organizer', 'eventLevel',
  'objectiveTags', 'professions', 'participants', 'eligibility', 'formatAndRules', 'teamSize', 'participationFormat',
  'teamSizeCategory', 'registrationMethod', 'registrationOrganization', 'registrationUrl', 'fees', 'feeType',
  'lastVerifiedAt', 'dataStatus', 'systemValidation', 'manualReview', 'qualityIssues', 'discoveryNoticeUrl',
  'noticeResolution', 'discovery', 'recommendation', 'sources',
  'schedule.id', 'schedule.edition_id', 'schedule.track_id', 'schedule.registration_start', 'schedule.registration_end',
  'schedule.competition_start', 'schedule.competition_end', 'schedule.pending_announcement', 'schedule.status_override',
  'schedule.status_override_reason', 'schedule.time_note', 'schedule.change_status', 'schedule.registration_end_note',
  'track.id', 'track.edition_id', 'track.name', 'track.scope_note',
  'rewardAmount', 'rewardTier', 'rewardHighlights', 'rewards', 'participantCount', 'participantUnit', 'scaleTier',
  'participantScale', 'region', 'lifecycle', 'recognition',
  'aiReview', 'aiReviewFailure', 'aiResolution', 'fieldVerification', 'fieldVerificationFailure',
  'updatedAt', 'updatedBy', 'createdAt', 'createdBy', 'systemReviewIssues', 'systemReviewedAt',
  'manualReviewOverride', 'manualReviewReason', 'manualReviewedAt', 'needsManualReview',
  'parentEventId', 'supersededBy', 'curationList', 'archivedAt', 'nextEditionEstimate', 'poster', 'posterCandidates',
  // 2026-10-30 导出线上全部 380 条后补上的（10-22 快照和代码里没出现）
  'firstSeenAt', 'admissionVerdict', 'regionBasis', 'archivedReason', 'curationBatch', 'ruleVersion', 'verifiedBy', 'task',
  'curationListItem', 'triage', 'enumNormalization', 'publishedAt', 'reviewedAt', 'aiProfessionClassification', 'staleDraftReason',
  'nextEditionEndEstimate', 'nextEditionBasis', 'aiResolutionFailure', 'manualReviewedBy', 'aiFieldVerification', 'quarantine',
  'aiAutoPublishNote', 'quarantineResolution', 'fieldVerificationResolution', 'restoredFrom',
];

// 不搬的旧字段和原因
export const NOT_MOVED = {
  'schedule.id': '新结构里时间直接是届次的字段，不再需要单独编号',
  'schedule.edition_id': '同上',
  'schedule.track_id': '每届只有一个赛道，赛道并进届次',
  'schedule.change_status': '线上 343 条全是 normal，没有用到',
  'schedule.registration_end_note': '线上只有 2 条有，建库时并进 time_note',
  'track.id': '赛道并进届次，不再需要单独编号',
  'track.edition_id': '同上',
};
