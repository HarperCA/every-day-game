const { valueFields } = require('./competitionValue.js');
const { blockedTitleReason, needsNoticeResolution } = require('./noticeResolution.js');
const { titleHasEditionTokens } = require('./editionTitle.js');
const { classifyCompetitionScope } = require('./competitionScope.js');
const REGISTRATION_STATUSES = new Set(['时间待公布', '即将报名', '报名中', '已截止']);
const RECOMMENDATION_WEIGHT = { '强烈推荐':0, '值得参加':1, '适合练手':2, '高难挑战':3, '谨慎报名':4, '信息不足':5 };

function registrationStatus(record, now = new Date()) {
  const override = record.schedule?.status_override;
  if (override) {
    if (!REGISTRATION_STATUSES.has(override)) throw new Error('invalid_registration_status_override');
    return override;
  }
  const startValue = record.schedule?.registration_start;
  const start = startValue ? new Date(startValue) : null;
  const end = record.schedule?.registration_end ? new Date(record.schedule.registration_end) : null;
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) throw new Error('invalid_public_schedule');
  // 截止先于开始判断：只有截止日期、没有开始日期的往届，截止已过就是已截止，不是“时间待公布”。
  if (end && now > end) return '已截止';
  if (!start) return '时间待公布';
  if (now < start) return '即将报名';
  return '报名中';
}

