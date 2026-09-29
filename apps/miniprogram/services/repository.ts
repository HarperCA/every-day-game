const seed = require('../data/competitions');
import { USE_CLOUD_PUBLIC_DATA } from '../config/cloud';
import { callPublicData } from './cloudSession';
import { schoolTimingAdvice } from './timing';
import { STATUS_CLASS, hydratePublic } from './publicRecord';

const STATUS_WEIGHT: Record<string, number> = { '报名中': 0, '即将报名': 1, '时间待公布': 2, '已截止': 3 };
const RECOMMENDATION_WEIGHT: Record<string, number> = { '强烈推荐': 0, '值得参加': 1, '适合练手': 2, '高难挑战': 3, '谨慎报名': 4, '信息不足': 5 };

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

function computeStatus(schedule: any, now = new Date()) {
  if (schedule.status_override) return schedule.status_override;
  const end = schedule.registration_end ? new Date(schedule.registration_end) : null;
  if (end && now > end) return '已截止';
  if (!schedule.registration_start) return '时间待公布';
  if (now < new Date(schedule.registration_start)) return '即将报名';
  return '报名中';
}

function hydrate(item: any) {
  const registrationStatus = computeStatus(item.schedule);
  const title = String(item.name || '').replace(/(?<!\d)(?:19|20)\d{2}(?:\s*[-—–~～至]\s*(?:19|20)\d{2})?(?:年(?:度)?|赛季)?(?!\d)/g, '').replace(/第[零〇一二三四五六七八九十百千万两\d]+届/g, '').replace(/\(\s*\)|（\s*）/g, '').trim();
  const editionText = `${item.name || ''} ${item.editionName || ''}`;
  const yearMatch = editionText.match(/(?<!\d)((?:19|20)\d{2}(?:\s*[-—–~～至]\s*(?:19|20)\d{2})?)(?!\d)/);
  const ordinalMatch = editionText.match(/第[零〇一二三四五六七八九十百千万两\d]+届/);
  return {
    ...item,
    name:title || item.name,
    editionYear:item.editionYear || (yearMatch ? yearMatch[1].replace(/\s*[-–~～至]\s*/g, '—') : ''),
    editionOrdinal:item.editionOrdinal || ordinalMatch?.[0] || '',
    registrationStatus,
    statusClass: STATUS_CLASS[registrationStatus] || 'status-closed',
    registrationStart: item.schedule.registration_start,
    registrationEnd: item.schedule.registration_end,
    registrationStartDate: item.schedule.registration_start ? item.schedule.registration_start.substring(0, 10) : '',
    registrationEndDate: item.schedule.registration_end ? item.schedule.registration_end.substring(0, 10) : '',
    scheduleChangeStatus: item.schedule.change_status || 'normal',
    competitionStartDate: item.schedule.competition_start ? item.schedule.competition_start.substring(0, 10) : '',
    competitionEndDate: item.schedule.competition_end ? item.schedule.competition_end.substring(0, 10) : '',
    lastVerifiedDate: item.lastVerifiedAt ? item.lastVerifiedAt.substring(0, 10) : '待核验',
    displayProfessions: item.professions.slice(0, 2),
    recommendationLevel: item.recommendation.recommendation,
    recommendationReasons: item.recommendation.reasons,
    registrationUrlUsable: /^https?:\/\//.test(item.registrationUrl || ''),
    // 预览走本地种子数据，没有经过云函数，所以在这里算
    ...(() => {
      const timing = schoolTimingAdvice(item.registrationOrganization || '');
      return { schoolTimingDependent: timing.dependent, schoolTimingNote: timing.note, timingReliability: timing.reliability };
    })(),
    // 种子数据没有"归档"这个概念，字段形状跟云端数据保持一致就行。
    dataStatus: 'published',
    nextEditionEstimate: '',
    nextEditionEstimateDate: '',
    preview: true,
  };
}

function compare(a: any, b: any) {
  const relevance = (a.searchScore ?? 0) - (b.searchScore ?? 0);
  if (relevance) return relevance;
  const status = STATUS_WEIGHT[a.registrationStatus] - STATUS_WEIGHT[b.registrationStatus];
  if (status) return status;
  const recommendation = RECOMMENDATION_WEIGHT[a.recommendationLevel] - RECOMMENDATION_WEIGHT[b.recommendationLevel];
  if (recommendation) return recommendation;
  const quality = a.qualityIssues.length - b.qualityIssues.length;
  if (quality) return quality;
  const aEnd = a.registrationEnd ? new Date(a.registrationEnd).getTime() : Number.MAX_SAFE_INTEGER;
  const bEnd = b.registrationEnd ? new Date(b.registrationEnd).getTime() : Number.MAX_SAFE_INTEGER;
  return aEnd - bEnd;
}

