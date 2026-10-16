import { API_BASE_URL, BEIJING_BACKEND_ENABLED, CLOUD_ENV_ID, FEEDBACK_API_BASE_URL, USE_SELF_HOSTED_BACKEND, USER_DATA_ON_CLOUD } from '../config/cloud';

// 迁移过渡期直接走自有服务器的操作，其他操作保留上海兼容入口。
const SELF_HOSTED_USER_ACTIONS = new Set(['submitFeedback', 'listFeedback', 'submitGeneralFeedback', 'listGeneralFeedback']);
import { reportIssue, SLOW_THRESHOLD_MS } from './clientLog';

let sessionReady = false;
let cloudInitialized = false;
let currentUserId = '';
// 仅用于核对微信登录身份；接口凭签名会话认证，不凭客户端 OpenID。
let currentOpenid = '';
interface ServerSessionState { token:string; request:Promise<string> | null }
const serverSessions = new Map<string, ServerSessionState>();
let loginGeneration = 0;

function sessionFor(origin:string): ServerSessionState {
  let state = serverSessions.get(origin);
  if (!state) { state = { token:'', request:null }; serverSessions.set(origin, state); }
  return state;
}

async function ensureServerUserSession(origin:string): Promise<string> {
  const state = sessionFor(origin);
  if (state.token) return state.token;
  if (!state.request) {
    const generation = loginGeneration;
    const request = (async () => {
      const code = await new Promise<string>((resolve, reject) => {
        wx.login({ success: (res: any) => res?.code ? resolve(res.code) : reject(new Error('微信登录未返回 code')), fail: (err: any) => reject(new Error(err?.errMsg || '微信登录失败')) });
      });
      const result = await requestSelfHosted<{ openid:string; userSessionToken:string; userSessionOrigin?:string }>('/api/login', { code }, origin);
      if (generation !== loginGeneration) throw new Error('账号已变化，请重新操作');
      if (!result.userSessionToken) throw new Error('反馈服务尚未更新，请稍后重试');
      if (result.userSessionOrigin && result.userSessionOrigin !== origin) throw new Error('用户服务来源不匹配，请稍后重试');
      if (currentOpenid && result.openid !== currentOpenid) throw new Error('微信身份已变化，请重新登录');
      state.token = result.userSessionToken;
      return state.token;
    })();
    state.request = request;
    request.then(() => { if (state.request === request) state.request = null; }, () => { if (state.request === request) state.request = null; });
  }
  return state.request;
}

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
function requestSelfHosted<T>(path: string, data: Record<string, unknown>, origin = API_BASE_URL, timeout = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${origin}${path}`,
      method: 'POST',
      timeout,
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
  const generation = ++loginGeneration;
  sessionReady = false;
  currentUserId = '';
  currentOpenid = '';
  serverSessions.clear();

  if (USER_DATA_ON_CLOUD) {
    // 腾讯云开发上海：身份由微信云开发直接给出（云函数里 cloud.getWXContext()），不用自己换
    const started = Date.now();
    try {
      ensureCloudInitialized();
      const response = await wx.cloud.callFunction({ name: 'login' });
      const data = resultData<LoginResult & { openid?:string; userSessionToken?:string; userSessionOrigin?:string }>(response);
      if (generation !== loginGeneration) throw new Error('登录请求已过期，请重新操作');
      if (!data.userId) throw new Error('登录云函数未返回用户标识');
      currentOpenid = data.openid || '';
      currentUserId = data.userId;
      // Cloud bridge tokens are origin-bound. Never guess their destination.
      if (data.userSessionToken && data.userSessionOrigin === API_BASE_URL) sessionFor(API_BASE_URL).token = data.userSessionToken;
      sessionReady = true;
      return { userId: data.userId, isNewUser: data.isNewUser };
    } catch (error) {
      reportIssue('user_data_failed', { action: 'login', message: error instanceof Error ? error.message : String((error as any)?.errMsg || error), elapsedMs: Date.now() - started });
      throw error;
    }
  }

  if (USE_SELF_HOSTED_BACKEND) {
    // 自有后端没有微信和腾讯云之间那条内建信任通道，身份要自己换：
    // wx.login() 拿一次性 code，服务器用 AppSecret 去换 openid。
    const code = await new Promise<string>((resolve, reject) => {
      wx.login({
        success: (res: any) => (res?.code ? resolve(res.code) : reject(new Error('微信登录未返回 code'))),
        fail: (error: any) => reject(new Error(error?.errMsg || '微信登录失败')),
      });
    });
    const data = await requestSelfHosted<LoginResult & { openid?: string; userSessionToken?: string }>('/api/login', { code });
    if (generation !== loginGeneration) throw new Error('登录请求已过期，请重新操作');
    if (!data.userId) throw new Error('登录接口未返回用户标识');
    if (!data.userSessionToken) throw new Error('用户服务尚未更新，请稍后重试');
    currentOpenid = data.openid || '';
    currentUserId = data.userId;
    sessionFor(API_BASE_URL).token = data.userSessionToken;
    sessionReady = true;
    return { userId: data.userId, isNewUser: data.isNewUser };
  }

  ensureCloudInitialized();
  const response = await wx.cloud.callFunction({ name: 'login' });
  const data = resultData<LoginResult>(response);
  if (generation !== loginGeneration) throw new Error('登录请求已过期，请重新操作');
  if (!data.userId) throw new Error('登录云函数未返回用户标识');
  currentUserId = data.userId;
  sessionReady = true;
  return data;
}

export function isCloudSessionReady(): boolean {
  return sessionReady;
}

export function getCurrentUserId(): string {
  return sessionReady ? currentUserId : '';
}

export async function callUserData<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!sessionReady) throw new Error('微信登录尚未完成');
  if (USE_SELF_HOSTED_BACKEND && (!USER_DATA_ON_CLOUD || SELF_HOSTED_USER_ACTIONS.has(action))) {
    const generation = loginGeneration;
    const origin = SELF_HOSTED_USER_ACTIONS.has(action) ? FEEDBACK_API_BASE_URL : API_BASE_URL;
    const send = async () => {
      const userSessionToken = await ensureServerUserSession(origin);
      if (generation !== loginGeneration) throw new Error('账号已变化，请重新操作');
      const result = await requestSelfHosted<T>('/api/userData', { ...payload, action, userSessionToken }, origin);
      if (generation !== loginGeneration) throw new Error('账号已变化，请重新操作');
      return result;
    };
    try { return await send(); }
    catch (error) {
      if (generation !== loginGeneration) throw new Error('账号已变化，请重新操作');
      if (!(error instanceof Error) || error.message !== 'user_session_expired') throw error;
      sessionFor(origin).token = '';
      return send();
    }
  }
  if (USER_DATA_ON_CLOUD && !SELF_HOSTED_USER_ACTIONS.has(action)) {
    const generation = loginGeneration;
    const started = Date.now();
    try {
      ensureCloudInitialized();
      const response = await wx.cloud.callFunction({ name: 'userData', data: { ...payload, action } });
      const data = resultData<T>(response);
      if (generation !== loginGeneration) throw new Error('账号已变化，请重新操作');
      const elapsed = Date.now() - started;
      if (elapsed > SLOW_THRESHOLD_MS) reportIssue('slow', { action: `userData.${action}`, elapsedMs: elapsed });
      return data;
    } catch (error) {
      reportIssue('user_data_failed', { action: `userData.${action}`, message: error instanceof Error ? error.message : String((error as any)?.errMsg || error), elapsedMs: Date.now() - started });
      throw error;
    }
  }
  const generation = loginGeneration;
  const response = await wx.cloud.callFunction({ name: 'userData', data: { ...payload, action } });
  if (generation !== loginGeneration) throw new Error('账号已变化，请重新操作');
  return resultData<T>(response);
}

// 赛事助手（体验版）：只在自有服务器上，需要登录会话。服务器一轮最多 20 秒（模型最多调 3 次），客户端等 25 秒。
// 会话过期时和 callUserData 一样：清掉旧会话，重新登录后再试一次。
const ASSISTANT_TIMEOUT_MS = 25000;
export async function callAssistant<T>(payload: Record<string, unknown>): Promise<T> {
  if (!sessionReady) throw new Error('微信登录尚未完成');
  const generation = loginGeneration;
  const origin = FEEDBACK_API_BASE_URL;
  const send = async () => {
    const userSessionToken = await ensureServerUserSession(origin);
    if (generation !== loginGeneration) throw new Error('账号已变化，请重新操作');
    const result = await requestSelfHosted<T>('/api/assistant', { ...payload, action:'ask', userSessionToken }, origin, ASSISTANT_TIMEOUT_MS);
    if (generation !== loginGeneration) throw new Error('账号已变化，请重新操作');
    return result;
  };
  try { return await send(); }
  catch (error) {
    if (generation !== loginGeneration) throw new Error('账号已变化，请重新操作');
    if (!(error instanceof Error) || error.message !== 'user_session_expired') throw error;
    sessionFor(origin).token = '';
    return send();
  }
}

// 浏览赛事、搜索、看详情（公开数据，不需要身份）。
// 2026-10-01 起先读腾讯云开发上海环境里的 publicData：服务器在美国，国内手机跨境访问又慢又时常连不上，
// 服务器每 5 分钟把公开数据同步一份到上海（scripts/server/sync-public-cache.mjs），这条走微信内网。
// 上海那边出错（比如某条刚发布、还没同步过去），再退回美国服务器读，两条路互为备份。
// 出问题时匿名记一笔（clientLog.ts）：上海失败退回美国、两边都失败、加载超过 3 秒。
export async function callPublicData<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const started = Date.now();
  const describe = (error: unknown) => (error instanceof Error ? error.message : String((error as any)?.errMsg || error));
  if (BEIJING_BACKEND_ENABLED) {
    try {
      const result = await requestSelfHosted<T>('/api/publicData', { ...payload, action });
      const elapsed = Date.now() - started;
      if (elapsed > SLOW_THRESHOLD_MS) reportIssue('slow', { action:`publicData.${action}`, elapsedMs:elapsed });
      return result;
    } catch (error) {
      reportIssue('load_failed', { action:`publicData.${action}`, message:describe(error), elapsedMs:Date.now() - started });
      throw error;
    }
  }
  let result: T;
  try {
    ensureCloudInitialized();
    const response = await wx.cloud.callFunction({ name: 'publicData', data: { ...payload, action } });
    result = resultData<T>(response);
  } catch (cloudError) {
    if (!USE_SELF_HOSTED_BACKEND) throw cloudError;
    try {
      result = await requestSelfHosted<T>('/api/publicData', { action, ...payload });
      reportIssue('cloud_fallback', { action: `publicData.${action}`, message: describe(cloudError), elapsedMs: Date.now() - started });
    } catch (selfHostedError) {
      reportIssue('load_failed', { action: `publicData.${action}`, message: describe(selfHostedError), extra: `上海：${describe(cloudError)}`.slice(0, 200), elapsedMs: Date.now() - started });
      throw selfHostedError;
    }
  }
  const elapsed = Date.now() - started;
  if (elapsed > SLOW_THRESHOLD_MS) reportIssue('slow', { action: `publicData.${action}`, elapsedMs: elapsed });
  return result;
}
