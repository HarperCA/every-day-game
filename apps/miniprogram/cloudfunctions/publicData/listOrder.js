// 新版首页列表（listVersion 2，2026-10-24）：服务器筛好、排好、分好页，只把手机要显示的那一页返回。
// 规则见“第一步 排序规则”：
//   ① 有搜索词：名称命中的在前、只是专业对得上的在后；搜索词映射出的专业大类同时拿来筛，并返回给手机显示在筛选面板；
//   ② 没有搜索词：按手机带来的专业大类、省份筛（偏好还是面板由手机决定），其余面板条件照旧；
//   ③ 按状态分组：报名中 → 时间待公布（含即将报名）→ 比赛中 → 比赛已结束；
//   ④ 组内分档：收藏且有提醒 → 只收藏 → 只有提醒 → 其他（个人部分，每次现算，不进缓存）；
//   ⑤ 同档内：报名截止日越近越靠前；没有截止日的排在后面；已过截止日的（比赛中、比赛已结束）离今天越近越靠前；
//   ⑥ 截止日相同或都没有截止日：综合分越高越靠前（沿用 competitionRanking.js 的打分排序）。
// 收藏、提醒的比赛不符合筛选条件也不显示。旧版小程序不带 listVersion，仍走 publicQuery.js 的老流程，完全不受影响。
const { rankRecords } = require('./competitionRanking.js');
const { majorCategories } = require('./majorKeywords.js');
const { currentRegistrationStatus, passesPublicFilters, registrationInstant, registrationWithinDays } = require('./publicQuery.js');
const { matchesCategories, matchesCompetitionPreferences } = require('./preferenceMatch.js');

const LIST_GROUPS = ['报名中', '时间待公布', '比赛中', '比赛已结束'];
const MAX_MARKED_IDS = 200;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function listGroup(item, now) {
  if (item.registration_status === '报名中') return '报名中';
  if (item.registration_status === '时间待公布' || item.registration_status === '即将报名') return '时间待公布';
  // 报名已截止：有比赛结束日期且今天没过结束日的算“比赛中”（报名截止后、比赛还没开始的也算）
  const competitionEnd = registrationInstant(item.competition_end, 'end');
  return competitionEnd !== null && now.getTime() <= competitionEnd ? '比赛中' : '比赛已结束';
}

function deadlineCompare(a, b, group) {
  const da = registrationInstant(a.registration_end, 'end');
  const db = registrationInstant(b.registration_end, 'end');
  if (da === null && db === null) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  // 报名中、时间待公布：截止日越近越靠前；已过截止日的两组：离今天越近（越晚截止）越靠前
  return group === '比赛中' || group === '比赛已结束' ? db - da : da - db;
}

// 公共顺序：③ 分组、⑤ 截止日、⑥ 综合分；对所有人一样，可以缓存
function publicOrder(items, query, now) {
  const scoreRank = new Map(rankRecords(items, query, now).map((item, index) => [item, index]));
  const withGroup = items.map(item => ({ item, group:listGroup(item, now) }));
  withGroup.sort((a, b) => LIST_GROUPS.indexOf(a.group) - LIST_GROUPS.indexOf(b.group)
    || deadlineCompare(a.item, b.item, a.group)
    || scoreRank.get(a.item) - scoreRank.get(b.item));
  return withGroup.map(({ item, group }) => ({ ...item, list_group:group }));
}

function stringList(value, max, pattern) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(entry => typeof entry === 'string' && pattern.test(entry)))].slice(0, max);
}

// 只取筛选和排序要用的公共条件做缓存的键：收藏、提醒编号、页码都不进
function publicQueryKey(query = {}) {
  const { favoriteIds, reminderIds, page, pageSize, ...rest } = query;
  return JSON.stringify(rest);
}

// 公共部分：筛选 + 公共顺序。结果是完整的有序列表（最多 500 条），由 index.js 按 publicQueryKey 缓存。
function buildPublicList(records, query = {}, now = new Date()) {
  const keyword = String(query.keyword || '').trim().toLowerCase().slice(0, 100);
  const withinDays = registrationWithinDays(query);
  const categories = stringList(query.categories, 13, /^.{1,20}$/);
  const province = typeof query.province === 'string' ? query.province.trim().slice(0, 20) : '';
  // 搜索时：映射出的专业大类拿来筛，同时返回给手机显示在面板上；不再按手机带来的偏好筛
  const searchCategories = keyword ? majorCategories(keyword) : [];
  const nameHit = item => String(item.search_text || '').includes(keyword);
  const filtered = records.map(item => ({ ...item, registration_status:currentRegistrationStatus(item, now) })).filter(item => {
    if (!passesPublicFilters(item, query, now, withinDays)) return false;
    if (keyword) {
      if (searchCategories.length) return matchesCategories(item, searchCategories);
      return nameHit(item);
    }
    return matchesCompetitionPreferences(item, categories, province);
  });
  const ordered = publicOrder(filtered, query, now);
  // 搜索时名称命中的整块在前，只是专业对得上的整块在后，两块里各自保持上面的顺序
  // search_block：0 = 名称命中（或不是搜索），1 = 只是专业对得上；只在服务器内部分档用，返回给手机前被 listFields 去掉
  const items = keyword && searchCategories.length
    ? [...ordered.filter(nameHit).map(item => ({ ...item, search_block:0 })), ...ordered.filter(item => !nameHit(item)).map(item => ({ ...item, search_block:1 }))]
    : ordered.map(item => ({ ...item, search_block:0 }));
  return { items, appliedFilters:keyword ? { categories:searchCategories } : null };
}

// 个人部分：④ 组内分档，在公共列表的副本上做（不能改缓存本身），然后分页
function personalizePage(publicList, query = {}) {
  const favorites = new Set(stringList(query.favoriteIds, MAX_MARKED_IDS, ID_PATTERN));
  const reminders = new Set(stringList(query.reminderIds, MAX_MARKED_IDS, ID_PATTERN));
  const has = (set, item) => set.has(item.id) || set.has(item.event_id);
  const tier = item => {
    const favorite = has(favorites, item);
    const reminder = has(reminders, item);
    return favorite && reminder ? 0 : favorite ? 1 : reminder ? 2 : 3;
  };
  // 搜索时名称命中块和专业块要分开分档，所以按“块 → 分组 → 档次”稳定排序
  const sorted = publicList.items
    .map((item, index) => ({ item, index, tier:tier(item) }))
    .sort((a, b) => a.item.search_block - b.item.search_block
      || LIST_GROUPS.indexOf(a.item.list_group) - LIST_GROUPS.indexOf(b.item.list_group)
      || a.tier - b.tier
      || a.index - b.index)
    .map(entry => entry.item);
  const page = Math.max(1, Math.min(100, Number.isInteger(query.page) ? query.page : 1));
  const pageSize = Math.max(1, Math.min(100, Number.isInteger(query.pageSize) ? query.pageSize : 8));
  const visible = Math.min(sorted.length, page * pageSize);
  return {
    items:sorted.slice(0, visible), total:sorted.length, hasMore:visible < sorted.length, preview:false, listVersion:2,
    ...(publicList.appliedFilters ? { appliedFilters:publicList.appliedFilters } : {}),
  };
}

function isListV2(query) {
  return Boolean(query) && query.listVersion === 2;
}

module.exports = { LIST_GROUPS, buildPublicList, isListV2, listGroup, personalizePage, publicQueryKey };
