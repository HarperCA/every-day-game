import type { AuditEntry } from './dataStore';
import type { AiJobRecord, FeedbackRecord } from './operationsStore';

// 后端已迁到自有服务器（见 docs/migration-to-self-hosted.md）。
// 默认走同源相对路径 /api——nginx 把它转给本机的 Node 服务，
// 浏览器眼里只有一个域名，没有跨域，也不再受 CloudBase「安全来源」白名单管。
const API_BASE = ((import.meta as any).env?.VITE_API_BASE || '').trim().replace(/\/+$/, '');
let sessionToken = '';
let writeQueue: Promise<unknown> = Promise.resolve();
type StateKey = 'records' | 'feedbacks' | 'aiJobs';
let stateVersions: Record<StateKey, number> = { records:0, feedbacks:0, aiJobs:0 };
let writeBlockedMessage = '';

async function postJson(path: string, body: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // 非 2xx 时后端也可能带 JSON 说明原因，能读就读，读不到再退回状态码。
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.message || `后端返回 ${response.status}`);
  }
  return response.json();
}

export function describeCloudError(error: unknown): string {
  if (error instanceof Error && error.message) {
    if (error.message.includes('state_version_conflict:')) return '数据已被其他页面修改，请刷新管理后台后再继续操作';
    return error.message;
  }
  if (error && typeof error === 'object') {
    const value = error as any;
    const message = value.message || value.error?.message || value.errMsg || value.code;
    if (message) return String(message);
    try { return JSON.stringify(value); } catch (_ignored) { /* fall through */ }
  }
  return String(error || '管理后台连接失败');
}

export interface AiReviewRun {
  trigger: string;
  status: 'idle' | 'partial' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string;
  selected: number;
  succeeded: number;
  failed: number;
  remaining: number;
  failures: Array<{ recordId:string; recordName:string; error:string }>;
  error?: string;
}

export interface AdminCloudBootstrap {
  records: any[];
  audits: AuditEntry[];
  feedbacks: FeedbackRecord[];
  aiJobs: AiJobRecord[];
  lastAiReviewRun: AiReviewRun | null;
  stateVersions: Record<StateKey, number>;
}

export function describeAiReviewRun(run: AiReviewRun | null): string {
  if (!run) return '自动检测：尚无运行记录';
  const at = run.completedAt ? new Date(run.completedAt).toLocaleString('zh-CN') : '';
  if (run.status === 'failed') return `⚠️ 自动检测失败（${at}）：${run.error || run.failures[0]?.error || '原因未记录'}`;
  if (run.status === 'idle') return `自动检测正常（${at}）：暂无到期赛事`;
  const tail = run.remaining > 0 ? `，还剩 ${run.remaining} 条待检测` : '，已全部检测完毕';
  const failed = run.failed > 0 ? `，失败 ${run.failed} 条` : '';
  return `自动检测（${at}）：成功 ${run.succeeded} 条${failed}${tail}`;
}

function emit(state: 'syncing' | 'synced' | 'error', message = '') {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('admin-cloud-sync', { detail: { state, message } }));
}

async function callAdmin<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!sessionToken) throw new Error('管理员会话尚未建立');
  const result = await postJson('/api/adminData', { action, sessionToken, ...payload });
  if (!result?.ok) throw new Error(result?.message || '后端返回异常');
  return result.data as T;
}

export async function connectAdminCloud(token: string): Promise<AdminCloudBootstrap> {
  sessionToken = '';
  writeBlockedMessage = '';
  const adminToken = token.trim();
  if (!adminToken) throw new Error('请输入管理员口令');
  // 不再需要匿名身份：自有服务器不管「请求从哪个网页来的」，
  // 鉴权就是这一把 ADMIN_TOKEN 本身。
  const loginResult = await postJson('/api/adminData', { action: 'login', adminToken });
  if (!loginResult?.ok || !loginResult.data?.sessionToken) throw new Error(loginResult?.message || '管理员会话建立失败');
  sessionToken = loginResult.data.sessionToken;
  const bootstrap = await callAdmin<AdminCloudBootstrap>('bootstrap');
  stateVersions = {
    records:Number.isInteger(bootstrap.stateVersions?.records) ? bootstrap.stateVersions.records : 0,
    feedbacks:Number.isInteger(bootstrap.stateVersions?.feedbacks) ? bootstrap.stateVersions.feedbacks : 0,
    aiJobs:Number.isInteger(bootstrap.stateVersions?.aiJobs) ? bootstrap.stateVersions.aiJobs : 0,
  };
  return bootstrap;
}

export function disconnectAdminCloud() {
  sessionToken = '';
  stateVersions = { records:0, feedbacks:0, aiJobs:0 };
  writeBlockedMessage = '';
}

function requireWritablePage() {
  if (writeBlockedMessage) throw new Error(writeBlockedMessage);
}

