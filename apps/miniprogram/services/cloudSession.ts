import { API_BASE_URL, ASSISTANT_API_BASE_URL, ASSISTANT_API_PATH } from '../config/cloud';
import { reportIssue, SLOW_THRESHOLD_MS } from './clientLog';

// 登录、用户数据、公开数据都发到北京（config/cloud.ts 的 API_BASE_URL）；赛事助手用北京发的令牌直连美国。
let sessionReady = false;
let currentUserId = '';
// 仅用于核对微信登录身份；接口凭签名会话认证，不凭客户端 OpenID。
let currentOpenid = '';
let sessionToken = '';
let tokenRequest: Promise<string> | null = null;
let loginGeneration = 0;

const describeError = (error: unknown) => (error instanceof Error ? error.message : String((error as any)?.errMsg || error));

function wechatLoginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res: any) => (res?.code ? resolve(res.code) : reject(new Error('微信登录未返回 code'))),
      fail: (error: any) => reject(new Error(error?.errMsg || '微信登录失败')),
    });
  });
}

// 令牌过期后重新换一个；几个请求同时过期时共用同一次登录。
async function ensureUserSession(): Promise<string> {
  if (sessionToken) return sessionToken;
  if (!tokenRequest) {
    const generation = loginGeneration;
    const request = (async () => {
      const code = await wechatLoginCode();
      const result = await requestServer<{ openid:string; userSessionToken:string; userSessionOrigin?:string }>('/api/login', { code });
      if (generation !== loginGeneration) throw new Error('账号已变化，请重新操作');
      if (!result.userSessionToken) throw new Error('用户服务尚未更新，请稍后重试');
      if (result.userSessionOrigin && result.userSessionOrigin !== API_BASE_URL) throw new Error('用户服务来源不匹配，请稍后重试');
      if (currentOpenid && result.openid !== currentOpenid) throw new Error('微信身份已变化，请重新登录');
      sessionToken = result.userSessionToken;
      return sessionToken;
    })();
    tokenRequest = request;
    const clear = () => { if (tokenRequest === request) tokenRequest = null; };
    request.then(clear, clear);
  }
  return tokenRequest;
}

export interface LoginResult {
  userId: string;
  isNewUser: boolean;
}

// wx.request 的目标域名必须先在微信公众平台登记「服务器域名」，且必须是 HTTPS。
function requestServer<T>(path: string, data: Record<string, unknown>, origin = API_BASE_URL, timeout = 15000): Promise<T> {
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
        // 网络偶尔连不上（errMsg 形如 request:fail -118:net::ERR_CONNECTION_TIMED_OUT），给用户看不懂的代码没有用
        const raw = String(error?.errMsg || '');
        reject(new Error(/timeout|timed_out|fail/i.test(raw) ? '网络不太稳定，请稍后重试' : raw || '网络请求失败'));
      },
    });
  });
}

export async function loginWithWechat(): Promise<LoginResult> {
  const generation = ++loginGeneration;
  sessionReady = false;
  currentUserId = '';
  currentOpenid = '';
  sessionToken = '';
  tokenRequest = null;

  // 身份要自己换：wx.login() 拿一次性 code，服务器用 AppSecret 去换 openid。
  const code = await wechatLoginCode();
  const data = await requestServer<LoginResult & { openid?: string; userSessionToken?: string }>('/api/login', { code });
  if (generation !== loginGeneration) throw new Error('登录请求已过期，请重新操作');
  if (!data.userId) throw new Error('登录接口未返回用户标识');
  if (!data.userSessionToken) throw new Error('用户服务尚未更新，请稍后重试');
  currentOpenid = data.openid || '';
  currentUserId = data.userId;
  sessionToken = data.userSessionToken;
  sessionReady = true;
  return { userId: data.userId, isNewUser: data.isNewUser };
}

export function isCloudSessionReady(): boolean {
  return sessionReady;
}

export function getCurrentUserId(): string {
  return sessionReady ? currentUserId : '';
}

// 带令牌发请求。换了账号就作废这次结果；令牌过期就重新换一个，再发一次。
async function sendWithSession<T>(send: (userSessionToken: string) => Promise<T>): Promise<T> {
  if (!sessionReady) throw new Error('微信登录尚未完成');
  const generation = loginGeneration;
  const attempt = async () => {
    const userSessionToken = await ensureUserSession();
    if (generation !== loginGeneration) throw new Error('账号已变化，请重新操作');
    const result = await send(userSessionToken);
    if (generation !== loginGeneration) throw new Error('账号已变化，请重新操作');
    return result;
  };
  try { return await attempt(); }
  catch (error) {
    if (generation !== loginGeneration) throw new Error('账号已变化，请重新操作');
    if (!(error instanceof Error) || error.message !== 'user_session_expired') throw error;
    sessionToken = '';
    return attempt();
  }
}

