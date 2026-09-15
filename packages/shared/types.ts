export const REGISTRATION_STATUSES = ['时间待公布', '即将报名', '报名中', '已截止'] as const;
export const EVENT_LEVELS = ['国家级', '省级/区域级', '其他/未明确'] as const;
export const RECOMMENDATION_LEVELS = ['强烈推荐', '值得参加', '适合练手', '高难挑战', '谨慎报名', '信息不足'] as const;
export const DATA_STATUSES = ['draft', 'pending_system_validation', 'pending_manual_review', 'published', 'reviewing', 'archived', 'offline'] as const;
export const PARTICIPATION_FORMATS = ['个人赛', '团队赛', '个人或团队均可', '暂未明确'] as const;
export const TEAM_SIZE_CATEGORIES = ['1人', '2～3人', '4～5人', '6人及以上', '人数范围不固定', '暂未明确'] as const;
export const FEE_TYPES = ['免费', '收费', '不同赛项费用不同', '暂未公布'] as const;
export const REGISTRATION_ORGANIZATIONS = ['自行报名', '学校统一报名', '两种方式均可', '需先校内选拔', '以赛区或学校通知为准', '暂未明确'] as const;
// 价值维度：用于回答「冷门但高回报的赛事怎么让用户看见」。
// 含金量以权威认可和非现金回报为主，现金奖金刻意不作为主要依据。
export const REWARD_TIERS = ['无现金奖励', '万元以下', '1万-10万', '10万-50万', '50万以上', '暂未公布'] as const;
export const REWARD_HIGHLIGHTS = ['保研考研加分', '实习或直通面试', '就业绿色通道', '创业扶持', '国际交流', '证书荣誉', '实物奖品', '现金奖金'] as const;
export const SCALE_TIERS = ['千人以下', '千人-1万', '1万-10万', '10万以上', '暂未公布'] as const;
export const PARTICIPANT_UNITS = ['队', '人', '暂未公布'] as const;
// 含金量是分路径、分岗位的：考研导师认可的赛事，企业 HR 未必认可；
// 即使同在求职路径上，算法岗认可的，产品岗也未必认可。
export const RECOGNITION_PATHS = ['保研考研', '求职就业', '出国留学', '创业融资'] as const;
export const RECOGNITION_LEVELS = ['高', '中', '低', '暂未明确'] as const;
// 独立于 DataStatus：后者是数据编辑状态，这里是赛事还办不办。
export const LIFECYCLES = ['长期举办', '首届', '不定期', '疑似停办', '已停办', '暂未明确'] as const;

export type RegistrationStatus = typeof REGISTRATION_STATUSES[number];
export type EventLevel = typeof EVENT_LEVELS[number];
export type RecommendationLevel = typeof RECOMMENDATION_LEVELS[number];
export type DataStatus = typeof DATA_STATUSES[number];
export type ParticipationFormat = typeof PARTICIPATION_FORMATS[number];
export type TeamSizeCategory = typeof TEAM_SIZE_CATEGORIES[number];
export type FeeType = typeof FEE_TYPES[number];
export type RegistrationOrganization = typeof REGISTRATION_ORGANIZATIONS[number];
export type RewardTier = typeof REWARD_TIERS[number];
export type RewardHighlight = typeof REWARD_HIGHLIGHTS[number];
export type ScaleTier = typeof SCALE_TIERS[number];
export type ParticipantUnit = typeof PARTICIPANT_UNITS[number];
export type RecognitionPath = typeof RECOGNITION_PATHS[number];
export type RecognitionLevel = typeof RECOGNITION_LEVELS[number];

export interface RecognitionClaim {
  path: RecognitionPath;
  level: RecognitionLevel;
  /** 认可度的出处。没有出处的认可不可复核，会被丢弃。 */
  evidence: string;
  /** 具体岗位或方向。为空表示该路径下通用。 */
  scope: string[];
}
export type Lifecycle = typeof LIFECYCLES[number];

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
  rewardAmount: number | null;
  rewardTier: RewardTier;
  rewardHighlights: RewardHighlight[];
  rewards: string;
  participantCount: number | null;
  participantUnit: ParticipantUnit;
  scaleTier: ScaleTier;
  participantScale: string;
  region: string;
  lifecycle: Lifecycle;
  recognition: RecognitionClaim[];
  valueScores: Record<RecognitionPath, number>;
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
  rewardTier?: RewardTier | '';
  rewardHighlight?: RewardHighlight | '';
  scaleTier?: ScaleTier | '';
  region?: string;
  lifecycle?: Lifecycle | '';
  /** 用户的目标路径与岗位，决定排序看哪一维认可度。 */
  targetPath?: RecognitionPath | '';
  targetScope?: string;
  userProfessions?: string[];
}
