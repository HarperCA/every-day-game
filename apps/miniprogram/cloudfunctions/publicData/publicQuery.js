const MAX_PUBLIC_RECORDS = 500;

function assertPublicRecordCapacity(records) {
  if (!Array.isArray(records)) throw new Error('invalid_public_records');
  if (records.length > MAX_PUBLIC_RECORDS) throw new Error('public_record_limit_exceeded');
  return records;
}

function normalizePublicRecordId(value) {
  if (typeof value !== 'string') throw new Error('invalid_public_record_id');
  const id = value.trim();
  if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('invalid_public_record_id');
  return id;
}

function currentRegistrationStatus(item, now = new Date()) {
  if (item.registration_status_override) return item.registration_status_override;
  if (!item.registration_start) return '时间待公布';
  const start = new Date(item.registration_start);
  const end = item.registration_end ? new Date(item.registration_end) : null;
  if (now < start) return '即将报名';
  if (end && now > end) return '已截止';
  return '报名中';
}

function filterPublicRecords(records, query = {}, now = new Date()) {
  const keyword = String(query.keyword || '').trim().toLowerCase().slice(0, 100);
  const filtered = records.map(item => ({ ...item, registration_status:currentRegistrationStatus(item, now) })).filter(item => {
    if (item?.data_status !== 'published' || item.system_validation !== 'passed' || item.manual_review !== 'passed') return false;
    if (keyword && !String(item.search_text || '').includes(keyword)) return false;
    if (query.registrationStatus && item.registration_status !== query.registrationStatus) return false;
    if (query.eventLevel && item.event_level !== query.eventLevel) return false;
    if (query.profession && !(item.professions || []).includes(query.profession)) return false;
    if (query.participationFormat && item.participation_format !== query.participationFormat) return false;
    if (query.teamSizeCategory && item.team_size_category !== query.teamSizeCategory) return false;
    if (query.feeType && item.fee_type !== query.feeType) return false;
    if (query.registrationOrganization && item.registration_organization !== query.registrationOrganization) return false;
    return true;
  }).sort((a, b) => Number(a.sort_weight || 0) - Number(b.sort_weight || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
  const page = Math.max(1, Math.min(100, Number.isInteger(query.page) ? query.page : 1));
  const pageSize = Math.max(1, Math.min(100, Number.isInteger(query.pageSize) ? query.pageSize : 8));
  const visible = Math.min(filtered.length, page * pageSize);
  return { items:filtered.slice(0, visible), total:filtered.length, hasMore:visible < filtered.length, preview:false };
}

module.exports = { assertPublicRecordCapacity, currentRegistrationStatus, filterPublicRecords, MAX_PUBLIC_RECORDS, normalizePublicRecordId };
