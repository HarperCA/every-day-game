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
  // 先去除服务端地区的严格相等条件，使用同一套偏好地区匹配规则。
  if (query.region && surveyProvinceOptions.slice(1).includes(query.region)) {
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

export async function getCompetition(id: string) {
  return hydratePublic(await callPublicData<any>('get', { id }));
}

export function getProfessionOptions(): string[] {
  return PROFESSION_CATEGORIES;
}
