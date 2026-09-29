// 公开接口（publicData）返回的记录 → 页面用的字段。
// 小程序和网页测试版（apps/web）共用这一份，两边显示的字段口径一致。
// 不能引用 wx 或种子数据：网页端会直接打包这个文件。

export const STATUS_CLASS: Record<string, string> = { '报名中': 'status-open', '即将报名': 'status-upcoming', '时间待公布': 'status-pending', '已截止': 'status-closed' };

export function hydratePublic(item: any) {
  const registrationStatus = item.registration_status;
  return {
    id:item.id, eventId:item.event_id, name:item.name, editionName:item.edition_name,
    editionYear:item.edition_year || '', editionOrdinal:item.edition_ordinal || '',
    aliases:item.aliases || [], organizer:item.organizer || '', eventLevel:item.event_level,
    objectiveTags:item.objective_tags || [], professions:item.professions || [], displayProfessions:(item.professions || []).slice(0, 2),
    participants:item.participants || '', eligibility:item.eligibility || '', formatAndRules:item.format_and_rules || '', teamSize:item.team_size || '',
    participationFormat:item.participation_format, teamSizeCategory:item.team_size_category, feeType:item.fee_type, registrationOrganization:item.registration_organization,
    registrationMethod:item.registration_method || '', registrationUrl:item.registration_url || '', fees:item.fees || '',
    registrationStatus, statusClass:STATUS_CLASS[registrationStatus] || 'status-closed',
    registrationStart:item.registration_start || '', registrationEnd:item.registration_end || '',
    registrationStartDate:item.registration_start ? item.registration_start.substring(0, 10) : '', registrationEndDate:item.registration_end ? item.registration_end.substring(0, 10) : '',
    competitionStartDate:item.competition_start ? item.competition_start.substring(0, 10) : '', competitionEndDate:item.competition_end ? item.competition_end.substring(0, 10) : '',
    scheduleChangeStatus:'normal', lastVerifiedDate:item.last_verified_at ? item.last_verified_at.substring(0, 10) : '待核验',
    track:{ name:item.track_name || '以当届官方通知为准' }, sources:item.sources || [],
    recommendationLevel:item.recommendation || '信息不足', recommendationReasons:item.recommendation_reasons || [],
    recommendation:{ recommendation:item.recommendation || '信息不足', suitable_for:item.recommendation_suitable_for || '', reasons:item.recommendation_reasons || [], limitations:item.recommendation_limitations || [], preparation:item.recommendation_preparation || '', confidence:item.recommendation_confidence || '' },
    registrationUrlUsable:/^https?:\/\//.test(item.registration_url || ''), qualityIssues:[],
    // 已发布记录由云函数算好，直接读，避免两处逻辑漂移
    schoolTimingDependent:Boolean(item.school_timing_dependent), schoolTimingNote:item.school_timing_note || '',
    timingReliability:item.timing_reliability || 'unverified',
    // 已归档：报名已截止，但保留在库里给学生看"下一届大概什么时候"。
    // 这个估算是按上一届节奏推算的，不是官方信息，界面上要说清楚。
    dataStatus:item.data_status || 'published',
    nextEditionEstimate:item.next_edition_estimate || '',
    nextEditionEstimateDate:item.next_edition_estimate ? item.next_edition_estimate.substring(0, 10) : '',
    preview:false,
  };
}