function searchScore(item: any, keyword: string) {
  if (!keyword) return 0;
  const name = item.name.toLowerCase();
  const aliases = item.aliases.map((value: string) => value.toLowerCase());
  const organizer = item.organizer.toLowerCase();
  if (name === keyword) return 0;
  if (aliases.includes(keyword)) return 1;
  if (name.includes(keyword)) return 10;
  if (aliases.some((value: string) => value.includes(keyword))) return 11;
  if (organizer.includes(keyword)) return 20;
  return 30;
}

const REGISTRATION_WITHIN_DAYS: Record<string, number> = { '1m':31, '3m':92, '6m':183 };

// 跟服务端 competitionRanking.js 的 daysUntilNextRegistration 同一个口径，
// 只是种子数据没有"已归档"这个状态，缺了 next_edition_estimate 那一支。
function daysUntilRegistration(item: any, now: Date): number | null {
  if (item.registrationStatus === '报名中') return 0;
  if (item.registrationStatus === '即将报名' && item.registrationStart) {
    return (new Date(item.registrationStart).getTime() - now.getTime()) / 86400000;
  }
  return null;
}

export async function listCompetitions(query: Query) {
  if (USE_CLOUD_PUBLIC_DATA) {
    const result = await callPublicData<{ items:any[]; total:number; hasMore:boolean; preview:false }>('list', { query });
    return { ...result, items:result.items.map(hydratePublic) };
  }
  await new Promise((resolve) => setTimeout(resolve, 180));
  const keyword = (query.keyword || '').trim().toLowerCase();
  const now = new Date();
  const withinDays = query.registrationWithin ? REGISTRATION_WITHIN_DAYS[query.registrationWithin] : null;
  let items = seed.map(hydrate).filter((item: any) => {
    if (keyword) {
      const searchable = [item.name, item.editionName, item.organizer, ...item.aliases, ...item.objectiveTags].join(' ').toLowerCase();
      if (!searchable.includes(keyword)) return false;
    }
    if (query.registrationStatus && item.registrationStatus !== query.registrationStatus) return false;
    if (query.eventLevel && item.eventLevel !== query.eventLevel) return false;
    if (query.profession && !item.professions.includes(query.profession)) return false;
    if (query.participationFormat && item.participationFormat !== query.participationFormat) return false;
    if (query.teamSizeCategory && item.teamSizeCategory !== query.teamSizeCategory) return false;
    if (query.feeType && item.feeType !== query.feeType) return false;
    if (query.registrationOrganization && item.registrationOrganization !== query.registrationOrganization) return false;
    if (withinDays !== null) {
      const days = daysUntilRegistration(item, now);
      if (days === null || days > withinDays) return false;
    }
    return true;
  }).map((item: any) => ({ ...item, searchScore: searchScore(item, keyword) }));
  if (query.sortBy === 'time') {
    const known = items.filter((item: any) => daysUntilRegistration(item, now) !== null);
    const unknown = items.filter((item: any) => daysUntilRegistration(item, now) === null);
    const sign = query.sortOrder === 'desc' ? -1 : 1;
    known.sort((a: any, b: any) => sign * (daysUntilRegistration(a, now)! - daysUntilRegistration(b, now)!));
    items = [...known, ...unknown];
  } else {
    items.sort(compare);
    if (query.sortOrder === 'asc') items.reverse();
  }
  const page = query.page || 1;
  const pageSize = query.pageSize || 8;
  return { items: items.slice(0, page * pageSize), total: items.length, hasMore: page * pageSize < items.length, preview: true };
}

export async function getCompetition(id: string) {
  if (USE_CLOUD_PUBLIC_DATA) return hydratePublic(await callPublicData<any>('get', { id }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const item = seed.find((record: any) => record.id === id);
  if (!item) throw new Error('赛事不存在');
  return hydrate(item);
}

export function getProfessionOptions(): string[] {
  return Array.from(new Set<string>(seed.flatMap((item: any) => item.professions as string[]))).sort();
}
