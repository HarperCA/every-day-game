// 统一抓取层。运行在服务器（Node 20），不是云函数——没有 60 秒上限。
//
// 这里集中解决之前在云函数侧踩过的坑：
//   - robots.txt 合规（策略见 docs/admin-cloudbase.md「来源抓取策略」）
//   - 中文站点大量使用 GB2312/GBK，写死 UTF-8 会整页乱码
//   - PDF 不能按 HTML 解码，否则二进制乱码会被当成正文
//   - 总时长超时，而不是 socket 空闲超时
//   - 同域限速，避免给主办方站点造成压力
import fs from 'node:fs/promises';
import path from 'node:path';
import iconv from 'iconv-lite';
import { isAllowed } from './robots.mjs';
import { normalizeCrawlUrl, readLimitedBody } from './urlPolicy.mjs';

export const USER_AGENT = 'competition-crawler/1.0 (+admin source verification; respects robots.txt)';

const DEFAULT_OPTIONS = {
  timeoutMs: 20000,
  robotsTimeoutMs: 8000,
  perHostDelayMs: 1500,
  maxRedirects: 5,
  maxBytes: 8 * 1024 * 1024,
  cacheDir: null,
  cacheTtlMs: 12 * 60 * 60 * 1000,
  acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.7',
  allowedMime: /^(text\/html|application\/xhtml\+xml|application\/json|text\/plain|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)(;|$)/i,
};

const BINARY_TYPES = /^(application\/pdf|application\/msword|application\/vnd|image\/|video\/|audio\/|application\/zip|application\/octet-stream)/i;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// content-type 优先，其次嗅探 HTML 里的 meta charset。
export function detectCharset(contentType, body) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(String(contentType || ''));
  if (fromHeader) return fromHeader[1].toLowerCase();
  const head = body.subarray(0, 2048).toString('latin1');
  const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)
    || /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head);
  return meta ? meta[1].toLowerCase() : 'utf-8';
}

export function decodeBody(body, charset) {
  const normalized = String(charset || 'utf-8').toLowerCase().replace(/^x-/, '');
  const alias = normalized === 'gb2312' || normalized === 'gb_2312' ? 'gbk' : normalized;
  if (iconv.encodingExists(alias)) return iconv.decode(body, alias);
  return body.toString('utf8');
}

function cachePath(cacheDir, url) {
  // 用可读前缀 + 哈希，便于人工翻查缓存目录
  const host = (() => { try { return new URL(url).hostname; } catch { return 'invalid'; } })();
  let hash = 0;
  for (let i = 0; i < url.length; i += 1) hash = (hash * 31 + url.charCodeAt(i)) >>> 0;
  return path.join(cacheDir, host, `${hash.toString(36)}.json`);
}

export class Fetcher {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.robotsCache = new Map();
    this.lastHitAt = new Map();
    this.stats = { requests: 0, cacheHits: 0, blocked: 0, errors: 0 };
  }

  async throttle(host) {
    const last = this.lastHitAt.get(host) || 0;
    const reserved = Math.max(Date.now(), last + this.options.perHostDelayMs);
    this.lastHitAt.set(host, reserved);
    const wait = reserved - Date.now();
    if (wait > 0) await sleep(wait);
  }

  async loadRobots(origin) {
    if (this.robotsCache.has(origin)) return this.robotsCache.get(origin);
    const pending = (async () => {
      try {
        const response = await fetch(`${origin}/robots.txt`, {
          headers: { 'user-agent': USER_AGENT },
          signal: AbortSignal.timeout(this.options.robotsTimeoutMs),
          redirect: 'follow',
        });
        if (!response.ok) return '';
        const type = response.headers.get('content-type') || '';
        if (/html/i.test(type)) return ''; // 站点用首页兜底 404，不是真的 robots.txt
        return await response.text();
      } catch {
        return ''; // 取不到按通行惯例视为允许
      }
    })();
    this.robotsCache.set(origin, pending);
    return pending;
  }

  async readCache(url) {
    if (!this.options.cacheDir) return null;
    try {
      const raw = await fs.readFile(cachePath(this.options.cacheDir, url), 'utf8');
      const entry = JSON.parse(raw);
      if (Date.now() - entry.fetchedAt > this.options.cacheTtlMs) return null;
      return { ...entry, fromCache: true };
    } catch {
      return null;
    }
  }

  async writeCache(url, entry) {
    if (!this.options.cacheDir) return;
    const target = cachePath(this.options.cacheDir, url);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(entry), 'utf8');
  }

  // 统一返回结构，任何失败都以 status 字段表达，不抛异常。
  async get(url, { useCache = true, redirectCount = 0 } = {}) {
    let target;
    try {
      url = normalizeCrawlUrl(url);
      target = new URL(url);
    } catch {
      return { url, status: 'invalid_url', text: '', body: null };
    }
    if (!/^https?:$/.test(target.protocol)) return { url, status: 'unsupported_protocol', text: '', body: null };

    if (useCache) {
      const cached = await this.readCache(url);
      if (cached) {
        this.stats.cacheHits += 1;
        return { ...cached, body: cached.bodyBase64 ? Buffer.from(cached.bodyBase64, 'base64') : null };
      }
    }

    const robots = await this.loadRobots(target.origin);
    if (robots && !isAllowed(robots, USER_AGENT, target.pathname + target.search)) {
      this.stats.blocked += 1;
      return { url, status: 'blocked_by_robots', text: '', body: null };
    }

    await this.throttle(target.host);
    this.stats.requests += 1;
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/json,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'accept-language': this.options.acceptLanguage },
        signal: AbortSignal.timeout(this.options.timeoutMs),
        redirect: 'manual',
      });
      if ([301,302,303,307,308].includes(response.status) && response.headers.get('location')) {
        await response.body?.cancel();
        if (redirectCount >= this.options.maxRedirects) return { url, status:'too_many_redirects', text:'', body:null };
        const result = await this.get(new URL(response.headers.get('location'), url).href, {useCache, redirectCount:redirectCount + 1});
        return {...result, url, finalUrl:result.finalUrl || result.url};
      }
      const contentType = response.headers.get('content-type') || '';
      if (!this.options.allowedMime.test(contentType)) {
        await response.body?.cancel();
        return {url, status:'unsupported_type', contentType, text:'', body:null};
      }
      const buffer = await readLimitedBody(response, this.options.maxBytes);
      if (buffer.length > this.options.maxBytes) {
        return { url, status: 'too_large', httpStatus: response.status, contentType, text: '', body: null };
      }
      const isBinary = BINARY_TYPES.test(contentType);
      const charset = isBinary ? null : detectCharset(contentType, buffer);
      const entry = {
        url,
        finalUrl: response.url || url,
        status: response.ok ? 'ok' : `http_${response.status}`,
        httpStatus: response.status,
        contentType,
        charset,
        isBinary,
        bytes: buffer.length,
        text: isBinary ? '' : decodeBody(buffer, charset),
        fetchedAt: Date.now(),
      };
      if (useCache) await this.writeCache(url, { ...entry, bodyBase64: isBinary ? buffer.toString('base64') : undefined });
      return { ...entry, body: buffer };
    } catch (error) {
      this.stats.errors += 1;
      const name = error?.message === 'too_large' ? 'too_large' : error?.name === 'TimeoutError' ? 'timeout' : 'network_error';
      return { url, status: name, text: '', body: null, error: String(error?.message || error).slice(0, 200) };
    }
  }
}
