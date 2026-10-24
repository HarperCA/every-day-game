import { callPublicData } from './cloudSession';
import { hydratePublic } from './publicRecord';
import { PROFESSION_CATEGORIES } from './filterOptions';
import { matchesCompetitionPreferences, surveyProvinceOptions } from './competitionPreferences';

// 用户端唯一的数据入口：只读服务器上的公开缓存（已发布、已核验的赛事）。
// 早期用 30 场本地样例数据开发时的“开发预览”模式已于 2026-09-30 删除。

export interface Query {
  // 首页：一级筛选与搜索取并集，其他筛选仍同时作用于两部分结果。
  searchUnion?: boolean;
  competitionCategories?: string[];
  preferenceProvince?: string;
  keyword?: string;
  registrationStatus?: string;
  eventLevel?: string;
  profession?: string;
  participationFormat?: string;
  teamSizeCategory?: string;
  feeType?: string;
  registrationOrganization?: string;
  region?: string;
  // 距离下一次能报名还有多久：报名中记 0，即将报名用官方开始时间，
  // 已归档用推算的下一届时间（见服务端 competitionRanking.js 的同名逻辑）。
  registrationWithin?: '1m' | '3m' | '6m' | '';
  sortBy?: 'time' | '';
  sortOrder?: 'asc' | 'desc' | '';
  page?: number;
  pageSize?: number;
}

export async function listCompetitions(query: Query):Promise<{items:Array<ReturnType<typeof hydratePublic>>; total:number; hasMore:boolean}> {
  const { searchUnion, ...plainQuery } = query;
  query = plainQuery;
  const hasPrimary = Boolean(query.region || query.preferenceProvince || query.competitionCategories?.length || query.profession || query.registrationStatus);
  if (searchUnion && query.keyword?.trim() && hasPrimary) {
    const allQuery = { ...query, page:100, pageSize:100, searchUnion:false };
    const loadAll = async (branch:Query) => {
      let result = await listCompetitions(branch);
      if (result.hasMore) result = await listCompetitions({ ...branch, page:Math.ceil(result.total / 100) });
      return result.items;
    };
    const secondaryQuery = { ...allQuery, region:'', preferenceProvince:'', competitionCategories:[], profession:'', registrationStatus:'' };
    const [primary, searched, ranked] = await Promise.all([
      loadAll({ ...allQuery, keyword:'' }),
      loadAll(secondaryQuery),
      loadAll({ ...secondaryQuery, keyword:'' }),
    ]);
    const selectedIds = new Set([...primary, ...searched].map(item => item.id));
    const searchedIds = new Set(searched.map(item => item.id));
    const merged = ranked.filter(item => selectedIds.has(item.id));
    if (!query.sortBy && !query.sortOrder) {
      merged.sort((a,b) => Number(searchedIds.has(b.id)) - Number(searchedIds.has(a.id)));
    }
    // 搜索结果优先，同一组保留服务端顺序，已结束赛事始终放到最后。
    const ended = (item:any) => item.registrationStatus === '已截止' || item.dataStatus === 'archived';
    const ordered = [...merged.filter(item => !ended(item)), ...merged.filter(ended)];
    const visible = Math.max(1, query.page || 1) * Math.min(100, Math.max(1, query.pageSize || 8));
    return { items:ordered.slice(0, visible), total:ordered.length, hasMore:visible < ordered.length };
  }
  // 选择所在省份时，查询该省、所属大区及全国可参加的赛事。
  // 选“全国”时查询不限地区的赛事（全国、国际、全球、不限、未填地区），不再要求地区一字不差等于“全国”（2026-10-18，用户定）。
  // 先去除服务端地区的严格相等条件，使用同一套偏好地区匹配规则。
  if (query.region && surveyProvinceOptions.includes(query.region)) {
    query = { ...query, preferenceProvince: query.region, region: '' };
  }
  if (query.competitionCategories?.length || query.preferenceProvince) {
    const { competitionCategories, preferenceProvince, ...serverQuery } = query;
    // 公开接口返回累计分页。先取完整候选集再筛选，保证总数和翻页都准确。
    let result = await callPublicData<{ items:any[]; total:number; hasMore:boolean }>('list', { query:{...serverQuery, page:1, pageSize:100} });
    if (result.hasMore) result = await callPublicData('list', { query:{...serverQuery, page:Math.ceil(result.total / 100), pageSize:100} });
    const matched = result.items.filter(item => matchesCompetitionPreferences(item, competitionCategories, preferenceProvince));
    const visible = Math.max(1, query.page || 1) * Math.min(100, Math.max(1, query.pageSize || 8));
    return {items:matched.slice(0, visible).map(hydratePublic), total:matched.length, hasMore:visible < matched.length};
  }
  const result = await callPublicData<{ items:any[]; total:number; hasMore:boolean }>('list', { query });
  return { ...result, items:result.items.map(hydratePublic) };
}

// 首页（2026-10-24 起）：一次请求走新版列表（listVersion 2），服务器筛好、排好、分好页。
// 有搜索词时服务器不按专业大类、省份和状态分组筛，搜索词映射出的专业大类放在 appliedCategories 里给筛选面板显示。
// 分页是累计的：第 n 页返回前 n×pageSize 条，手机整页替换。
export interface HomeQuery {
  keyword?: string;
  categories?: string[];
  province?: string;
  listGroups?: string[];
  eventLevel?: string;
  participationFormat?: string;
  teamSizeCategory?: string;
  feeType?: string;
  registrationOrganization?: string;
  registrationWithin?: string;
  favoriteIds?: string[];
  reminderIds?: string[];
  page?: number;
  pageSize?: number;
}

export async function listHomeCompetitions(query: HomeQuery):Promise<{items:Array<ReturnType<typeof hydratePublic>>; total:number; hasMore:boolean; appliedCategories:string[]|null}> {
  const keyword = String(query.keyword || '').trim();
  // 没选的条件不带，请求小一些，服务器缓存键也一致
  const sent: Record<string, unknown> = { listVersion:2, page:query.page || 1, pageSize:query.pageSize || 16 };
  for (const key of ['eventLevel', 'participationFormat', 'teamSizeCategory', 'feeType', 'registrationOrganization', 'registrationWithin'] as const) {
    if (query[key]) sent[key] = query[key];
  }
  if (keyword) sent.keyword = keyword;
  else {
    if (query.categories?.length) sent.categories = query.categories;
    if (query.province) sent.province = query.province;
    if (query.listGroups?.length) sent.listGroups = query.listGroups;
  }
  if (query.favoriteIds?.length) sent.favoriteIds = query.favoriteIds;
  if (query.reminderIds?.length) sent.reminderIds = query.reminderIds;
  const result = await callPublicData<{ items:any[]; total:number; hasMore:boolean; appliedFilters?:{ categories?:string[] } }>('list', { query:sent });
  return {
    items:(result.items || []).map(hydratePublic), total:result.total || 0, hasMore:Boolean(result.hasMore),
    appliedCategories:keyword ? (result.appliedFilters?.categories || []) : null,
  };
}

export async function getCompetition(id: string) {
  return hydratePublic(await callPublicData<any>('get', { id }));
}

// 给用户选的专业大类：不含“综合/不限专业”。选任何一个专业时，不限专业的比赛本来就会一起显示
// （competitionPreferences.ts 的 matchesCompetitionPreferences），单独选它没有意义（2026-10-17，用户定）。
// 比赛本身的这个标签和后端校验的 13 类清单不变。
export function getProfessionOptions(): string[] {
  return PROFESSION_CATEGORIES.filter(name => name !== '综合/不限专业');
}
