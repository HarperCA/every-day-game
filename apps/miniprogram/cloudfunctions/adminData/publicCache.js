const { valueFields } = require('./competitionValue.js');
const { blockedTitleReason, needsNoticeResolution } = require('./noticeResolution.js');
const { titleHasEditionTokens } = require('./editionTitle.js');
const { classifyCompetitionScope } = require('./competitionScope.js');
const { registrationInstant, registrationScheduleIssues, unresolvedRegistrationQualityIssues } = require('./registrationSchedule.js');
const REGISTRATION_STATUSES = new Set(['时间待公布', '即将报名', '报名中', '已截止']);
const RECOMMENDATION_WEIGHT = { '强烈推荐':0, '值得参加':1, '适合练手':2, '高难挑战':3, '谨慎报名':4, '信息不足':5 };

function registrationStatus(record, now = new Date()) {
  const override = record.schedule?.status_override;
  if (override && !REGISTRATION_STATUSES.has(override)) throw new Error('invalid_registration_status_override');
  const startValue = record.schedule?.registration_start;
  const start = registrationInstant(startValue, 'start');
  const end = registrationInstant(record.schedule?.registration_end, 'end');
  if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end))) throw new Error('invalid_public_schedule');
  // 截止日期已过时不能被旧的“报名中”手动状态覆盖；延期须更新真实截止日期。
  if (end !== null && now.getTime() > end) return '已截止';
  // 没有报名截止日、但比赛结束日已过：报名肯定已经结束，算已截止，定时归档会把它收进归档（2026-10-10 用户定）。
  // 原先显示“时间待公布”，归档只认“已截止”，比赛结束了还一直挂着（如全国大学生英语竞赛）。
  const competitionEnded = registrationInstant(record.schedule?.competition_end, 'end');
  if (end === null && competitionEnded !== null && now.getTime() > competitionEnded) return '已截止';
  if (override) return override;
  if (start === null) return '时间待公布';
  if (now.getTime() < start) return '即将报名';
  // 已开始、没有统一截止日（多见于“以学校或赛区通知为准”的赛事）：算报名中，详情页另有“以学校通知为准”的提示（2026-10-09）。
  // 保护：比赛已经开始（还没有结束日或没到结束日），报名多半已经结束、只是没拿到截止日，不算报名中，显示时间待公布。
  if (end === null) {
    const competitionStarted = registrationInstant(record.schedule?.competition_start, 'start');
    if (competitionStarted !== null && now.getTime() > competitionStarted) return '时间待公布';
  }
  return '报名中';
}

function hasReviewedOfficialSource(record) {
  return (Array.isArray(record.sources) ? record.sources : []).some(source =>
    source?.id && source.source_type
    && !['discovery_notice','university_notice','search_candidate'].includes(source.source_type)
    && source.is_official === true && source.validity_status === 'valid'
    && /^https?:\/\//i.test(source.url || '')
    && (!source.edition_id || source.edition_id === record.id)
    && Number.isFinite(Date.parse(source.last_verified_at || ''))
    && ['title', 'content_summary', 'evidence_excerpt', 'review_reason'].every(field =>
      typeof source[field] === 'string' && source[field].trim())
    && Array.isArray(source.supports_fields)
    && source.supports_fields.some(field => typeof field === 'string' && field.trim()));
}

function hasLegacyOfficialSource(record) {
  return (Array.isArray(record.sources) ? record.sources : []).some(source =>
    source?.id && source.source_type
    && !['discovery_notice','university_notice','search_candidate'].includes(source.source_type)
    && source.is_official === true && source.validity_status === 'valid'
    && /^https?:\/\//i.test(source.url || '')
    && (!source.edition_id || source.edition_id === record.id));
}

function sourceIdentity(sources) {
  return JSON.stringify((Array.isArray(sources) ? sources : []).map(source => ({
    id:source?.id, source_type:source?.source_type, url:source?.url,
    is_official:source?.is_official, validity_status:source?.validity_status,
    edition_id:source?.edition_id,
  })));
}

