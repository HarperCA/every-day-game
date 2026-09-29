// 国内网页中转：直接打不开时改走腾讯云开发上海的 pageRelay（2026-09-29）
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const relayFn = require('../apps/miniprogram/cloudfunctions/pageRelay/index.js');
const client = require('../apps/miniprogram/cloudfunctions/adminData/pageRelayClient.js');

describe('中转云函数的安全限制', () => {
  beforeEach(() => { process.env.RELAY_SECRET = 's'.repeat(40); });
  afterEach(() => { delete process.env.RELAY_SECRET; });
  it('没有或带错密钥一律拒绝', async () => {
    expect(await relayFn.main({ url:'https://example.org/' })).toEqual({ ok:false, status:'forbidden' });
    expect(await relayFn.main({ url:'https://example.org/', secret:'x'.repeat(40) })).toEqual({ ok:false, status:'forbidden' });
  });
  it('内网、本机、云内部地址不取', async () => {
    for (const url of ['http://127.0.0.1/', 'http://10.1.2.3/', 'http://169.254.169.254/latest/meta-data', 'http://192.168.1.1/']) {
      expect((await relayFn.main({ url, secret:'s'.repeat(40) })).status).toBe('private_address');
    }
  });
  it('HTTP 访问服务传来的 body 也能读', async () => {
    const result = await relayFn.main({ body:JSON.stringify({ url:'http://127.0.0.1/', secret:'s'.repeat(40) }) });
    expect(result.status).toBe('private_address');
  });
});

describe('中转客户端', () => {
  it('只有连不上、超时、403 才走中转；412 反爬和 404 不走', () => {
    expect(['network_error', 'timeout', 'unreachable', 'http_403'].every(client.shouldRelay)).toBe(true);
    expect(['http_412', 'http_404', 'blocked_by_robots', 'ok'].some(client.shouldRelay)).toBe(false);
  });
  it('没配置时不生效；取到的内容按原样还原', async () => {
    expect((await client.relayFetch('https://a.cn/', null)).status).toBe('relay_disabled');
    const fetchImpl = vi.fn(async () => ({ json:async () => ({ ok:true, status:'ok', httpStatus:200, finalUrl:'https://a.cn/x', contentType:'text/html', bodyBase64:Buffer.from('<p>你好</p>').toString('base64'), tlsUnverified:true }) }));
    const result = await client.relayFetch('https://a.cn/', { endpoint:'https://relay', secret:'k' }, { fetchImpl });
    expect(result).toMatchObject({ status:'ok', finalUrl:'https://a.cn/x', tlsUnverified:true });
    expect(result.buffer.toString('utf8')).toBe('<p>你好</p>');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ url:'https://a.cn/', secret:'k' });
  });
});

describe('抓取层：直接打不开时自动改走中转', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => { process.env.RELAY_ENDPOINT = 'https://relay.example/page-relay'; process.env.RELAY_SECRET = 'k'; });
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.RELAY_ENDPOINT; delete process.env.RELAY_SECRET; });
  it('连不上 → 中转取回正文，并标明来自中转', async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      if (url === 'https://relay.example/page-relay') {
        return new Response(JSON.stringify({ ok:true, status:'ok', httpStatus:200, finalUrl:'https://cxcy.upln.cn/', contentType:'text/html; charset=utf-8', bodyBase64:Buffer.from('<title>辽宁</title>').toString('base64') }));
      }
      if (String(url).endsWith('/robots.txt')) return new Response('', { status:404 });
      throw new TypeError('fetch failed');
    });
    const { Fetcher } = await import('../scripts/crawler/lib/fetcher.mjs');
    const fetcher = new Fetcher({ cacheDir:null, perHostDelayMs:0 });
    const page = await fetcher.get('https://cxcy.upln.cn/', { useCache:false });
    expect(page).toMatchObject({ status:'ok', via:'relay', finalUrl:'https://cxcy.upln.cn/' });
    expect(page.text).toContain('辽宁');
  });
});
