// 访问异常上报（2026-10-01 起）。
//
// 用户手机上出的错，原先只有用户自己看得到：测试用户遇到“连接超时”，请求根本没到服务器，
// 服务器没有任何记录。这里在出问题时匿名记一笔，发到腾讯云开发上海环境的 clientLog 云函数，
// 美国服务器每 5 分钟拉回去，后台“访问异常”页可以看到。
//
// 只记：时间、页面、在做什么、错误信息、耗时、网络类型、手机系统和微信版本、小程序版本。
// 不记 IP、微信身份或任何个人信息。上报本身出错一律静默，不能反过来影响用户使用。
import { API_BASE_URL, BEIJING_BACKEND_ENABLED, CLOUD_ENV_ID } from '../config/cloud';

export type IssueKind =
  | 'cloud_fallback'   // 上海读取失败，已自动退回美国服务器（用户可能没感觉）
  | 'load_failed'      // 两边都失败，用户看到了“网络不太稳定”
  | 'slow'             // 加载成功但超过 3 秒
  | 'user_data_failed' // 登录、收藏、提醒失败
  | 'js_error';        // 小程序代码报错

export interface IssueDetail {
  action?: string;
  message?: string;
  elapsedMs?: number;
  extra?: string;
}

const PENDING_KEY = 'client_issue_pending';
const MAX_PENDING = 50;
export const SLOW_THRESHOLD_MS = 3000;

let networkType = 'unknown';
let deviceInfo: Record<string, string> | null = null;
let cloudReady = false;
let flushing = false;

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function currentPage(): string {
  return safe(() => {
    const pages = getCurrentPages();
    return String(pages[pages.length - 1]?.route || '');
  }, '');
}

function describeDevice(): Record<string, string> {
  if (deviceInfo) return deviceInfo;
  const base = safe(() => (wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync()), {} as any);
  const device = safe(() => (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()), {} as any);
  const account = safe(() => wx.getAccountInfoSync(), {} as any);
  deviceInfo = {
    platform: String(device.platform || ''),
    system: String(device.system || ''),
    wechatVersion: String(base.version || ''),
    sdkVersion: String(base.SDKVersion || ''),
    appVersion: String(account?.miniProgram?.version || ''),
    envVersion: String(account?.miniProgram?.envVersion || ''),
  };
  return deviceInfo;
}

function ensureCloud(): boolean {
  if (cloudReady) return true;
  if (!wx.cloud?.init || !wx.cloud?.callFunction) return false;
  // cloudSession.ts 里也会 init；重复 init 同一个环境没有副作用
  safe(() => wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: false }), undefined);
  cloudReady = true;
  return true;
}

function readPending(): any[] {
  return safe(() => {
    const value = wx.getStorageSync(PENDING_KEY);
    return Array.isArray(value) ? value : [];
  }, []);
}

function writePending(items: any[]) {
  safe(() => wx.setStorageSync(PENDING_KEY, items.slice(-MAX_PENDING)), undefined);
}

// 发出去；发不出去（比如手机完全断网）就存在手机里，下次打开小程序或下次出错时补发
// 待发的都在手机存储里；发成功只删掉发出去的那几条（发的过程中可能又记了新的，不能整体覆盖）
async function flush() {
  if (!BEIJING_BACKEND_ENABLED && !ensureCloud()) return;
  for (let round = 0; round < 3; round += 1) {
    const batch = readPending().slice(0, 20);
    if (!batch.length) return;
    try {
      if (BEIJING_BACKEND_ENABLED) {
        const accepted = await new Promise<boolean>(resolve => {
          wx.request({ url:`${API_BASE_URL}/api/clientLog`, method:'POST', timeout:15000, header:{ 'content-type':'application/json' }, data:{ events:batch }, success:(response:any) => resolve(response.statusCode >= 200 && response.statusCode < 300 && response.data?.ok === true), fail:() => resolve(false) });
        });
        if (!accepted) return;
      } else {
        const response = await wx.cloud.callFunction({ name: 'clientLog', data: { events:batch } });
        if (response?.result?.ok !== true) return;
      }
      const sent = new Set(batch.map((item: any) => item.id));
      writePending(readPending().filter((item: any) => !sent.has(item.id)));
    } catch {
      return; // 留在手机里，下次再发
    }
  }
}

function startFlush() {
  if (flushing) return;
  flushing = true;
  flush().finally(() => { flushing = false; });
}

export function reportIssue(kind: IssueKind, detail: IssueDetail = {}) {
  safe(() => {
    const event = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      at: new Date().toISOString(),
      kind,
      page: currentPage(),
      action: String(detail.action || '').slice(0, 40),
      message: String(detail.message || '').slice(0, 300),
      elapsedMs: Number.isFinite(detail.elapsedMs) ? Math.round(Number(detail.elapsedMs)) : null,
      extra: String(detail.extra || '').slice(0, 200),
      networkType,
      ...describeDevice(),
    };
    writePending([...readPending(), event]);
    startFlush();
  }, undefined);
}

// 小程序启动时调用：记下网络类型，补发上次没发出去的
export function initClientLog() {
  safe(() => {
    wx.getNetworkType({ success: (res: any) => { networkType = String(res?.networkType || 'unknown'); } });
    wx.onNetworkStatusChange?.((res: any) => { networkType = String(res?.networkType || 'unknown'); });
  }, undefined);
  if (readPending().length) startFlush();
}
