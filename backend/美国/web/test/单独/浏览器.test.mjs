// 无头浏览器（2026-11-08）：建浏览器只启动一个 Chromium（并发时大家等同一个），新页面的安全检查（请求、WebSocket、跳转的中间几跳）。
// 前两组用假的 Playwright；最后一组用真的 Chromium 和本机起的两个网站（一个当“内网”），没装浏览器就跳过。
import http from 'node:http';
import { afterAll, describe, expect, test } from 'vitest';
import { 启动浏览器, 新页面 } from '../../浏览器/index.mjs';
import { 建浏览器 } from '../../读网页/浏览器.mjs';

const 等 = 毫秒 => new Promise(r => setTimeout(r, 毫秒));

function 假环境({ 页面 = {} } = {}) {
  const 环境 = {
    路由: null, ws路由: null, 听: {}, 初始脚本: [], 关了: 0,
    async route(规则, fn) { 环境.路由 = fn; },
    async routeWebSocket(规则, fn) { 环境.ws路由 = { 规则, fn }; },
    on(事件, fn) { (环境.听[事件] ||= []).push(fn); },
    async addInitScript(脚本) { 环境.初始脚本.push(脚本); },
    async newPage() { return { waitForLoadState: async () => {}, url: () => 'https://a.cn/', content: async () => '<html></html>', ...(typeof 页面 === 'function' ? 页面(环境) : 页面) }; },
    async close() { 环境.关了 += 1; },
    发请求(网址, 从哪跳来 = null) { for (const fn of 环境.听.request || []) fn({ url: () => 网址, redirectedFrom: () => (从哪跳来 ? { url: () => 从哪跳来 } : null) }); },
  };
  return 环境;
}
function 假浏览器() {
  const 浏览器 = { 环境们: [], 关了: 0, 听: {},
    async newContext() { const 环境 = 假环境(); 浏览器.环境们.push(环境); return 环境; },
    async close() { 浏览器.关了 += 1; },
    on(事件, fn) { (浏览器.听[事件] ||= []).push(fn); },
  };
  return 浏览器;
}
const 内网检查 = async 网址 => (/\/\/(10\.|127\.)/.test(网址) ? '不读内网地址' : null);

describe('建浏览器：只启动一个 Chromium', () => {
  function 假chromium({ 慢 = 20, 先失败 = 0 } = {}) {
    const c = { 次: 0, 浏览器们: [],
      async launch() { c.次 += 1; await 等(慢); if (c.次 <= 先失败) throw new Error('Executable does not exist'); const b = 假浏览器(); c.浏览器们.push(b); return b; } };
    return c;
  }
  test('第一次几个并发同时要页面：只启动一次，大家用同一个；关() 关掉它，再要时重新启动', async () => {
    const chromium = 假chromium();
    const 浏 = 建浏览器({ 安全检查: 内网检查, chromium });
    await Promise.all([浏.新页面(), 浏.新页面(), 浏.新页面()]);
    expect(chromium.次).toBe(1);
    expect(chromium.浏览器们[0].环境们).toHaveLength(3);
    await 浏.关();
    expect(chromium.浏览器们[0].关了).toBe(1);
    await 浏.新页面();
    expect(chromium.次).toBe(2);
    await 浏.关();
  });
  test('启动失败：这次抛错（并发的都拿到同一个错），下次重新启动', async () => {
    const chromium = 假chromium({ 先失败: 1 });
    const 浏 = 建浏览器({ 安全检查: 内网检查, chromium });
    const 回 = await Promise.allSettled([浏.新页面(), 浏.新页面()]);
    expect(回.map(x => x.status)).toEqual(['rejected', 'rejected']);
    expect(chromium.次).toBe(1);
    await 浏.新页面();
    expect(chromium.次).toBe(2);
    await 浏.关();
  });
  test('启动中调 关()：等启动完再关掉，不留下没人管的浏览器', async () => {
    const chromium = 假chromium({ 慢: 50 });
    const 浏 = 建浏览器({ 安全检查: 内网检查, chromium });
    const 要 = 浏.新页面().catch(e => e);
    await 等(5);
    await 浏.关();
    await 要;
    expect(chromium.次).toBe(1);
    expect(chromium.浏览器们[0].关了).toBe(1);
  });
  test('浏览器自己断开（崩溃）：下次要页面时重新启动', async () => {
    const chromium = 假chromium();
    const 浏 = 建浏览器({ 安全检查: 内网检查, chromium });
    await 浏.新页面();
    for (const fn of chromium.浏览器们[0].听.disconnected || []) fn();
    await 浏.新页面();
    expect(chromium.次).toBe(2);
    await 浏.关();
  });
});

