import { callPublicData } from './cloudSession';
import { hydratePublic } from './publicRecord';
import { PROFESSION_CATEGORIES } from './filterOptions';

// 用户端唯一的数据入口：只读服务器上的公开缓存（已发布、已核验的赛事）。
// 早期用 30 场本地样例数据开发时的“开发预览”模式已于 2026-09-30 删除。

export interface Query {
  keyword?: string;
  registrationStatus?: string;
  eventLevel?: string;
  profession?: string;
  participationFormat?: string;
  teamSizeCategory?: string;
  feeType?: string;
  registrationOrganization?: string;
  // 距离下一次能报名还有多久：报名中记 0，即将报名用官方开始时间，
  // 已归档用推算的下一届时间（见服务端 competitionRanking.js 的同名逻辑）。
  registrationWithin?: '1m' | '3m' | '6m' | '';
  sortBy?: 'time' | '';
  sortOrder?: 'asc' | 'desc' | '';
  page?: number;
  pageSize?: number;
}

export async function listCompetitions(query: Query) {
  const result = await callPublicData<{ items:any[]; total:number; hasMore:boolean }>('list', { query });
  return { ...result, items:result.items.map(hydratePublic) };
}

export async function getCompetition(id: string) {
  return hydratePublic(await callPublicData<any>('get', { id }));
}

export function getProfessionOptions(): string[] {
  return PROFESSION_CATEGORIES;
}
