// Restricted SSH command: public URL in, extracted text out; no business-data writes.
import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { Readable, pipeline } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

export function publicAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0 && [0, 2].includes(c)) || (a === 192 && b === 88 && c === 99) ||
      (a === 198 && [18, 19].includes(b)) || (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (!net.isIPv6(ip)) return false;
  const [left, right = ''] = ip.toLowerCase().split('::');
  const first = left ? left.split(':') : [];
  const last = right ? right.split(':') : [];
  const groups = ip.includes('::') ? [...first, ...Array(8 - first.length - last.length).fill('0'), ...last] : first;
  const [a, b] = groups.map(value => Number.parseInt(value, 16));
  // Only global unicast; exclude documentation, transition, benchmark and ORCHID ranges.
  return a >= 0x2000 && a < 0x3fff && a !== 0x2002 &&
    !(a === 0x2001 && (b === 0 || b === 2 || b === 0xdb8 || (b >= 0x10 && b <= 0x2f)));
}

export async function resolvePublicUrl(value, lookup = dns.lookup) {
  let url;
  try { url = new URL(value); } catch { throw Error('invalid_public_url'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port))) throw Error('invalid_public_url');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw Error('private_url_forbidden');
  return { url, address: addresses.find(item => net.isIPv4(item.address)) || addresses[0] };
}

export function requestPinned(url, address, options) {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const transport = url.protocol === 'https:' ? https : http;
    const request = options.requestImpl || transport.request.bind(transport);
    const req = request(url, {
      method: 'GET', agent: false, signal: options.signal,
      headers: { ...options.headers, 'accept-encoding': 'identity' },
      // Pin the verified address. The TLS SNI, certificate name and HTTP Host remain the original hostname.
      lookup: (_hostname, lookupOptions, callback) => lookupOptions.all
        ? callback(null, [{ address: address.address, family: net.isIP(address.address) }])
        : callback(null, address.address, net.isIP(address.address)),
      ...(url.protocol === 'https:' && !net.isIP(host) ? { servername: host } : {}),
    }, res => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(res.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const encoding = String(headers.get('content-encoding') || '').toLowerCase();
      let stream = res;
      const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() : encoding === 'br' ? createBrotliDecompress() : null;
      if (decoder) {
        stream = decoder;
        pipeline(res, decoder, () => {});
        headers.delete('content-encoding'); headers.delete('content-length');
      }
      const noBody = [204, 205, 304].includes(res.statusCode);
      if (noBody) res.destroy();
      const response = new Response(noBody ? null : Readable.toWeb(stream), { status: res.statusCode, headers });
      Object.defineProperty(response, 'url', { value: url.href });
      resolve(response);
    });
    req.once('error', reject);
    req.end();
  });
}

export function createPublicFetch({ lookup = dns.lookup, request = requestPinned, maxRedirects = 5 } = {}) {
  return async (value, options = {}) => {
    let target = String(value);
    for (let redirects = 0; ; redirects++) {
      options.signal?.throwIfAborted();
      const { url, address } = await resolvePublicUrl(target, lookup);
      const response = await request(url, address, options);
      if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.get('location') || options.redirect === 'manual') return response;
      await response.body?.cancel();
      if (options.redirect === 'error') throw Error('redirect_forbidden');
      if (redirects >= maxRedirects) throw Error('too_many_redirects');
      target = new URL(response.headers.get('location'), url).href;
    }
  };
}

export function createRobotsLoader(fetchImpl, { timeoutMs = 8000 } = {}) {
  const cache = new Map();
  return async origin => {
    if (!cache.has(origin)) cache.set(origin, (async () => {
      try {
        const response = await fetchImpl(`${origin}/robots.txt`, { headers: { 'user-agent': 'competition-crawler/1.0' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
        if (!response.ok || /html/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); return ''; }
        const chunks = []; let size = 0; const reader = response.body?.getReader();
        if (!reader) return '';
        try {
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.length; if (size > 256 * 1024) { await reader.cancel(); throw Error('robots_too_large'); }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
        return Buffer.concat(chunks).toString('utf8');
      } catch (error) {
        // Never bypass a forbidden redirect or robots redirect loop by treating it as an empty policy.
        if (['private_url_forbidden', 'invalid_public_url', 'too_many_redirects', 'redirect_forbidden', 'robots_too_large'].includes(error.message)) throw error;
        return ''; // Existing crawler policy: unavailable robots.txt permits access.
      }
    })());
    return cache.get(origin);
  };
}

async function main() {
  const [{ Fetcher }, extract] = await Promise.all([import('./lib/fetcher.mjs'), import('./lib/extract.mjs')]);
  let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 8192) throw Error('request_too_large'); }
  const { url } = JSON.parse(input);
  const { url: targetUrl } = await resolvePublicUrl(url); const target = targetUrl.href;
  const safeFetch = createPublicFetch(); globalThis.fetch = safeFetch;
  const fetcher = new Fetcher({ timeoutMs: 20000, robotsTimeoutMs: 8000, perHostDelayMs: 1500 });
  fetcher.loadRobots = createRobotsLoader(safeFetch);
  fetcher.get = fetcher.getDirect.bind(fetcher); // No cloud relay in the restricted reader.
  const page = await fetcher.get(target);
  if (page.status === 'blocked_by_robots') { console.log(JSON.stringify({ status: 'blocked', url: target, text: '', links: [], via: 'beijing' })); return; }
  if (page.status !== 'ok') { console.log(JSON.stringify({ status: page.status, url: target, text: '', links: [], via: 'beijing', error: page.error || '' })); return; }
  let text = '', links = [], format = 'html';
  if (page.body?.subarray(0, 4).toString('latin1').startsWith('%PDF')) { format = 'pdf'; text = (await extract.extractPdfText(page.body, { maxChars: 12000 })).text || ''; }
  else if (page.body?.subarray(0, 2).toString('latin1') === 'PK') { format = 'docx'; text = extract.extractDocxText(page.body, { maxChars: 12000 }).text || ''; }
  else { text = extract.extractText(page.text, { maxChars: 12000 }); links = extract.findNoticeLinks(page.text, page.finalUrl || target, { limit: 10 }).map(item => ({ text: item.text, url: item.url })); }
  console.log(JSON.stringify({ status: text.length >= 200 ? 'ok' : 'too_short', url: target, finalUrl: page.finalUrl || target, text, links, format, via: 'beijing' }));
}
if (process.argv[1]?.endsWith('beijing-reader-stdio.mjs')) main().catch(error => { console.log(JSON.stringify({ status: 'error', text: '', links: [], via: 'beijing', error: String(error.message).slice(0, 120) })); process.exitCode = 1; });