describe('新页面：安全检查', () => {
  test('请求：图片、字体、音视频不加载；内网地址拦下；别的放行（拦在整个浏览环境上，弹出的新窗口也管）', async () => {
    const b = 假浏览器();
    await 新页面(b, { 安全检查: 内网检查 });
    const 路由 = b.环境们[0].路由;
    const 试 = async (网址, 类型 = 'document') => { const 记 = []; await 路由({ request: () => ({ url: () => 网址, resourceType: () => 类型 }), abort: async () => 记.push('拦'), continue: async () => 记.push('放') }); return 记[0]; };
    expect(await 试('https://a.cn/x.png', 'image')).toBe('拦');
    expect(await 试('http://10.0.0.1/')).toBe('拦');
    expect(await 试('https://a.cn/')).toBe('放');
  });
  test('WebSocket：所有 ws/wss 都过安全检查（按 http/https 查），不安全的直接关掉，安全的连到真服务器', async () => {
    const b = 假浏览器();
    const 查过 = [];
    await 新页面(b, { 安全检查: async u => { 查过.push(u); return 内网检查(u); } });
    const { 规则, fn } = b.环境们[0].ws路由;
    const 匹配 = u => (typeof 规则 === 'function' ? 规则(new URL(u)) : 规则 instanceof RegExp ? 规则.test(u) : false);
    expect(匹配('ws://127.0.0.1:9000/x')).toBe(true);
    expect(匹配('wss://a.cn/s')).toBe(true);
    const 假ws = 网址 => { const 记 = []; return { 记, url: () => 网址, close: async o => 记.push(['关', o?.code]), connectToServer: () => { 记.push(['连']); return {}; } }; };
    const 坏 = 假ws('ws://127.0.0.1:9000/x');
    await fn(坏);
    expect(坏.记).toEqual([['关', 1008]]);
    const 好 = 假ws('wss://a.cn/s');
    await fn(好);
    expect(好.记).toEqual([['连']]);
    expect(查过).toEqual(['http://127.0.0.1:9000/x', 'https://a.cn/s']);
  });
  test('页面里 Worker、SharedWorker 换成空壳，去掉 WebRTC、WebTransport（这些连接拦不到）', async () => {
    const b = 假浏览器();
    await 新页面(b, { 安全检查: 内网检查 });
    const 脚本 = String(b.环境们[0].初始脚本[0]);
    for (const 名 of ['Worker', 'SharedWorker', 'RTCPeerConnection', 'WebTransport']) expect(脚本).toContain(名);
  });
  test('跳转的中间几跳（route 拦不到）：跳到内网就关掉整个页面，打开、点击、源码都抛“页面请求了不安全的地址”', async () => {
    const b = 假浏览器();
    b.newContext = async () => {
      const 环境 = 假环境({ 页面: 环境 => ({
        goto: async 网址 => { 环境.发请求('http://10.0.0.1/secret', 网址); return { status: () => 200 }; },
        content: async () => { if (环境.关了) throw new Error('page.content: Target page, context or browser has been closed'); return 'SECRET'; },
      }) });
      b.环境们.push(环境);
      return 环境;
    };
    const { 页 } = await 新页面(b, { 安全检查: 内网检查 });
    await expect(页.打开('https://a.cn/go')).rejects.toThrow(/页面请求了不安全的地址：跳转到 http:\/\/10\.0\.0\.1\/secret/);
    expect(b.环境们[0].关了).toBeGreaterThan(0);
    await expect(页.源码()).rejects.toThrow('页面请求了不安全的地址');
  });
  test('跳到公网地址照常；不是跳转来的请求不在这里查（route 已经查过）', async () => {
    const b = 假浏览器();
    b.newContext = async () => {
      const 环境 = 假环境({ 页面: 环境 => ({ goto: async 网址 => { 环境.发请求('https://b.cn/', 网址); 环境.发请求('http://10.0.0.1/'); return { status: () => 200 }; } }) });
      b.环境们.push(环境);
      return 环境;
    };
    const { 页 } = await 新页面(b, { 安全检查: 内网检查 });
    await expect(页.打开('https://a.cn/go')).resolves.toMatchObject({ httpStatus: 200 });
    expect(b.环境们[0].关了).toBe(0);
  });
  test('建页面中途出错：关掉浏览环境再抛出', async () => {
    const b = 假浏览器();
    b.newContext = async () => { const 环境 = 假环境(); 环境.newPage = async () => { throw new Error('newPage 失败'); }; b.环境们.push(环境); return 环境; };
    await expect(新页面(b, { 安全检查: 内网检查 })).rejects.toThrow('newPage 失败');
    expect(b.环境们[0].关了).toBe(1);
  });
});

// 真的 Chromium：本机起两个网站，端口是“内网口”的当内网
let 真浏览器 = null;
try { 真浏览器 = await 启动浏览器(); } catch { 真浏览器 = null; }
afterAll(async () => { await 真浏览器?.close().catch(() => {}); });

