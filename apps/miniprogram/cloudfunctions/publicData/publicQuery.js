// 价值评分与排序算法都与 adminData 共用同一份实现（内容必须逐字一致，由测试守护）。
const { daysUntilNextRegistration, rankRecords } = require('./competitionRanking.js');
const { majorCategories } = require('./majorKeywords.js');

const MAX_PUBLIC_RECORDS = 500;
const PUBLIC_DATA_STATUSES = new Set(['published', 'archived']);
// "距离报名时间"筛选的三档，单位天——用近似值（30.5天/月），这是给学生看的
// 粗筛，不是精确合同期限。
const REGISTRATION_WITHIN_DAYS = { '1m':31, '3m':92, '6m':183 };

function registrationInstant(value, boundary) {
  if (!value) return null;
  const date = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? `${date}T${boundary === 'end' ? '23:59:59.999' : '00:00:00'}+08:00` : date;
  const instant = Date.parse(normalized);
  return Number.isFinite(instant) ? instant : null;
}

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
  if (item.data_status === 'archived') return '已截止';
  const start = registrationInstant(item.registration_start, 'start');
  const end = registrationInstant(item.registration_end, 'end');
  if (end !== null && now.getTime() > end) return '已截止';
  // 没有报名截止日、但比赛结束日已过：报名肯定已经结束，算已截止（2026-10-10，与 adminData/publicCache.js 一致）
  const competitionEnded = registrationInstant(item.competition_end, 'end');
  if (end === null && competitionEnded !== null && now.getTime() > competitionEnded) return '已截止';
  if (item.registration_status_override) return item.registration_status_override;
  if (start === null) return '时间待公布';
  if (now.getTime() < start) return '即将报名';
  // 已开始、没有统一截止日（多见于“以学校或赛区通知为准”的赛事）：算报名中，详情页另有“以学校通知为准”的提示（2026-10-09）。
  // 保护：比赛已经开始（还没有结束日或没到结束日），报名多半已经结束、只是没拿到截止日，不算报名中，显示时间待公布。
  if (end === null) {
    const competitionStarted = registrationInstant(item.competition_start, 'start');
    if (competitionStarted !== null && now.getTime() > competitionStarted) return '时间待公布';
  }
  return '报名中';
}


// 已截止、已归档的一律排在后面，各自内部保持原来的排序（2026-10-01 用户要求：可以查到，但排序在后面）
const isClosed = item => item.registration_status === '已截止' || item.data_status === 'archived';
function closedLast(items) {
  return [...items.filter(item => !isClosed(item)), ...items.filter(isClosed)];
}

function filterPublicRecords(records, query = {}, now = new Date()) {
  const keyword = String(query.keyword || '').trim().toLowerCase().slice(0, 100);
  const withinDays = Object.prototype.hasOwnProperty.call(REGISTRATION_WITHIN_DAYS, query.registrationWithin)
    ? REGISTRATION_WITHIN_DAYS[query.registrationWithin] : null;
  // 搜索词如果像一个专业名（“计算机”“土木工程专业”“临床医学”），除了名称、主办方里含这个词的，
  // 专业大类对得上的比赛也算搜到了（2026-10-01）。名称里直接命中的排在前面，只是专业对得上的排在后面。
  const majors = keyword ? majorCategories(keyword) : [];
  const nameHit = item => String(item.search_text || '').includes(keyword);
  const majorHit = item => majors.length > 0 && (item.professions || []).some(profession => majors.includes(profession));
  const filtered = records.map(item => ({ ...item, registration_status:currentRegistrationStatus(item, now) })).filter(item => {
    if (!PUBLIC_DATA_STATUSES.has(item?.data_status) || item.system_validation !== 'passed' || item.manual_review !== 'passed') return false;
    if (keyword && !nameHit(item) && !majorHit(item)) return false;
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
    if (withinDays !== null) {
      // 开了"距离报名时间"筛选：已截止/已归档不再一律隐藏，改用距离天数判断——
      // 这正是已归档赛事（凭推算的下一届时间）能被看到的唯一入口。
      const days = daysUntilNextRegistration(item, now);
      if (days === null || days > withinDays) return false;
    }
    // 2026-10-01 起：已截止、已归档的不再从默认列表和搜索结果里隐藏（原先是硬过滤），
    // 学生能查到往届比赛，但一律排在所有还能报名的后面（见下面的 closedLast）。
    return true;
  });
  // 搜索词对上专业时：名称里直接命中的先排（各自内部保持原来的推荐排序），再是只有专业对得上的
  const ranked0 = rankRecords(filtered, query, now);
  const ranked = closedLast(majors.length ? [...ranked0.filter(nameHit), ...ranked0.filter(item => !nameHit(item))] : ranked0);
  const page = Math.max(1, Math.min(100, Number.isInteger(query.page) ? query.page : 1));
  const pageSize = Math.max(1, Math.min(100, Number.isInteger(query.pageSize) ? query.pageSize : 8));
  const visible = Math.min(ranked.length, page * pageSize);
  return { items:ranked.slice(0, visible), total:ranked.length, hasMore:visible < ranked.length, preview:false };
}


// 「集合还不存在」和「查询失败」是两回事。
// 公开缓存集合要到第一条记录发布时才会被建出来，在那之前 list 该返回空列表 ——
// 把 DATABASE_COLLECTION_NOT_EXIST 当成错误抛出去，用户看到的就是一串内部错误码。
const MISSING_COLLECTION_CODES = new Set([-502005, 'DATABASE_COLLECTION_NOT_EXIST', 'ResourceNotFound.CollectionNotExists']);

function isMissingCollection(error) {
  if (!error) return false;
  if (MISSING_COLLECTION_CODES.has(error.errCode) || MISSING_COLLECTION_CODES.has(error.code)) return true;
  return /collection[\s_]*(not[\s_]*exist|does[\s_]*not[\s_]*exist)|not[\s_]*exist.*collection/i.test(String(error.message || ''));
}

module.exports = { assertPublicRecordCapacity, currentRegistrationStatus, filterPublicRecords, isMissingCollection, MAX_PUBLIC_RECORDS, normalizePublicRecordId };
