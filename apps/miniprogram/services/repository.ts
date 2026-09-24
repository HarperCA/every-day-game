const seed = require('../data/competitions');
import { USE_CLOUD_PUBLIC_DATA } from '../config/cloud';
import { callPublicData } from './cloudSession';
import { schoolTimingAdvice } from './timing';

const STATUS_WEIGHT: Record<string, number> = { '报名中': 0, '即将报名': 1, '时间待公布': 2, '已截止': 3 };
const RECOMMENDATION_WEIGHT: Record<string, number> = { '强烈推荐': 0, '值得参加': 1, '适合练手': 2, '高难挑战': 3, '谨慎报名': 4, '信息不足': 5 };
const STATUS_CLASS: Record<string, string> = { '报名中': 'status-open', '即将报名': 'status-upcoming', '时间待公布': 'status-pending', '已截止': 'status-closed' };

export interface Query {
  keyword?: string;
  registrationStatus?: string;
  eventLevel?: string;
  profession?: string;
  participationFormat?: string;
  teamSizeCategory?: string;
  feeType?: string;
  registrationOrganization?: string;
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
  return {
    ...item,
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
    preview: true,
  };
}

function hydratePublic(item: any) {
  const registrationStatus = item.registration_status;
  return {
    id:item.id, eventId:item.event_id, name:item.name, editionName:item.edition_name,
    aliases:item.aliases || [], organizer:item.organizer || '', eventLevel:item.event_level,
    objectiveTags:item.objective_tags || [], professions:item.professions || [], displayProfessions:(item.professions || []).slice(0, 2),
    participants:item.participants || '', eligibility:item.eligibility || '', formatAndRules:item.format_and_rules || '', teamSize:item.team_size || '',
    participationFormat:item.participation_format, teamSizeCategory:item.team_size_category, feeType:item.fee_type, registrationOrganization:item.registration_organization,
    registrationMethod:item.registration_method || '', registrationUrl:item.registration_url || '', fees:item.fees || '',
    registrationStatus, statusClass:STATUS_CLASS[registrationStatus] || 'status-closed',
    registrationStart:item.registration_start || '', registrationEnd:item.registration_end || '',
    registrationStartDate:item.registration_start ? item.registration_start.substring(0, 10) : '', registrationEndDate:item.registration_end ? item.registration_end.substring(0, 10) : '',
    competitionStartDate:item.competition_start ? item.competition_start.substring(0, 10) : '', competitionEndDate:item.competition_end ? item.competition_end.substring(0, 10) : '',
    scheduleChangeStatus:'normal', lastVerifiedDate:item.last_verified_at ? item.last_verified_at.substring(0, 10) : '待核验',
    track:{ name:item.track_name || '以当届官方通知为准' }, sources:item.sources || [],
    recommendationLevel:item.recommendation || '信息不足', recommendationReasons:item.recommendation_reasons || [],
    recommendation:{ recommendation:item.recommendation || '信息不足', suitable_for:item.recommendation_suitable_for || '', reasons:item.recommendation_reasons || [], limitations:item.recommendation_limitations || [], preparation:item.recommendation_preparation || '', confidence:item.recommendation_confidence || '' },
    registrationUrlUsable:/^https?:\/\//.test(item.registration_url || ''), qualityIssues:[],
    // 已发布记录由云函数算好，直接读，避免两处逻辑漂移
    schoolTimingDependent:Boolean(item.school_timing_dependent), schoolTimingNote:item.school_timing_note || '',
    timingReliability:item.timing_reliability || 'unverified',
    preview:false,
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

export async function listCompetitions(query: Query) {
  if (USE_CLOUD_PUBLIC_DATA) {
    const result = await callPublicData<{ items:any[]; total:number; hasMore:boolean; preview:false }>('list', { query });
    return { ...result, items:result.items.map(hydratePublic) };
  }
  await new Promise((resolve) => setTimeout(resolve, 180));
  const keyword = (query.keyword || '').trim().toLowerCase();
  const items = seed.map(hydrate).filter((item: any) => {
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
    return true;
  }).map((item: any) => ({ ...item, searchScore: searchScore(item, keyword) })).sort(compare);
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