describe.skipIf(!真浏览器)('真的 Chromium（没装浏览器就跳过）', () => {
  async function 起网站() {
    const 内网收到 = [];
    const 外收到 = [];
    const 内网 = http.createServer((req, res) => { 内网收到.push(req.url); res.end('<html><body>SECRET</body></html>'); });
    内网.on('upgrade', (req, sock) => { 内网收到.push(`WS ${req.url}`); sock.destroy(); });
    await new Promise(r => 内网.listen(0, '127.0.0.1', r));
    const 内网口 = 内网.address().port;
    const 页 = body => `<html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
    const 外 = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (req.url === '/redir') { res.writeHead(302, { location: `http://127.0.0.1:${内网口}/via-redirect` }); return res.end(); }
      if (req.url === '/ws') return res.end(页(`<script>const w = new WebSocket('ws://127.0.0.1:${内网口}/sock'); w.onclose = e => document.body.dataset.ws = 'closed ' + e.code; w.onopen = () => document.body.dataset.ws = 'open';</script>`));
      if (req.url === '/worker') return res.end(页(`<script>document.body.dataset.worker = typeof Worker + ',' + typeof SharedWorker + ',' + typeof RTCPeerConnection;</script>`));
      // 像蓝桥杯 lanqiao.cn 那样页面脚本一上来就 new Worker：不报错、页面照常渲染；Worker 是空壳，脚本文件不会被请求
      if (req.url === '/new-worker') return res.end(页(`<div id="app"></div><script>
        const w = new Worker('/w.js'); w.addEventListener('message', () => {}); w.onmessage = () => {}; w.postMessage({ a: 1 }); w.terminate();
        const s = new SharedWorker('/s.js'); s.port.start(); s.port.postMessage('x'); s.port.addEventListener('message', () => {});
        document.getElementById('app').innerHTML = '<ul><li>脚本渲染的通知列表</li></ul>';
        document.body.dataset.worker = typeof Worker + ',' + (w instanceof Worker) + ',' + typeof RTCPeerConnection + ',' + typeof WebTransport;
      </script>`));
      if (req.url === '/w.js' || req.url === '/s.js') { 外收到.push(req.url); return res.end(`fetch('http://127.0.0.1:${内网口}/from-worker')`); }
      return res.end(页('<ul><li>公网页面</li></ul>'));
    });
    await new Promise(r => 外.listen(0, '127.0.0.1', r));
    const 外址 = `http://127.0.0.1:${外.address().port}`;
    const 安全检查 = async u => (new URL(u).port === String(内网口) ? '不读内网地址' : null);
    return { 内网收到, 外收到, 外址, 安全检查, 关: () => { 内网.close(); 外.close(); } };
  }

  test('公网页面照常打开、读源码；跳到内网：打开抛错，读不到内网的内容', async () => {
    const 站 = await 起网站();
    const { 页, 关 } = await 新页面(真浏览器, { 安全检查: 站.安全检查, 超时: 10000 });
    try {
      await 页.打开(`${站.外址}/`);
      expect(await 页.源码()).toContain('公网页面');
      await expect(页.打开(`${站.外址}/redir`)).rejects.toThrow('页面请求了不安全的地址');
      await expect(页.源码()).rejects.toThrow('页面请求了不安全的地址');
    } finally { await 关(); 站.关(); }
  }, 30000);
  test('页面脚本连内网的 WebSocket：被关掉（1008），内网收不到连接', async () => {
    const 站 = await 起网站();
    const { 页, 关 } = await 新页面(真浏览器, { 安全检查: 站.安全检查, 超时: 10000 });
    try {
      await 页.打开(`${站.外址}/ws`);
      await 页.等待({ 选择器: 'body[data-ws]' });
      expect(await 页.源码()).toContain('data-ws="closed 1008"');
      expect(站.内网收到).toEqual([]);
    } finally { await 关(); 站.关(); }
  }, 30000);
  test('Worker、SharedWorker 是空壳（能 new，但什么都不做）；页面里没有 RTCPeerConnection、WebTransport', async () => {
    const 站 = await 起网站();
    const { 页, 关 } = await 新页面(真浏览器, { 安全检查: 站.安全检查, 超时: 10000 });
    try {
      await 页.打开(`${站.外址}/worker`);
      expect(await 页.源码()).toContain('data-worker="function,function,undefined"');
    } finally { await 关(); 站.关(); }
  }, 30000);
  test('页面 new Worker 不报错、页面能渲染；Worker 不真的跑（脚本文件没被请求，内网收不到）', async () => {
    const 站 = await 起网站();
    const { 页, 关 } = await 新页面(真浏览器, { 安全检查: 站.安全检查, 超时: 10000 });
    try {
      await 页.打开(`${站.外址}/new-worker`);
      await 页.等待({ 选择器: 'body[data-worker]' });
      const 源码 = await 页.源码();
      expect(源码).toContain('脚本渲染的通知列表');
      expect(源码).toContain('data-worker="function,true,undefined,undefined"');
      expect(站.外收到).toEqual([]);
      expect(站.内网收到).toEqual([]);
    } finally { await 关(); 站.关(); }
  }, 30000);
});