// 要令牌的接口（/api/userData、/api/team）共用：带令牌发、过期重登录、慢了或失败了记一笔。
// 后端正常的业务拒绝（比如组队的 duplicate_application）不算出错，不记（shouldReport 交回 false）。
async function callWithSession<T>(path: string, label: string, action: string, payload: Record<string, unknown>, shouldReport: (message: string) => boolean = () => true): Promise<T> {
  const started = Date.now();
  try {
    const result = await sendWithSession(userSessionToken => requestServer<T>(path, { ...payload, action, userSessionToken }));
    const elapsed = Date.now() - started;
    if (elapsed > SLOW_THRESHOLD_MS) reportIssue('slow', { action: `${label}.${action}`, elapsedMs: elapsed });
    return result;
  } catch (error) {
    const message = describeError(error);
    if (shouldReport(message)) reportIssue('user_data_failed', { action: `${label}.${action}`, message, elapsedMs: Date.now() - started });
    throw error;
  }
}

export async function callUserData<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return callWithSession<T>('/api/userData', 'userData', action, payload);
}

// 组队（2026-11-12）：POST /api/team，令牌同 /api/userData。服务出错（team_failed、internal_error）和网络问题才记。
const TEAM_BUSINESS_ERROR = /^(?!team_failed$|internal_error$)[a-z][a-z_]*$/;
export async function callTeam<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return callWithSession<T>('/api/team', 'team', action, payload, message => !TEAM_BUSINESS_ERROR.test(message));
}

export async function callSchool<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return callWithSession<T>('/api/school', 'school', action, payload, message => !TEAM_BUSINESS_ERROR.test(message) || message === 'school_failed');
}

// 需要账号的操作前调：没登录就走 app.ts 的静默登录（同收藏、提醒），失败了提示由它给。同时几个请求只登录一次。
let loginWaiting: Promise<boolean> | null = null;
export async function ensureLoggedIn(): Promise<void> {
  if (sessionReady) return;
  if (!loginWaiting) {
    const waiting = (async () => {
      try { return Boolean(await getApp<any>()?.requestWechatLogin?.()); } catch (_error) { return false; }
    })();
    loginWaiting = waiting;
    waiting.then(() => { if (loginWaiting === waiting) loginWaiting = null; });
  }
  const ok = await loginWaiting;
  if (!ok || !sessionReady) throw new Error('登录失败，请检查网络后重试');
}

// 带令牌传文件（2026-11-12，头像用）：wx.uploadFile 不能把令牌放正文，放请求头 Authorization: Bearer。
// 回复格式同 wx.request（{ ok, data } 或 { ok: false, message }），只是 data 是字符串要自己解析。令牌过期同样重登录再传一次。
function uploadServer<T>(path: string, filePath: string, userSessionToken: string, timeout = 20000): Promise<T> {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE_URL}${path}`,
      filePath,
      name: 'file',
      timeout,
      header: { Authorization: `Bearer ${userSessionToken}` },
      success(response: any) {
        let body: any = response?.data;
        if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_error) { body = null; } }
        if (response.statusCode < 200 || response.statusCode >= 300) { reject(new Error(body?.message || `服务返回 ${response.statusCode}`)); return; }
        if (!body || body.ok !== true) { reject(new Error(body?.message || '服务返回异常')); return; }
        resolve(body.data as T);
      },
      fail(error: any) {
        const raw = String(error?.errMsg || '');
        reject(new Error(/timeout|timed_out/i.test(raw) ? '网络不太稳定，请稍后重试' : raw || '上传失败'));
      },
    });
  });
}

export async function uploadWithSession<T>(path: string, filePath: string): Promise<T> {
  return sendWithSession(userSessionToken => uploadServer<T>(path, filePath, userSessionToken));
}

// 赛事助手：直连美国（2026-11-01 用户定，不经北京转发），带北京发的令牌，美国用同一把密钥验。
// 服务器一轮最多 20 秒（模型最多调 3 次），客户端等 25 秒。
const ASSISTANT_TIMEOUT_MS = 25000;
export async function callAssistant<T>(payload: Record<string, unknown>): Promise<T> {
  return sendWithSession(userSessionToken => requestServer<T>(ASSISTANT_API_PATH, { ...payload, action:'ask', userSessionToken }, ASSISTANT_API_BASE_URL, ASSISTANT_TIMEOUT_MS));
}

// 浏览赛事、搜索、看详情（公开数据，不需要身份）。出问题时匿名记一笔（clientLog.ts）：失败、加载超过 3 秒。
export async function callPublicData<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const started = Date.now();
  try {
    const result = await requestServer<T>('/api/publicData', { ...payload, action });
    const elapsed = Date.now() - started;
    if (elapsed > SLOW_THRESHOLD_MS) reportIssue('slow', { action: `publicData.${action}`, elapsedMs: elapsed });
    return result;
  } catch (error) {
    reportIssue('load_failed', { action: `publicData.${action}`, message: describeError(error), elapsedMs: Date.now() - started });
    throw error;
  }
}
