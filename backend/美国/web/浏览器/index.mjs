// 浏览器：无头浏览器（Playwright 的 Chromium）打开网页，给新维护的爬虫脚本用（2026-11-08 用户定：页面靠脚本加载、要点击的用浏览器）。
// 只提供函数，由 读网页/浏览器.mjs 包上安全检查后交出去。对外只开放 打开、等待、点击、源码、网址 五个动作，不开放执行页面脚本。
//
//   启动浏览器({ chromium }) → browser            chromium 不给就从 Environment 的 playwright 拿
//   新页面(browser, { 安全检查, 超时 }) → { 页, 关 }   一个页面一个浏览环境（context），用完 关() 整个关掉
//   包装页面(page, { 安全检查, 超时, 出事 }) → { 打开(网址), 等待({ 选择器 | 毫秒 }), 点击(选择器), 源码(), 网址() }
//     打开前查网址安全，不安全抛错（“网址不安全：…”）；打开等到 DOM 加载完，再最多等 5 秒网络空闲
//     页面被安全检查拦下（见下）后，打开、等待、点击、源码都抛“页面请求了不安全的地址：…”
//
// 内网检查（2026-11-08 补漏洞，Playwright 1.50.1 上用真浏览器试过）：
//   - 普通请求：浏览环境上 route 拦，图片、字体、音视频不加载，内网地址 abort。拦在环境上，点出来的新窗口也管。
//   - WebSocket：route 拦不到，用 routeWebSocket 拦所有 ws/wss，按 http/https 地址做同样的检查，不安全的直接关掉（1008），安全的连真服务器。
//   - 跳转：route 只在第一跳调用（Playwright 文档原话 “The handler will only be called for the first url if the response is a redirect”），
//     中间几跳和最后一跳拦不到。所以听浏览环境的 request 事件，凡是跳转来的请求（redirectedFrom）都查，不安全就关掉整个浏览环境，
//     之后的动作都抛错。注意：这时请求已经发出去了，只能保证读不到内容、页面不能接着用，挡不住“发出去”这一下。
//   - routeWebSocket 是往页面里注入脚本替换 WebSocket 实现的，管不到 Worker 里的 WebSocket；WebRTC、WebTransport 也不走 route。
//     所以页面加载前去掉 Worker、SharedWorker、RTCPeerConnection、WebTransport（爬通知列表用不到）。Service Worker 关掉。
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../Environment/package.json', import.meta.url));
const 不加载 = new Set(['image', 'media', 'font']);

// 在页面（包括 iframe）里先于网站脚本运行，去掉拦不到的连接方式
function 去掉拦不到的连接() {
  for (const 名 of ['Worker', 'SharedWorker', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) {
    try { delete globalThis[名]; } catch { /* 删不掉就算了 */ }
  }
}

export async function 启动浏览器({ chromium = require('playwright').chromium } = {}) {
  return chromium.launch({ headless: true });
}

// 记下页面有没有被拦下：查是异步的，动作结束前要等正在查的查完
function 建出事(安全检查, 拦下后) {
  const 正在查 = new Set();
  const 出事 = {
    原因: null,
    拦下(原因) {
      if (出事.原因) return;
      出事.原因 = 原因;
      拦下后();
    },
    查(网址, 怎么) {
      const 一次 = Promise.resolve()
        .then(() => 安全检查(网址))
        .then(原因 => { if (原因) 出事.拦下(`${怎么} ${网址}：${原因}`); }, error => 出事.拦下(`${怎么} ${网址}：检查出错 ${error?.message || error}`))
        .finally(() => 正在查.delete(一次));
      正在查.add(一次);
    },
    async 等查完() { while (正在查.size) await Promise.all([...正在查]); },
    错误: () => new Error(`页面请求了不安全的地址：${出事.原因}`),
  };
  return 出事;
}

export function 包装页面(page, { 安全检查, 超时 = 20000, 出事 = null }) {
  // 动作前后都看一眼有没有被拦下；动作因为页面被关掉而出错时，报被拦下的原因
  async function 守(做) {
    if (出事?.原因) throw 出事.错误();
    let 结果;
    try { 结果 = await 做(); } catch (error) {
      await 出事?.等查完();
      if (出事?.原因) throw 出事.错误();
      throw error;
    }
    await 出事?.等查完();
    if (出事?.原因) throw 出事.错误();
    return 结果;
  }
  return {
    async 打开(网址) {
      const 不安全 = await 安全检查(网址);
      if (不安全) throw new Error(`网址不安全：${不安全}`);
      return 守(async () => {
        const 回应 = await page.goto(网址, { waitUntil: 'domcontentloaded', timeout: 超时 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        return { httpStatus: 回应?.status() ?? null, 网址: page.url() };
      });
    },
    等待({ 选择器, 毫秒 } = {}) {
      return 守(async () => {
        if (选择器) await page.waitForSelector(选择器, { timeout: 超时 });
        else await page.waitForTimeout(毫秒);
      });
    },
    点击(选择器) {
      return 守(async () => {
        await page.click(选择器, { timeout: 超时 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      });
    },
    源码: () => 守(() => page.content()),
    网址: () => page.url(),
  };
}

export async function 新页面(browser, { 安全检查, 超时 = 20000 }) {
  const 环境 = await browser.newContext({ locale: 'zh-CN', acceptDownloads: false, serviceWorkers: 'block' });
  const 关 = () => 环境.close().catch(() => {});
  const 出事 = 建出事(安全检查, 关);
  try {
    await 环境.addInitScript(去掉拦不到的连接);
    await 环境.route('**/*', async route => {
      const req = route.request();
      if (不加载.has(req.resourceType())) return route.abort();
      if (await 安全检查(req.url())) return route.abort();
      return route.continue();
    });
    await 环境.routeWebSocket(() => true, async ws => {
      const 网址 = ws.url().replace(/^ws(s?):/i, 'http$1:');
      let 不安全;
      try { 不安全 = await 安全检查(网址); } catch (error) { 不安全 = `检查出错 ${error?.message || error}`; }
      if (不安全) return ws.close({ code: 1008, reason: 'blocked' });
      ws.connectToServer();
    });
    环境.on('request', req => { if (req.redirectedFrom()) 出事.查(req.url(), '跳转到'); });
    const page = await 环境.newPage();
    return { 页: 包装页面(page, { 安全检查, 超时, 出事 }), 关 };
  } catch (error) {
    await 关();
    throw error;
  }
}