function requirePublishGate(record) {
  if (record.dataStatus !== 'published') throw new Error('public_cache_requires_published_record');
  if (record.systemValidation !== 'passed') throw new Error('public_cache_system_validation_required');
  if (record.manualReview !== 'passed') throw new Error('public_cache_manual_review_required');
  if (blockedTitleReason(record.name) || blockedTitleReason(record.editionName) || needsNoticeResolution(record) || (record.qualityIssues || []).includes('notice_resolution_pending')) throw new Error('public_cache_notice_resolution_required');
  if (classifyCompetitionScope(record).decision !== 'eligible') throw new Error('public_cache_competition_out_of_scope');
  if (titleHasEditionTokens(record.name)) throw new Error('public_cache_title_metadata_not_separated');
  if (!/^https?:\/\//i.test(record.registrationUrl || '')) throw new Error('public_cache_registration_url_required');
  const hasValidOfficialSource = (record.sources || []).some(source => source?.id && source.source_type && !['discovery_notice','university_notice','search_candidate'].includes(source.source_type) && source.is_official && source.validity_status === 'valid' && /^https?:\/\//i.test(source.url || ''));
  if (!hasValidOfficialSource) throw new Error('public_cache_valid_official_source_required');
}

// 归档记录早就通过完整发布门槛才上过线，这里不重新走 requirePublishGate——
// 报名链接、来源核验状态这些"能不能报名"相关的门槛，对一条已经报不上名、
// 只是留着给学生看"下一届大概什么时候"的记录已经不适用了。
function requireArchivedGate(record) {
  if (record.dataStatus === 'quarantined') throw new Error('quarantined_record_not_public');
  if (record.dataStatus !== 'archived') throw new Error('public_cache_requires_archived_record');
  if (blockedTitleReason(record.name) || blockedTitleReason(record.editionName) || needsNoticeResolution(record)) throw new Error('public_cache_notice_resolution_required');
  if (classifyCompetitionScope(record).decision !== 'eligible') throw new Error('public_cache_competition_out_of_scope');
  if (titleHasEditionTokens(record.name)) throw new Error('public_cache_title_metadata_not_separated');
}

function toPublicCache(record, now = new Date()) {
  const archived = record.dataStatus === 'archived';
  if (archived) requireArchivedGate(record); else requirePublishGate(record);
  const recommendation = record.recommendation?.recommendation || '信息不足';
  const status = registrationStatus(record, now);
  const aliases = Array.isArray(record.aliases) ? record.aliases.filter(value => typeof value === 'string') : [];
  const professions = Array.isArray(record.professions) ? record.professions.filter(value => typeof value === 'string') : [];
  // 已归档记录允许专业标签为空——发现时报名就已截止、从没人工看过的候选，
  // 走的是"直接归档"分支（见 intakeSchedule.js），本来就没人给它打过标签。
  // 已发布记录仍然硬性要求非空，学生端的专业筛选靠它才能用。
  if (!record.id || !record.eventId || !record.name || !record.editionName || (!archived && !professions.length)) throw new Error('invalid_public_cache_record');
  return {
    id:record.id,
    event_id:record.eventId,
    name:record.name,
    edition_name:record.editionName,
    edition_year:String(record.editionYear || ''),
    edition_ordinal:String(record.editionOrdinal || ''),
    aliases,
    organizer:String(record.organizer || ''),
    objective_tags:Array.isArray(record.objectiveTags) ? record.objectiveTags.slice(0, 10) : [],
    participants:String(record.participants || ''),
    eligibility:String(record.eligibility || ''),
    format_and_rules:String(record.formatAndRules || ''),
    team_size:String(record.teamSize || ''),
    registration_method:String(record.registrationMethod || ''),
    registration_url:String(record.registrationUrl || ''),
    fees:String(record.fees || ''),
    track_name:String(record.track?.name || ''),
    registration_status:status,
    registration_status_override:record.schedule?.status_override || null,
    event_level:record.eventLevel,
    professions,
    participation_format:record.participationFormat,
    team_size_category:record.teamSizeCategory,
    fee_type:record.feeType,
    registration_organization:record.registrationOrganization,
    registration_start:record.schedule?.registration_start || null,
    registration_end:record.schedule?.registration_end || null,
    competition_start:record.schedule?.competition_start || null,
    competition_end:record.schedule?.competition_end || null,
    recommendation,
    recommendation_reasons:Array.isArray(record.recommendation?.reasons) ? record.recommendation.reasons.slice(0, 3) : [],
    recommendation_suitable_for:String(record.recommendation?.suitable_for || ''),
    recommendation_limitations:Array.isArray(record.recommendation?.limitations) ? record.recommendation.limitations.slice(0, 10) : [],
    recommendation_preparation:String(record.recommendation?.preparation || ''),
    recommendation_confidence:String(record.recommendation?.confidence || ''),
    sources:(record.sources || []).filter(source => source?.id && source.source_type && source.is_official && source.validity_status === 'valid' && /^https?:\/\//i.test(source.url || '')).map(source => ({ id:source.id, source_type:source.source_type, url:source.url })),
    ...valueFields(record),
    last_verified_at:record.lastVerifiedAt || null,
    search_text:[record.name, record.editionName, record.organizer, ...aliases, ...(record.objectiveTags || [])].filter(Boolean).join(' ').toLowerCase(),
    // 与路径无关的排序基准：报名状态 > 推荐等级。
    // 价值分是分路径分岗位的，不能压进一个标量，所以排序在查询层按用户目标叠加。
    sort_weight:(REGISTRATION_STATUSES.has(status) ? ['报名中','即将报名','时间待公布','已截止'].indexOf(status) : 3) * 10 + (RECOMMENDATION_WEIGHT[recommendation] ?? 5),
    data_status:archived ? 'archived' : 'published',
    system_validation:'passed',
    manual_review:'passed',
    // 只有归档记录才有意义；发布中的记录这两个字段恒为 null，保持字段形状一致。
    next_edition_estimate:archived ? (record.nextEditionEstimate || null) : null,
    archived_at:archived ? (record.archivedAt || null) : null,
  };
}

// 是否进公开缓存：已发布、已归档的进；但“被新一届替代”的已归档旧记录（supersededBy，见 ingest-candidates.mjs），
// 要等新一届本身公开（发布或归档）之后才隐藏——新的还在审核时，旧的继续显示，不让小程序里这场比赛凭空消失。
function isPublicNow(record, byId) {
  if (record?.dataStatus === 'published') return true;
  if (record?.dataStatus !== 'archived') return false;
  const successor = record.supersededBy ? byId.get(record.supersededBy) : null;
  return !(successor && successor.id !== record.id && ['published', 'archived'].includes(successor.dataStatus) && !successor.supersededBy);
}

async function syncPublicCache(transaction, previousRecords, nextRecords, now = new Date()) {
  const previousById = new Map(previousRecords.map(item => [item?.id, item]));
  const nextById = new Map(nextRecords.map(item => [item?.id, item]));
  const previousCached = new Set(previousRecords.filter(item => isPublicNow(item, previousById)).map(item => item.id));
  const nextIds = new Set(nextRecords.map(item => item?.id).filter(Boolean));
  let published = 0;
  let removed = 0;
  for (const record of nextRecords) {
    if (isPublicNow(record, nextById)) {
      const previous = previousById.get(record.id);
      if (!previousCached.has(record.id) || !previous || previous.dataStatus !== record.dataStatus || JSON.stringify(previous) !== JSON.stringify(record)) {
        await transaction.collection('event_edition_public_cache').doc(record.id).set({ data:toPublicCache(record, now) });
        published += 1;
      }
    } else if (record?.id && previousCached.has(record.id)) {
      await transaction.collection('event_edition_public_cache').doc(record.id).remove();
      removed += 1;
    }
  }
  for (const id of previousCached) {
    if (!nextIds.has(id)) {
      await transaction.collection('event_edition_public_cache').doc(id).remove();
      removed += 1;
    }
  }
  return { publicCachePublished:published, publicCacheRemoved:removed };
}

module.exports = { registrationStatus, requirePublishGate, syncPublicCache, toPublicCache };
