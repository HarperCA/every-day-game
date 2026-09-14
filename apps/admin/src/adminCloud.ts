import type { AuditEntry } from './dataStore';
import type { AiJobRecord, FeedbackRecord } from './operationsStore';

const CLOUD_ENV_ID = ((import.meta as any).env?.VITE_CLOUDBASE_ENV_ID || 'daily-contest-dev-d8dbbhc653e221').trim();
let appPromise: Promise<any> | null = null;
let sessionToken = '';
let writeQueue: Promise<unknown> = Promise.resolve();
type StateKey = 'records' | 'feedbacks' | 'aiJobs';
let stateVersions: Record<StateKey, number> = { records:0, feedbacks:0, aiJobs:0 };
let writeBlockedMessage = '';

function getCloudApp(): Promise<any> {
  if (!appPromise) {
    appPromise = import('@cloudbase/js-sdk').then(({ default: cloudbase }) => cloudbase.init({ env: CLOUD_ENV_ID }));
  }
  return appPromise;
}

export function describeCloudError(error: unknown): string {
  if (error instanceof Error && error.message) {
    if (error.message.includes('state_version_conflict:')) return '云端数据已被其他页面修改，请刷新管理后台后再继续操作';
    return error.message;
  }
  if (error && typeof error === 'object') {
    const value = error as any;
    const message = value.message || value.error?.message || value.errMsg || value.code;
    if (message) return String(message);
    try { return JSON.stringify(value); } catch (_ignored) { /* fall through */ }
  }
  return String(error || 'CloudBase 管理后台连接失败');
}

export interface AdminCloudBootstrap {
  records: any[];
  audits: AuditEntry[];
  feedbacks: FeedbackRecord[];
  aiJobs: AiJobRecord[];
  stateVersions: Record<StateKey, number>;
}

function emit(state: 'syncing' | 'synced' | 'error', message = '') {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('admin-cloud-sync', { detail: { state, message } }));
}

async function callAdmin<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!sessionToken) throw new Error('管理员云端会话尚未建立');
  const app = await getCloudApp();
  const response: any = await app.callFunction({ name: 'adminData', data: { action, sessionToken, ...payload }, parse: true });
  const result = typeof response?.result === 'string' ? JSON.parse(response.result) : response?.result;
  if (!result?.ok) throw new Error(result?.message || '管理云函数返回异常');
  return result.data as T;
}

export async function connectAdminCloud(token: string): Promise<AdminCloudBootstrap> {
  sessionToken = '';
  writeBlockedMessage = '';
  const adminToken = token.trim();
  if (!adminToken) throw new Error('请输入云端管理员口令');
  const app = await getCloudApp();
  const auth = app.auth();
  const state = await auth.getLoginState();
  if (!state) {
    const response: any = await auth.signInAnonymously();
    if (response?.error) throw new Error(response.error.message || 'CloudBase 匿名身份建立失败');
  }
  const loginResponse: any = await app.callFunction({ name:'adminData', data:{ action:'login', adminToken }, parse:true });
  const loginResult = typeof loginResponse?.result === 'string' ? JSON.parse(loginResponse.result) : loginResponse?.result;
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
      console.error('CloudBase admin sync failed', error);
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
      console.error('CloudBase admin state sync failed', error);
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

export function cloudEnvironmentId() {
  return CLOUD_ENV_ID;
}
