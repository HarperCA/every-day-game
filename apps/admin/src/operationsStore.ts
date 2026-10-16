import { queueCloudAiJobs, queueCloudFeedbacks } from './adminCloud';

const FEEDBACK_KEY = 'competition-admin-feedback-v2';
const AI_JOB_KEY = 'competition-admin-ai-jobs-v2';

export type FeedbackStatus = 'pending_ai_review' | 'ai_queued' | 'ai_passed' | 'ai_flagged' | 'human_reviewing' | 'accepted' | 'rejected';
export interface FeedbackRecord {
  id: string;
  editionId: string;
  competitionName: string;
  category: 'time' | 'registration_link' | 'eligibility' | 'rules' | 'other';
  content: string;
  evidenceUrl: string;
  submitterMasked: string;
  status: FeedbackStatus;
  aiDecision?: 'accepted' | 'rejected';
  aiRiskLevel?: 'low' | 'medium' | 'high';
  aiConclusion?: string;
  aiEvidenceSummary?: string;
  aiReviewedAt?: string;
  aiJobId?: string;
  spotCheckStatus?: 'not_checked' | 'correct' | 'incorrect';
  spotCheckedAt?: string;
  createdAt: string;
  reviewer?: string;
  reviewNote?: string;
  resolvedAt?: string;
  source?: 'mock' | 'user_submission';
  cloudDocumentId?: string;
}

export type AiJobStatus = 'failed' | 'queued' | 'manual_required' | 'resolved';
export interface AiJobRecord {
  id: string;
  editionId: string;
  competitionName: string;
  jobType: 'recommendation_generate' | 'source_extract' | 'data_validation' | 'feedback_review';
  status: AiJobStatus;
  provider: string;
  model: string;
  errorCode: string;
  errorMessage: string;
  retryCount: number;
  maxRetries: number;
  lastAttemptAt: string;
  nextRetryAt?: string;
  resolvedAt?: string;
  source?: 'mock' | 'service';
}

export function changedOperationFields<T extends object>(before: T, after: T, fields: (keyof T)[]) {
  return fields.filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field])).map(String);
}

