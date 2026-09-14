const REGISTRATION_STATUSES = new Set(['时间待公布', '即将报名', '报名中', '已截止']);
const RECOMMENDATION_WEIGHT = { '强烈推荐':0, '值得参加':1, '适合练手':2, '高难挑战':3, '谨慎报名':4, '信息不足':5 };

function registrationStatus(record, now = new Date()) {
  const override = record.schedule?.status_override;
  if (override) {
    if (!REGISTRATION_STATUSES.has(override)) throw new Error('invalid_registration_status_override');
    return override;
  }
  const startValue = record.schedule?.registration_start;
  if (!startValue) return '时间待公布';
  const start = new Date(startValue);
  const end = record.schedule?.registration_end ? new Date(record.schedule.registration_end) : null;
  if (Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime()))) throw new Error('invalid_public_schedule');
  if (now < start) return '即将报名';
  if (end && now > end) return '已截止';
  return '报名中';
}

function requirePublishGate(record) {
  if (record.dataStatus !== 'published') throw new Error('public_cache_requires_published_record');
  if (record.systemValidation !== 'passed') throw new Error('public_cache_system_validation_required');
  if (record.manualReview !== 'passed') throw new Error('public_cache_manual_review_required');
  if (!/^https?:\/\//i.test(record.registrationUrl || '')) throw new Error('public_cache_registration_url_required');
  const hasValidOfficialSource = (record.sources || []).some(source => source?.id && source.source_type && source.is_official && source.validity_status === 'valid' && /^https?:\/\//i.test(source.url || ''));
  if (!hasValidOfficialSource) throw new Error('public_cache_valid_official_source_required');
}

function toPublicCache(record, now = new Date()) {
  requirePublishGate(record);
  const recommendation = record.recommendation?.recommendation || '信息不足';
  const status = registrationStatus(record, now);
  const aliases = Array.isArray(record.aliases) ? record.aliases.filter(value => typeof value === 'string') : [];
  const professions = Array.isArray(record.professions) ? record.professions.filter(value => typeof value === 'string') : [];
  if (!record.id || !record.eventId || !record.name || !record.editionName || !professions.length) throw new Error('invalid_public_cache_record');
  return {
    id:record.id,
    event_id:record.eventId,
    name:record.name,
    edition_name:record.editionName,
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
    last_verified_at:record.lastVerifiedAt || null,
    search_text:[record.name, record.editionName, record.organizer, ...aliases, ...(record.objectiveTags || [])].filter(Boolean).join(' ').toLowerCase(),
    sort_weight:(REGISTRATION_STATUSES.has(status) ? ['报名中','即将报名','时间待公布','已截止'].indexOf(status) : 3) * 10 + (RECOMMENDATION_WEIGHT[recommendation] ?? 5),
    data_status:'published',
    system_validation:'passed',
    manual_review:'passed',
  };
}

async function syncPublicCache(transaction, previousRecords, nextRecords, now = new Date()) {
  const previousPublished = new Set(previousRecords.filter(item => item?.dataStatus === 'published').map(item => item.id));
  const previousById = new Map(previousRecords.map(item => [item?.id, item]));
  const nextIds = new Set(nextRecords.map(item => item?.id).filter(Boolean));
  let published = 0;
  let removed = 0;
  for (const record of nextRecords) {
    if (record?.dataStatus === 'published') {
      const previous = previousById.get(record.id);
      if (!previous || previous.dataStatus !== 'published' || JSON.stringify(previous) !== JSON.stringify(record)) {
        await transaction.collection('event_edition_public_cache').doc(record.id).set({ data:toPublicCache(record, now) });
        published += 1;
      }
    } else if (record?.id && previousPublished.has(record.id)) {
      await transaction.collection('event_edition_public_cache').doc(record.id).remove();
      removed += 1;
    }
  }
  for (const id of previousPublished) {
    if (!nextIds.has(id)) {
      await transaction.collection('event_edition_public_cache').doc(id).remove();
      removed += 1;
    }
  }
  return { publicCachePublished:published, publicCacheRemoved:removed };
}

module.exports = { registrationStatus, requirePublishGate, syncPublicCache, toPublicCache };
