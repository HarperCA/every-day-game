import { describe, expect, it } from 'vitest';
import { publicAddress, createPublicFetch, createRobotsLoader, requestPinned } from '../scripts/server/beijing-reader-stdio.mjs';
import { createBeijingReader } from '../scripts/server/beijing-page-reader.mjs';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { Fetcher } from '../scripts/crawler/lib/fetcher.mjs';
function responder(page, code = 0) {
  return () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { on() {}, end() { queueMicrotask(() => { child.stdout.emit('data', Buffer.from(JSON.stringify(page))); child.emit('close', code); }); } };
    child.kill = () => {}; return child;
  };
}
const lookup = async () => [{ address: '8.8.8.8', family: 4 }];
describe('Beijing official page reader', () => {
  it('rejects private, reserved, multicast and transition IPs', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.1.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '192.0.2.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', '::1', '0:0:0:0:0:0:0:1', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::1', '3fff::1']) expect(publicAddress(ip), ip).toBe(false);
    expect(publicAddress('8.8.8.8')).toBe(true); expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('pins the DNS-approved address while keeping the HTTPS certificate hostname', async () => {
    let configuration;
    const requestImpl = (url, options, callback) => {
      configuration = options; const req = new EventEmitter();
      req.end = () => { const res = Readable.from([Buffer.from('body')]); res.statusCode = 200; res.headers = { 'content-type': 'text/plain' }; callback(res); };
      return req;
    };
    const response = await requestPinned(new URL('https://official.example/page'), { address: '8.8.8.8' }, { requestImpl });
    expect(configuration.servername).toBe('official.example'); expect(configuration.agent).toBe(false);
    const actual = await new Promise(resolve => configuration.lookup('official.example', {}, (error, address, family) => resolve({ error, address, family })));
    expect(actual).toEqual({ error: null, address: '8.8.8.8', family: 4 }); expect(await response.text()).toBe('body');
  });
  it('uses one DNS resolution per hop and passes the exact checked address to transport', async () => {
    let lookups = 0; const requests = [];
    const safeFetch = createPublicFetch({ lookup: async () => { lookups++; return lookups === 1 ? [{ address: '8.8.8.8' }] : [{ address: '127.0.0.1' }]; }, request: async (url, address) => { requests.push(address.address); return new Response('page'); } });
    await safeFetch('https://school.example/page'); expect(lookups).toBe(1); expect(requests).toEqual(['8.8.8.8']);
    await expect(safeFetch('https://school.example/next')).rejects.toThrow('private_url_forbidden'); expect(requests).toHaveLength(1);
  });
  it('decodes compressed HTTP bodies before the crawler enforces its size limit', async () => {
    const compressed = gzipSync(Buffer.from('官方网页正文'));
    const requestImpl = (_url, _options, callback) => {
      const req = new EventEmitter(); req.end = () => {
        const res = Readable.from([compressed]); res.statusCode = 200;
        res.headers = { 'content-encoding': 'gzip', 'content-length': String(compressed.length) }; callback(res);
      }; return req;
    };
    const response = await requestPinned(new URL('https://school.example/page'), { address: '8.8.8.8' }, { requestImpl });
    expect(await response.text()).toBe('官方网页正文'); expect(response.headers.get('content-length')).toBe(null);
  });
  it('follows a redirected robots.txt and prevents fetching a forbidden article', async () => {
    const requested = [];
    const safeFetch = createPublicFetch({ lookup, request: async url => {
      requested.push(url.href);
      if (url.pathname === '/robots.txt') return new Response('', { status: 302, headers: { location: '/policy.txt' } });
      if (url.pathname === '/policy.txt') return new Response('User-agent: *\nDisallow: /private', { headers: { 'content-type': 'text/plain' } });
      throw Error('Article must not be read');
    } });
    const fetcher = new Fetcher({ perHostDelayMs: 0 }); fetcher.loadRobots = createRobotsLoader(safeFetch);
    expect((await fetcher.getDirect('https://school.example/private')).status).toBe('blocked_by_robots');
    expect(requested).toEqual(['https://school.example/robots.txt', 'https://school.example/policy.txt']);
  });
  it('cancels redirect bodies and refuses private robots redirects before connection', async () => {
    let canceled = false, calls = 0;
    const safeFetch = createPublicFetch({ lookup, request: async () => {
      calls++; return { status: 302, headers: new Headers({ location: 'http://127.0.0.1/robots.txt' }), body: { async cancel() { canceled = true; } } };
    } });
    await expect(createRobotsLoader(safeFetch)('https://school.example')).rejects.toThrow('private_url_forbidden'); expect(canceled).toBe(true); expect(calls).toBe(1);
  });
  it('limits robots redirect loops and stops rather than bypassing policy', async () => {
    let calls = 0;
    const safeFetch = createPublicFetch({ lookup, maxRedirects: 2, request: async () => { calls++; return new Response('', { status: 302, headers: { location: '/robots.txt' } }); } });
    await expect(createRobotsLoader(safeFetch)('https://school.example')).rejects.toThrow('too_many_redirects'); expect(calls).toBe(3);
  });
  it('never supplements robots prohibitions or private/policy targets, including remote exit 1', async () => {
    let called = 0; const fallback = async () => { called++; return {}; };
    const blocked = createBeijingReader(fallback, { host: 'h', key: 'k', spawnImpl: responder({ status: 'blocked', text: '' }) });
    expect((await blocked('https://school.example')).status).toBe('blocked');
    for (const error of ['private_url_forbidden', 'invalid_public_url', 'too_many_redirects', 'robots_too_large']) {
      const read = createBeijingReader(fallback, { host: 'h', key: 'k', spawnImpl: responder({ status: 'error', error, text: '' }, 1) });
      expect((await read('https://school.example')).error).toBe(error);
    }
    expect(called).toBe(0);
  });
  it('supplements transient failure and preserves its reason', async () => {
    const read = createBeijingReader(async url => ({ status: 'ok', url, text: 'official' }), { host: 'h', key: 'k', spawnImpl: responder({ status: 'network_error', text: '', error: 'ECONNRESET' }) });
    expect(await read('https://school.example')).toMatchObject({ status: 'ok', beijingStatus: 'network_error', beijingError: 'ECONNRESET' });
  });
  it('rejects malformed shapes and successful-looking output from failed SSH', async () => {
    for (const [page, code, reason] of [[{ status: 'ok', text: 12 }, 0, 'beijing_reader_invalid_response'], [{ status: 'ok', text: 'article' }, 255, 'beijing_reader_exit_255']]) {
      const read = createBeijingReader(async () => ({ status: 'ok', text: 'fallback' }), { host: 'h', key: 'k', spawnImpl: responder(page, code) });
      expect((await read('https://school.example')).beijingError).toBe(reason);
    }
  });
  it('waits for SSH close before fallback after timeout', async () => {
    let closed = false, signals = [];
    const spawnImpl = () => {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = { on() {}, end() {} };
      child.kill = signal => { signals.push(signal || 'SIGTERM'); setTimeout(() => { closed = true; child.emit('close', null, signal || 'SIGTERM'); }, 5); };
      return child;
    };
    const read = createBeijingReader(async () => { expect(closed).toBe(true); return { status: 'ok', text: 'fallback' }; }, { host: 'h', key: 'k', spawnImpl, timeoutMs: 5, killGraceMs: 20 });
    expect((await read('https://school.example')).beijingError).toBe('beijing_reader_timeout'); expect(signals).toEqual(['SIGTERM']);
  });
  it('bounds output and kills before fallback without accumulating further data', async () => {
    let killed = 0;
    const spawnImpl = () => {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdin = { on() {}, end() { queueMicrotask(() => { child.stdout.emit('data', Buffer.alloc(33)); child.stdout.emit('data', Buffer.alloc(1000)); child.emit('close', null, 'SIGTERM'); }); } };
      child.kill = () => { killed++; }; return child;
    };
    const read = createBeijingReader(async () => ({ status: 'ok', text: 'fallback' }), { host: 'h', key: 'k', spawnImpl, maxOutputBytes: 32 });
    expect((await read('https://school.example')).beijingError).toBe('beijing_reader_output_limit'); expect(killed).toBe(1);
  });
  it('keeps Chinese text intact across split SSH byte chunks', async () => {
    const spawnImpl = () => {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdin = { on() {}, end() { queueMicrotask(() => {
        const bytes = Buffer.from(JSON.stringify({ status: 'ok', text: '官方来源' }));
        for (const byte of bytes) child.stdout.emit('data', Buffer.from([byte])); child.emit('close', 0);
      }); } }; child.kill = () => {}; return child;
    };
    const read = createBeijingReader(async () => { throw Error('unexpected fallback'); }, { host: 'h', key: 'k', spawnImpl });
    expect((await read('https://school.example')).text).toBe('官方来源');
  });
  it('escalates to SIGKILL when SSH ignores graceful termination', async () => {
    const signals = []; let closed = false;
    const spawnImpl = () => {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = { on() {}, end() {} };
      child.kill = signal => { signals.push(signal || 'SIGTERM'); if (signal === 'SIGKILL') { closed = true; child.emit('close', null, signal); } }; return child;
    };
    const read = createBeijingReader(async () => { expect(closed).toBe(true); return { status: 'ok', text: 'fallback' }; }, { host: 'h', key: 'k', spawnImpl, timeoutMs: 5, killGraceMs: 5 });
    expect((await read('https://school.example')).beijingError).toBe('beijing_reader_timeout'); expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });
});
