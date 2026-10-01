import { API_BASE_URL, CLOUD_ENV_ID, USE_SELF_HOSTED_BACKEND } from '../config/cloud';

let sessionReady = false;
let cloudInitialized = false;
// 自有后端用 openid 认身份；登录后存下来，后续请求带上。
let currentOpenid = '';

export interface LoginResult {
  userId: string;
  isNewUser: boolean;
}

function resultData<T>(response: any): T {
  const result = response?.result;
  if (!result || result.ok !== true) throw new Error(result?.message || '云服务返回异常');
  return result.data as T;
}

// —— 自有后端：普通 HTTPS 请求 ——
//
// 后端已迁到自有服务器（见 docs/migration-to-self-hosted.md）。
// wx.request 的目标域名必须先在微信公众平台登记「服务器域名」，
// 且必须是 HTTPS——这是微信平台的硬性要求，和后端放在哪无关。
function requestSelfHosted<T>(path: string, data: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}${path}`,
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data,
      success(response: any) {
        const body = response?.data;
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(body?.message || `服务返回 ${response.statusCode}`));
          return;
        }
        if (!body || body.ok !== true) {
          reject(new Error(body?.message || '服务返回异常'));
          return;
        }
        resolve(body.data as T);
      },
      fail(error: any) {
        // 跨境网络偶尔连不上（errMsg 形如 request:fail -118:net::ERR_CONNECTION_TIMED_OUT），给用户看不懂的代码没有用
        const raw = String(error?.errMsg || '');
        reject(new Error(/timeout|timed_out|fail/i.test(raw) ? '网络不太稳定，请稍后重试' : raw || '网络请求失败'));
      },
    });
  });
}

// —— CloudBase：迁移完成前保留，随时可切回 ——

function ensureCloudInitialized() {
  if (cloudInitialized) return;
  if (!wx.cloud?.init || !wx.cloud?.callFunction) throw new Error('当前微信基础库不支持云开发');
  const options: Record<string, unknown> = { traceUser: true };
  if (CLOUD_ENV_ID) options.env = CLOUD_ENV_ID;
  wx.cloud.init(options);
  cloudInitialized = true;
}

export async function loginWithWechat(): Promise<LoginResult> {
  sessionReady = false;

  if (USE_SELF_HOSTED_BACKEND) {
    // 自有后端没有微信和腾讯云之间那条内建信任通道，身份要自己换：
    // wx.login() 拿一次性 code，服务器用 AppSecret 去换 openid。
    const code = await new Promise<string>((resolve, reject) => {
      wx.login({
        success: (res: any) => (res?.code ? resolve(res.code) : reject(new Error('微信登录未返回 code'))),
        fail: (error: any) => reject(new Error(error?.errMsg || '微信登录失败')),
      });
    });
    const data = await requestSelfHosted<LoginResult & { openid?: string }>('/api/login', { code });
    if (!data.userId) throw new Error('登录接口未返回用户标识');
    currentOpenid = data.openid || currentOpenid;
    sessionReady = true;
    return { userId: data.userId, isNewUser: data.isNewUser };
  }

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
  if (USE_SELF_HOSTED_BACKEND) {
    return requestSelfHosted<T>('/api/userData', { action, __openid: currentOpenid, ...payload });
  }
  const response = await wx.cloud.callFunction({ name: 'userData', data: { action, ...payload } });
  return resultData<T>(response);
}

// 浏览赛事、搜索、看详情（公开数据，不需要身份）。
// 2026-10-01 起先读腾讯云开发上海环境里的 publicData：服务器在美国，国内手机跨境访问又慢又时常连不上，
// 服务器每 5 分钟把公开数据同步一份到上海（scripts/server/sync-public-cache.mjs），这条走微信内网。
// 上海那边出错（比如某条刚发布、还没同步过去），再退回美国服务器读，两条路互为备份。
export async function callPublicData<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  try {
    ensureCloudInitialized();
    const response = await wx.cloud.callFunction({ name: 'publicData', data: { action, ...payload } });
    return resultData<T>(response);
  } catch (cloudError) {
    if (!USE_SELF_HOSTED_BACKEND) throw cloudError;
    return requestSelfHosted<T>('/api/publicData', { action, ...payload });
  }
}
