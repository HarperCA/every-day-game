// 匿名使用统计：记下测试用户做了什么，攒一小批再发给服务器（publicData 的 track）。
// 不收集个人信息：每个浏览器只有一个随机编号，存在本地；不需要登录。
// 统计失败不影响页面使用。本地开发（localhost）时不上报，免得污染数据。

type EventType = 'visit' | 'view_page' | 'search' | 'filter' | 'view_detail' | 'open_official' | 'copy_link' | 'favorite' | 'feedback';

const VISITOR_KEY = 'web-test-visitor-v1';
const ENABLED = !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
let queue: Array<{ type: EventType; data: Record<string, unknown> }> = [];
let timer: number | undefined;

function visitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).toLowerCase();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return 'no-storage-visitor';
  }
}

const device = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop';

function body() {
  const events = queue.slice(0, 20);
  queue = queue.slice(20);
  return JSON.stringify({ action: 'track', visitor: visitorId(), device, events });
}

export function flush(useBeacon = false) {
  if (!ENABLED || !queue.length) return;
  window.clearTimeout(timer);
  timer = undefined;
  while (queue.length) {
    const payload = body();
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/publicData', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/publicData', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => undefined);
    }
  }
}

export function track(type: EventType, data: Record<string, unknown> = {}) {
  if (!ENABLED) return;
  queue.push({ type, data });
  // 攒 5 秒一起发；点官网这类会离开页面的操作立即发。
  if (type === 'open_official' || queue.length >= 20) flush();
  else if (timer === undefined) timer = window.setTimeout(() => flush(), 5000);
}

addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
addEventListener('pagehide', () => flush(true));
