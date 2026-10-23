// 公开接口（publicData）返回的记录 → 页面用的字段。
// 不引用 wx，测试可以直接加载这个文件。

export const STATUS_CLASS: Record<string, string> = { '报名中': 'status-open', '即将报名': 'status-upcoming', '时间待公布': 'status-pending', '已截止': 'status-closed' };

// 推荐等级只有真正评过的五档才显示（2026-10-01，用户定）。
// “信息不足”原先是新记录的默认等级、从来没人评过，137 条公开比赛里 116 条挂着它，其中 112 条核心信息其实齐全；
// 现在不再当推荐等级，只在缺信息的那个字段里写“信息不足”。
export const RECOMMENDATION_LEVELS = ['强烈推荐', '值得参加', '适合练手', '高难挑战', '谨慎报名'];
const MISSING_TEXT = /^(?:暂未明确|未明确|待确认|待核实|未知|暂无|无|待官方资料补充|待补充|-|—)$/;
export const INSUFFICIENT = '信息不足';
// 字段为空、或只写着“暂未明确”“待确认”之类的，显示“信息不足”
export function fieldText(value: unknown): string {
  const text = String(value ?? '').trim();
  return !text || MISSING_TEXT.test(text) ? INSUFFICIENT : text;
}

export function reminderTarget(value: unknown, boundary: 'start' | 'end'): string {
  if (typeof value !== 'string' || !value) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${boundary === 'end' ? '23:59:59+08:00' : '00:00:00+08:00'}` : value;
}

export function hydratePublic(item: any) {
  const registrationStatus = item.registration_status;
  const eligibilityText = String(item.eligibility || '').trim();
  // 参赛资格单独成行的条件：有实际内容、不是“暂未明确”之类，且跟参赛对象写的不是同一句话
  const showEligibility = fieldText(eligibilityText) !== INSUFFICIENT
    && eligibilityText.replace(/\s+/g, '') !== String(item.participants || '').replace(/\s+/g, '');
  return {
    id:item.id, eventId:item.event_id, name:item.name, editionName:item.edition_name,
    // 赛事海报：接口暂未提供时为空，卡片显示文字封面
    posterUrl:String(item.posterUrl || item.poster_url || ''),
    editionYear:item.edition_year || '', editionOrdinal:item.edition_ordinal || '',
    aliases:item.aliases || [], organizer:item.organizer || '', eventLevel:item.event_level,
    objectiveTags:item.objective_tags || [], professions:item.professions || [], displayProfessions:(item.professions || []).slice(0, 2),
    participants:item.participants || '', eligibility:item.eligibility || '', showEligibility, formatAndRules:item.format_and_rules || '', teamSize:item.team_size || '',
    participationFormat:item.participation_format, teamSizeCategory:item.team_size_category, feeType:item.fee_type, registrationOrganization:item.registration_organization,
    registrationMethod:item.registration_method || '', registrationUrl:item.registration_url || '', fees:item.fees || '',
    registrationStatus, statusClass:STATUS_CLASS[registrationStatus] || 'status-closed',
    registrationStart:reminderTarget(item.registration_start, 'start'), registrationEnd:reminderTarget(item.registration_end, 'end'),
    registrationStartDate:item.registration_start ? item.registration_start.substring(0, 10) : '', registrationEndDate:item.registration_end ? item.registration_end.substring(0, 10) : '', registrationEndNote:String(item.registration_end_note || ''),
    // 时间说明（如“各省赛区自行确定报名时间”），详情页关键时间卡片里原样多行显示
    timeNote:String(item.time_note || '').trim(),
    // 奖项：亮点标签 + 文字说明，两者都没有时详情页不显示这一块
    rewards:String(item.rewards || '').trim(), rewardHighlights:Array.isArray(item.reward_highlights) ? item.reward_highlights : [],
    competitionStartDate:item.competition_start ? item.competition_start.substring(0, 10) : '', competitionEndDate:item.competition_end ? item.competition_end.substring(0, 10) : '',
    scheduleChangeStatus:'normal', lastVerifiedDate:item.last_verified_at ? item.last_verified_at.substring(0, 10) : '待核验',
    track:{ name:item.track_name || '以当届官方通知为准' }, sources:item.sources || [],
    recommendationLevel:RECOMMENDATION_LEVELS.includes(item.recommendation) ? item.recommendation : '', recommendationReasons:item.recommendation_reasons || [],
    recommendation:{ recommendation:RECOMMENDATION_LEVELS.includes(item.recommendation) ? item.recommendation : '', suitable_for:item.recommendation_suitable_for || '', reasons:item.recommendation_reasons || [], limitations:item.recommendation_limitations || [], preparation:item.recommendation_preparation || '', confidence:item.recommendation_confidence || '' },
    registrationUrlUsable:/^https?:\/\//.test(item.registration_url || ''), qualityIssues:[],
    // 详情页各字段的显示文字：缺的写“信息不足”
    fieldText:{
      organizer:fieldText(item.organizer), participants:fieldText(item.participants), eligibility:fieldText(item.eligibility),
      teamSize:fieldText(item.team_size), formatAndRules:fieldText(item.format_and_rules), fees:fieldText(item.fees),
      registrationMethod:fieldText(item.registration_method), rewards:fieldText(item.rewards),
    },
    // 已发布记录由云函数算好，直接读，避免两处逻辑漂移
    schoolTimingDependent:Boolean(item.school_timing_dependent), schoolTimingNote:item.school_timing_note || '',
    timingReliability:item.timing_reliability || 'unverified',
    // 已归档：报名已截止，但保留在库里给学生看"下一届大概什么时候"。
    // 这个估算是按上一届节奏推算的，不是官方信息，界面上要说清楚。
    dataStatus:item.data_status || 'published',
    nextEditionEstimate:item.next_edition_estimate || '',
    nextEditionEstimateDate:item.next_edition_estimate ? item.next_edition_estimate.substring(0, 10) : '',
  };
}
