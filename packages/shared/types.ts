export const REGISTRATION_STATUSES = ['时间待公布', '即将报名', '报名中', '已截止'] as const;
export const EVENT_LEVELS = ['国家级', '省级/区域级', '其他/未明确'] as const;
export const RECOMMENDATION_LEVELS = ['强烈推荐', '值得参加', '适合练手', '高难挑战', '谨慎报名', '信息不足'] as const;
export const DATA_STATUSES = ['draft', 'pending_system_validation', 'pending_manual_review', 'published', 'reviewing', 'archived', 'offline'] as const;
export const PARTICIPATION_FORMATS = ['个人赛', '团队赛', '个人或团队均可', '暂未明确'] as const;
export const TEAM_SIZE_CATEGORIES = ['1人', '2～3人', '4～5人', '6人及以上', '人数范围不固定', '暂未明确'] as const;
export const FEE_TYPES = ['免费', '收费', '不同赛项费用不同', '暂未公布'] as const;
export const REGISTRATION_ORGANIZATIONS = ['自行报名', '学校统一报名', '两种方式均可', '需先校内选拔', '以赛区或学校通知为准', '暂未明确'] as const;

export type RegistrationStatus = typeof REGISTRATION_STATUSES[number];
export type EventLevel = typeof EVENT_LEVELS[number];
export type RecommendationLevel = typeof RECOMMENDATION_LEVELS[number];
export type DataStatus = typeof DATA_STATUSES[number];
export type ParticipationFormat = typeof PARTICIPATION_FORMATS[number];
export type TeamSizeCategory = typeof TEAM_SIZE_CATEGORIES[number];
export type FeeType = typeof FEE_TYPES[number];
export type RegistrationOrganization = typeof REGISTRATION_ORGANIZATIONS[number];

export interface CompetitionCard {
  id: string;
  eventId: string;
  name: string;
  editionName: string;
  aliases: string[];
  organizer: string;
  registrationStatus: RegistrationStatus;
  registrationStart: string | null;
  registrationEnd: string | null;
  eventLevel: EventLevel;
  professions: string[];
  objectiveTags: string[];
  recommendation: RecommendationLevel;
  reasons: string[];
  evidenceRefs: string[];
  lastVerifiedAt: string;
  dataStatus: DataStatus;
  registrationUrl: string | null;
  registrationUrlValid: boolean;
  participationFormat: ParticipationFormat;
  teamSizeCategory: TeamSizeCategory;
  feeType: FeeType;
  registrationOrganization: RegistrationOrganization;
  qualityIssues: string[];
}

export interface CompetitionQuery {
  keyword?: string;
  registrationStatus?: RegistrationStatus | '';
  eventLevel?: EventLevel | '';
  profession?: string;
  participationFormat?: ParticipationFormat | '';
  teamSizeCategory?: TeamSizeCategory | '';
  feeType?: FeeType | '';
  registrationOrganization?: RegistrationOrganization | '';
}