function enqueue(action: string, payload: Record<string, unknown>) {
  if (!sessionToken) return;
  emit('syncing');
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => {
      requireWritablePage();
      return callAdmin(action, payload);
    })
    .then(() => emit('synced'))
    .catch(error => {
      console.error('后台同步失败', error);
      emit('error', describeCloudError(error));
    });
}

function enqueueState(
  action: string,
  key: StateKey,
  payload: Record<string, unknown>,
  followUps: Array<{ action:string; payload:Record<string, unknown> }> = [],
) {
  if (!sessionToken) return;
  emit('syncing');
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      requireWritablePage();
      const result = await callAdmin<{ version:number }>(action, { ...payload, expectedVersion:stateVersions[key] });
      stateVersions[key] = result.version;
      for (const followUp of followUps) await callAdmin(followUp.action, followUp.payload);
    })
    .then(() => emit('synced'))
    .catch(error => {
      console.error('后台状态同步失败', error);
      if (error instanceof Error && error.message.includes('state_version_conflict:')) writeBlockedMessage = error.message;
      emit('error', describeCloudError(error));
    });
}

export async function initializeCloudRecords(records: any[]) {
  const result = await callAdmin<{ version:number }>('saveRecords', { records, expectedVersion:stateVersions.records });
  stateVersions.records = result.version;
}

export const queueCloudRecords = (records: any[], auditEntry?: AuditEntry) => enqueueState('saveRecords', 'records', { records, ...(auditEntry ? { auditEntry } : {}) });
export const queueCloudAudit = (entry: AuditEntry) => enqueue('appendAudit', { entry });
export function queueCloudFeedbacks(records: FeedbackRecord[], submittedUpdates: FeedbackRecord[] = []) {
  const chunks: FeedbackRecord[][] = [];
  for (let index = 0; index < submittedUpdates.length; index += 20) chunks.push(submittedUpdates.slice(index, index + 20));
  enqueueState(
    'saveFeedbacks',
    'feedbacks',
    { records, submittedUpdates:chunks.shift() || [] },
    chunks.map(chunk => ({ action:'syncFeedbacks', payload:{ submittedUpdates:chunk } })),
  );
}
export const queueCloudAiJobs = (records: AiJobRecord[]) => enqueueState('saveAiJobs', 'aiJobs', { records });

export interface CompetitionAiReviewResult {
  decision: 'recommend_approve' | 'needs_changes' | 'insufficient_evidence';
  risk_level: 'low' | 'medium' | 'high';
  summary: string;
  issues: Array<{ field:string; finding:string; recommendation:string; evidence_ref:string }>;
  evidence_refs: string[];
  provider: string;
  model: string;
  prompt_version: string;
  reviewed_at: string;
  response_id: string | null;
}

export const requestCompetitionAiReview = (recordId: string) => callAdmin<CompetitionAiReviewResult>('runCompetitionAiReview', { recordId });

export interface AiReviewConfigStatus {
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKeyLength: number;
  apiKeyHasSurroundingWhitespace: boolean;
  apiKeyLooksQuoted: boolean;
  usingDefaultModel: boolean;
  usingDefaultBaseUrl: boolean;
  configuredEnvKeys: string[];
  nodeVersion: string;
  fetchAvailable: boolean;
  httpClient: 'global-fetch' | 'node-https-fallback';
  abortTimeoutAvailable: boolean;
}

export const requestAiReviewConfig = () => callAdmin<AiReviewConfigStatus>('aiReviewConfig');

export function describeAiReviewConfig(status: AiReviewConfigStatus): string {
  const problems: string[] = [];
  if (!status.apiKeyConfigured) problems.push('AI_API_KEY 未配置：请在云开发控制台的 adminData 云函数环境变量中添加，保存后重新部署');
  if (status.apiKeyHasSurroundingWhitespace) problems.push('AI_API_KEY 首尾有空格或换行');
  if (status.apiKeyLooksQuoted) problems.push('AI_API_KEY 被引号包住了，请只填密钥本身');
  const client = status.httpClient === 'global-fetch' ? '全局 fetch' : '内置 https 兜底（运行时无 fetch，不影响使用）';
  const summary = `运行时 ${status.nodeVersion}；网络客户端 ${client}；模型 ${status.model}${status.usingDefaultModel ? '（默认值）' : ''}；地址 ${status.baseUrl}${status.usingDefaultBaseUrl ? '（默认值）' : ''}；已配置变量：${status.configuredEnvKeys.join('、') || '无'}`;
  return problems.length ? `AI 配置有问题 → ${problems.join('；')}。${summary}` : `AI 配置正常（密钥长度 ${status.apiKeyLength}）。${summary}`;
}

export function cloudEnvironmentId() {
  return API_BASE || '本机 /api';
}
