// 价值评分与排序算法都与 adminData 共用同一份实现（内容必须逐字一致，由测试守护）。
const { rankRecords } = require('./competitionRanking.js');

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
    if (query.region && item.region !== query.region) return false;
    if (query.lifecycle && item.lifecycle !== query.lifecycle) return false;
    // 默认不展示已停办的赛事，但允许显式查询 —— 用户搜它时应看到「已停办」而不是搜不到。
    if (!query.lifecycle && item.lifecycle === '已停办') return false;
    // 已截止是硬过滤而不是降权：报不上名的赛事排在第 50 位依然是噪声。
    if (!query.registrationStatus && item.registration_status === '已截止') return false;
    return true;
  });
  const ranked = rankRecords(filtered, query, now);
  const page = Math.max(1, Math.min(100, Number.isInteger(query.page) ? query.page : 1));
  const pageSize = Math.max(1, Math.min(100, Number.isInteger(query.pageSize) ? query.pageSize : 8));
  const visible = Math.min(ranked.length, page * pageSize);
  return { items:ranked.slice(0, visible), total:ranked.length, hasMore:visible < ranked.length, preview:false };
}

module.exports = { assertPublicRecordCapacity, currentRegistrationStatus, filterPublicRecords, MAX_PUBLIC_RECORDS, normalizePublicRecordId };
