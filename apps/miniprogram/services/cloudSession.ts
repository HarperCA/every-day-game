import { CLOUD_ENV_ID } from '../config/cloud';

let sessionReady = false;
let cloudInitialized = false;

export interface LoginResult {
  userId: string;
  isNewUser: boolean;
}

function resultData<T>(response: any): T {
  const result = response?.result;
  if (!result || result.ok !== true) throw new Error(result?.message || '云服务返回异常');
  return result.data as T;
}

function ensureCloudInitialized() {
  if (cloudInitialized) return;
  if (!wx.cloud?.init || !wx.cloud?.callFunction) throw new Error('当前微信基础库不支持云开发');
  const options: Record<string, unknown> = { traceUser:true };
  if (CLOUD_ENV_ID) options.env = CLOUD_ENV_ID;
  wx.cloud.init(options);
  cloudInitialized = true;
}

export async function loginWithWechat(): Promise<LoginResult> {
  sessionReady = false;
  ensureCloudInitialized();
  const response = await wx.cloud.callFunction({ name: 'login' });
  const data = resultData<LoginResult>(response);
  if (!data.userId) throw new Error('登录云函数未返回用户标识');
  sessionReady = true;
  return data;
}

export function isCloudSessionReady(): boolean {
  return sessionReady;
}

export async function callUserData<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!sessionReady) throw new Error('微信登录尚未完成');
  const response = await wx.cloud.callFunction({ name: 'userData', data: { action, ...payload } });
  return resultData<T>(response);
}

export async function callPublicData<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  ensureCloudInitialized();
  const response = await wx.cloud.callFunction({ name:'publicData', data:{ action, ...payload } });
  return resultData<T>(response);
}
