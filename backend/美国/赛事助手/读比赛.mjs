// 读比赛：替换旧的 publicRecords.js（原来读上海云开发的公开缓存集合 event_edition_public_cache）。
// 改用美国比赛库的工具读：已发布、已归档的届次，连同所属比赛（已删除的比赛库默认读不到），整理成旧公开缓存的字段名，
// 这样旧的 publicQuery.js、competitionRanking.js、tools.js 一行不用改。价值分等派生字段照旧用 competitionValue.js 的 valueFields 当场算
// （旧系统发布时算好存进缓存，新比赛库不存）。
//
//   读公开比赛(比赛库) → [旧公开缓存记录]
import { createRequire } from 'node:module';
import { 比赛 } from '../db/index.mjs';

const require = createRequire(import.meta.url);
const { valueFields } = require('./competitionValue.js');

const 公开状态 = { 已发布: 'published', 已归档: 'archived' };

function 一条(c, e) {
  const event_level = e.level ?? c.level ?? null;
  const organizer = e.organizer ?? c.organizer ?? '';
  // valueFields 认旧后台记录的驼峰字段名
  const 派生 = valueFields({
    name: c.name, editionName: e.edition_name, eventLevel: event_level, region: c.region, lifecycle: c.lifecycle, recognition: c.recognition,
    registrationOrganization: e.registration_organization, rewardAmount: e.reward_amount, rewardTier: e.reward_tier, rewardHighlights: e.reward_highlights,
    rewards: e.rewards, participantCount: e.participant_count, participantUnit: e.participant_unit, scaleTier: e.scale_tier, participantScale: e.participant_scale,
  });
  return {
    id: e.id, event_id: c.id, name: c.name, edition_name: e.edition_name || '',
    data_status: 公开状态[e.status], system_validation: 'passed', manual_review: 'passed',
    event_level, professions: c.professions || [], participation_format: e.participation_format, team_size_category: e.team_size_category,
    fee_type: e.fee_type, registration_organization: e.registration_organization,
    registration_start: e.registration_start ?? null, registration_end: e.registration_end ?? null, registration_end_note: e.time_note || '',
    registration_status_override: e.status_override || '', competition_start: e.competition_start ?? null, competition_end: e.competition_end ?? null,
    registration_url: e.registration_url || '', organizer, objective_tags: c.objective_tags || [], recommendation: e.recommendation ?? null,
    search_text: [c.name, e.edition_name, organizer, ...(c.aliases || []), ...(c.objective_tags || [])].filter(Boolean).join(' '),
    ...派生,
  };
}

export function 读公开比赛(比赛库) {
  return 比赛.全部连届次(比赛库).flatMap(c => c.届次们.filter(e => 公开状态[e.status]).map(e => 一条(c, e)));
}