export function validateFeedbackRecord(record: FeedbackRecord) {
  const errors: string[] = [];
  if (!record.competitionName.trim()) errors.push('赛事名称不能为空');
  if (!record.content.trim()) errors.push('纠错内容不能为空');
  if (record.evidenceUrl && !/^https?:\/\//i.test(record.evidenceUrl)) errors.push('证据链接必须以 http:// 或 https:// 开头');
  return errors;
}

export function validateAiJobRecord(record: AiJobRecord) {
  const errors: string[] = [];
  if (!record.competitionName.trim()) errors.push('赛事名称不能为空');
  if (!record.provider.trim()) errors.push('Provider 不能为空');
  if (!record.model.trim()) errors.push('模型不能为空');
  if (!record.errorCode.trim()) errors.push('错误码不能为空');
  if (!record.errorMessage.trim()) errors.push('错误信息不能为空');
  if (!Number.isInteger(record.retryCount) || record.retryCount < 0) errors.push('已重试次数必须是非负整数');
  if (!Number.isInteger(record.maxRetries) || record.maxRetries < 0) errors.push('最大重试次数必须是非负整数');
  if (record.retryCount > record.maxRetries) errors.push('已重试次数不能大于最大重试次数');
  return errors;
}

const feedbackSeed: FeedbackRecord[] = [
  { id:'feedback-mock-001', editionId:'edition-cmp004-2026', competitionName:'全国大学生数学建模竞赛', category:'time', content:'学校通知中的报名截止时间与当前页面展示不一致，请复核赛区口径。', evidenceUrl:'https://www.mcm.edu.cn/', submitterMasked:'用户***1024', status:'pending_ai_review', spotCheckStatus:'not_checked', createdAt:'2026-08-20T09:20:00+08:00', source:'mock' },
  { id:'feedback-mock-002', editionId:'edition-cmp007-2026', competitionName:'国际大学生程序设计竞赛（ICPC）', category:'registration_link', content:'报名入口目前跳转到旧赛季页面。', evidenceUrl:'', submitterMasked:'用户***5831', status:'ai_flagged', aiRiskLevel:'high', aiConclusion:'证据不足，无法确认当前链接是否为旧赛季入口。', aiEvidenceSummary:'用户未提供证据链接，现有来源尚未完成在线可达性复核。', aiReviewedAt:'2026-08-20T10:08:00+08:00', aiJobId:'ai-job-feedback-mock-002', spotCheckStatus:'not_checked', createdAt:'2026-08-20T10:05:00+08:00', source:'mock' },
  { id:'feedback-mock-003', editionId:'edition-cmp030-2026', competitionName:'全国大学生医学创新大赛暨“一带一路”国际竞赛', category:'eligibility', content:'参赛对象可能需要区分本科赛道和国际赛道。', evidenceUrl:'https://www.jcyxds.com/', submitterMasked:'用户***7719', status:'ai_passed', aiDecision:'accepted', aiRiskLevel:'low', aiConclusion:'用户纠错与现有赛道资料一致，建议采纳并进入资料复核。', aiEvidenceSummary:'用户提供赛事官网；结论仍需在正式发布前由规则校验确认。', aiReviewedAt:'2026-08-20T11:36:00+08:00', aiJobId:'ai-job-feedback-mock-003', spotCheckStatus:'not_checked', createdAt:'2026-08-20T11:30:00+08:00', source:'mock' },
];

const aiJobSeed: AiJobRecord[] = [
  { id:'ai-job-mock-001', editionId:'edition-cmp014-2026', competitionName:'中国大学生工程实践与创新能力大赛', jobType:'source_extract', status:'failed', provider:'未配置', model:'未配置', errorCode:'provider_not_configured', errorMessage:'开发环境未配置AI Provider，来源抽取任务未执行。', retryCount:0, maxRetries:3, lastAttemptAt:'2026-08-20T11:45:00+08:00', source:'mock' },
  { id:'ai-job-mock-002', editionId:'edition-cmp002-2025', competitionName:'“挑战杯”全国大学生课外学术科技作品竞赛', jobType:'recommendation_generate', status:'manual_required', provider:'Mock Provider', model:'Mock Model', errorCode:'insufficient_official_evidence', errorMessage:'有效官方来源不足，任务停止自动重试并等待人工补充资料。', retryCount:3, maxRetries:3, lastAttemptAt:'2026-08-20T12:10:00+08:00', source:'mock' },
  { id:'ai-job-feedback-mock-002', editionId:'edition-cmp007-2026', competitionName:'国际大学生程序设计竞赛（ICPC）', jobType:'feedback_review', status:'manual_required', provider:'Mock Provider', model:'Mock Model', errorCode:'feedback_evidence_insufficient', errorMessage:'纠错证据不足，AI预审已转入问题待人工审核。', retryCount:0, maxRetries:2, lastAttemptAt:'2026-08-20T10:08:00+08:00', source:'mock' },
];

function load<T>(key: string, seed: T[]): T[] {
  try {
    const saved = window.localStorage.getItem(key);
    if (saved === null) return seed.map(item=>({...item}));
    const value = JSON.parse(saved);
    return Array.isArray(value) ? value : seed.map(item => ({ ...item }));
  } catch (_error) { return seed.map(item => ({ ...item })); }
}

function persist<T>(key: string, records: T[]) { window.localStorage.setItem(key, JSON.stringify(records)); }

export const loadFeedbacks = () => load(FEEDBACK_KEY, feedbackSeed).map((item: any) => ({
  ...item,
  status: item.status === 'pending' ? 'pending_ai_review' : item.status === 'reviewing' ? 'human_reviewing' : item.status,
  spotCheckStatus: item.spotCheckStatus || 'not_checked',
  source:item.source || (String(item.id).includes('-mock-') ? 'mock' : 'user_submission'),
})) as FeedbackRecord[];
export const persistFeedbacks = (records: FeedbackRecord[]) => {
  const previousById = new Map(loadFeedbacks().map(item => [item.id, item]));
  const submittedUpdates = records.filter(item => item.source === 'user_submission' && JSON.stringify(previousById.get(item.id)) !== JSON.stringify(item));
  persist(FEEDBACK_KEY, records);
  queueCloudFeedbacks(records, submittedUpdates);
};
export const loadAiJobs = () => load(AI_JOB_KEY, aiJobSeed).map((item: any) => ({ ...item, source:item.source || (String(item.id).includes('-mock-') ? 'mock' : 'service') })) as AiJobRecord[];
export const persistAiJobs = (records: AiJobRecord[]) => { persist(AI_JOB_KEY, records); queueCloudAiJobs(records); };
export const replaceFeedbackCache = (records:FeedbackRecord[]) => persist(FEEDBACK_KEY,records);
export const replaceAiJobCache = (records:AiJobRecord[]) => persist(AI_JOB_KEY,records);

export function hydrateOperationStores(feedbacks: FeedbackRecord[], aiJobs: AiJobRecord[]) {
  persist(FEEDBACK_KEY, feedbacks);
  persist(AI_JOB_KEY, aiJobs);
}