function publishFactsIdentity(record) {
  return JSON.stringify({
    name:record?.name, editionName:record?.editionName,
    editionYear:record?.editionYear, editionOrdinal:record?.editionOrdinal,
    registrationUrl:record?.registrationUrl,
    registrationStart:record?.schedule?.registration_start,
    registrationEnd:record?.schedule?.registration_end,
  });
}

function requirePublishGate(record, { allowLegacySourceEvidence = false } = {}) {
  if (record.dataStatus !== 'published') throw new Error('public_cache_requires_published_record');
  if (record.systemValidation !== 'passed') throw new Error('public_cache_system_validation_required');
  if (record.manualReview !== 'passed') throw new Error('public_cache_manual_review_required');
  if (blockedTitleReason(record.name) || blockedTitleReason(record.editionName) || needsNoticeResolution(record) || (record.qualityIssues || []).includes('notice_resolution_pending')) throw new Error('public_cache_notice_resolution_required');
  if (classifyCompetitionScope(record).decision !== 'eligible') throw new Error('public_cache_competition_out_of_scope');
  if (titleHasEditionTokens(record.name)) throw new Error('public_cache_title_metadata_not_separated');
  if (registrationScheduleIssues(record.schedule).length) throw new Error('public_cache_invalid_registration_schedule');
  if (unresolvedRegistrationQualityIssues(record).some(issue => /^registration_(?:start|end|time)_pending$/.test(issue))) throw new Error('public_cache_registration_time_unverified');
  if (!/^https?:\/\//i.test(record.registrationUrl || '')) throw new Error('public_cache_registration_url_required');
  if (!hasReviewedOfficialSource(record) && !(allowLegacySourceEvidence && hasLegacyOfficialSource(record))) {
    throw new Error('public_cache_valid_official_source_required');
  }
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

function toPublicCache(record, now = new Date(), gateOptions = {}) {
  const archived = record.dataStatus === 'archived';
  if (archived) requireArchivedGate(record); else requirePublishGate(record, gateOptions);
  const recommendation = record.recommendation?.recommendation || '信息不足';
  const status = archived ? '已截止' : registrationStatus(record, now);
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
    // 赛事海报（2026-10，首页瀑布流卡片用）：只发 https 地址，其余留空，小程序显示统一占位图
    poster_url:/^https:\/\//i.test(record.posterUrl || '') ? String(record.posterUrl).slice(0, 500) : '',
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
    // 报名截止说明（2026-10-09 起）：各赛项、各校截止不同时，截止日期填其中最晚的一个，这里写明“最晚报名时间”等；
    // 完全没有日期时，说明代替“待公布”显示
    registration_end_note:String(record.schedule?.registration_end_note || '').trim().slice(0, 40),
    // 时间说明（2026-10-11 起带上）：多赛道各自截止、“全国总决赛预计……”“报名时间由各省赛区确定”这类说明原先小程序看不到
    time_note:String(record.schedule?.time_note || '').trim().slice(0, 500),
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

// Retry bookkeeping must persist even when an old published record has invalid facts.
// Actual content changes still pass through the full publication gate.
function cacheRelevantIdentity(record) {
  const { aiReviewFailure, fieldVerificationFailure, updatedAt, updatedBy, ...content } = record || {};
  return JSON.stringify(content);
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
      if (!previousCached.has(record.id) || !previous || previous.dataStatus !== record.dataStatus || cacheRelevantIdentity(previous) !== cacheRelevantIdentity(record)) {
        // 旧记录已上线时允许继续同步普通字段更新；来源身份一旦变化，或从其他状态
        // 转为发布，就必须补齐人工核验的原文证据。避免周检更新卡住整个后台保存。
        const allowLegacySourceEvidence = previous?.dataStatus === 'published'
          && record.dataStatus === 'published'
          && sourceIdentity(previous.sources) === sourceIdentity(record.sources)
          && publishFactsIdentity(previous) === publishFactsIdentity(record);
        await transaction.collection('event_edition_public_cache').doc(record.id).set({ data:toPublicCache(record, now, { allowLegacySourceEvidence }) });
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
