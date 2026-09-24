const STATUS_WEIGHT = { '报名中': 0, '即将报名': 1, '时间待公布': 2, '已截止': 3 };
const RECOMMENDATION_WEIGHT = { '强烈推荐': 0, '值得参加': 1, '适合练手': 2, '高难挑战': 3, '谨慎报名': 4, '信息不足': 5 };

function computeRegistrationStatus(schedule, now = new Date()) {
  if (schedule.status_override) return schedule.status_override;
  const start = schedule.registration_start ? new Date(schedule.registration_start) : null;
  const end = schedule.registration_end ? new Date(schedule.registration_end) : null;
  if (end && now > end) return '已截止';
  if (!start) return '时间待公布';
  if (now < start) return '即将报名';
  return '报名中';
}

function matchesQuery(item, query) {
  const keyword = (query.keyword || '').trim().toLowerCase();
  if (keyword) {
    const haystack = [item.name, item.editionName, item.organizer, ...(item.aliases || []), ...(item.objectiveTags || [])].join(' ').toLowerCase();
    if (!haystack.includes(keyword)) return false;
  }
  if (query.registrationStatus && item.registrationStatus !== query.registrationStatus) return false;
  if (query.eventLevel && item.eventLevel !== query.eventLevel) return false;
  if (query.profession && !(item.professions || []).includes(query.profession)) return false;
  if (query.participationFormat && item.participationFormat !== query.participationFormat) return false;
  if (query.teamSizeCategory && item.teamSizeCategory !== query.teamSizeCategory) return false;
  if (query.feeType && item.feeType !== query.feeType) return false;
  if (query.registrationOrganization && item.registrationOrganization !== query.registrationOrganization) return false;
  return true;
}

function sortCompetitions(items) {
  return [...items].sort((a, b) => {
    const status = STATUS_WEIGHT[a.registrationStatus] - STATUS_WEIGHT[b.registrationStatus];
    if (status) return status;
    const recommendation = RECOMMENDATION_WEIGHT[a.recommendation] - RECOMMENDATION_WEIGHT[b.recommendation];
    if (recommendation) return recommendation;
    const quality = (a.qualityIssues?.length || 0) - (b.qualityIssues?.length || 0);
    if (quality) return quality;
    const aEnd = a.registrationEnd ? new Date(a.registrationEnd).getTime() : Number.MAX_SAFE_INTEGER;
    const bEnd = b.registrationEnd ? new Date(b.registrationEnd).getTime() : Number.MAX_SAFE_INTEGER;
    return aEnd - bEnd;
  });
}

function listPublic(items) {
  return items.filter((item) => item.dataStatus === 'published' && item.systemValidation === 'passed' && item.manualReview === 'passed');
}

function rankSearchResult(item, keyword) {
  const query = keyword.trim().toLowerCase();
  if (!query) return 0;
  const name = item.name.toLowerCase();
  const aliases = (item.aliases || []).map((value) => value.toLowerCase());
  if (name === query) return 0;
  if (aliases.includes(query)) return 1;
  if (name.includes(query)) return 10;
  if (aliases.some((value) => value.includes(query))) return 11;
  if ((item.organizer || '').toLowerCase().includes(query)) return 20;
  return 30;
}

module.exports = { computeRegistrationStatus, matchesQuery, sortCompetitions, listPublic, rankSearchResult };
