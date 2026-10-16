import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  aiReviewConfigStatus,
  collectEvidence,
  compactRecord,
  fetchEvidenceUrl,
  htmlToText,
  parseModelJson,
  resolveRequest,
  adjustRequestOptions,
  buildRequestBody,
  callChatCompletion,
  validateResult,
} = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');
const { buildResponse, isRedirect, nodeFetch } = require('../apps/miniprogram/cloudfunctions/adminData/httpClient.js');

describe('competition AI review', () => {
  it('does not attach the legacy model timeout when self-hosted review requests zero', async () => {
    let sentOptions;
    await callChatCompletion(async (_url, options) => {
      sentOptions = options;
      return {ok:true,status:200,text:async () => '{}'};
    }, {baseUrl:'https://example.com', apiKey:'test', model:'test'}, [], {chatTimeoutMs:0,useJsonSchema:false,includeTemperature:false});
    expect(sentOptions.signal).toBeUndefined();
    expect(sentOptions.timeoutMs).toBeUndefined();
  });
  it('strips scripts and tags from evidence pages', () => {
    expect(htmlToText('<style>x</style><h1>报名通知</h1><script>bad()</script>')).toBe('报名通知');
  });

  it('keeps source provenance in the review input', () => {
    const input = compactRecord({ id:'e1', sources:[{ url:'https://example.com', is_official:true, validity_status:'unchecked' }] });
    expect(input.sources[0]).toEqual(expect.objectContaining({ claimed_official:true, current_validity:'unchecked' }));
  });

  it('never accepts a model claim that it published a record', () => {
    expect(() => validateResult({ decision:'published', risk_level:'low', summary:'模型已经发布赛事', issues:[], evidence_refs:[] })).toThrow('ai_review_invalid_decision');
  });

  it('explains missing review arrays without treating them as bad source links', () => {
    expect(() => validateResult({ decision:'needs_changes', risk_level:'medium', summary:'赛事资料需要更正', issues:[], evidence_refs:null }))
      .toThrow('issues和evidence_refs必须是数组');
  });

  it('loads multiple evidence sources concurrently', async () => {
    const started = [];
    const resolvers = [];
    const request = url => {
      started.push(url);
      // robots.txt 立即以 404 响应；延迟机制只用于正文，便于观察正文是否并行。
      if (url.endsWith('/robots.txt')) {
        return Promise.resolve({ ok:false, status:404, headers:{ get:() => '' }, text:async () => '' });
      }
      return new Promise(resolve => {
        resolvers.push(() => resolve({ ok:true, headers:{ get:() => 'text/html' }, text:async () => '<p>official</p>' }));
      });
    };
    const pending = collectEvidence({ sources:[{ url:'https://a.example' }, { url:'https://b.example' }] }, request);
    await new Promise(resolve => setImmediate(resolve));
    // 先并行查两个域名的 robots.txt，再并行抓正文。
    expect(started.slice(0, 2)).toEqual(['https://a.example/robots.txt', 'https://b.example/robots.txt']);
    expect(started.slice(2)).toEqual(['https://a.example', 'https://b.example']);
    resolvers.forEach(resolve => resolve());
    await expect(pending).resolves.toHaveLength(2);
  });

  it('reads official sources first and up to five, so an official notice listed last is not skipped', async () => {
    const read = [];
    const request = url => {
      if (url.endsWith('/robots.txt')) return Promise.resolve({ ok:false, status:404, headers:{ get:() => '' }, text:async () => '' });
      read.push(url);
      return Promise.resolve({ ok:true, headers:{ get:() => 'text/html' }, text:async () => '<p>x</p>' });
    };
    const school = n => ({ url:`https://school${n}.example/`, is_official:false, validity_status:'valid' });
    await collectEvidence({ sources:[school(1), school(2), school(3), school(4), school(5), { url:'https://gov.example/', is_official:true, validity_status:'valid' }] }, request);
    expect(read).toHaveLength(5);
    expect(read[0]).toBe('https://gov.example/');
  });

  it('prefers an injected request client over the runtime default', () => {
    const injected = () => {};
    expect(resolveRequest(injected)).toBe(injected);
  });

  it('always resolves to a usable client even without a global fetch', () => {
    const originalFetch = globalThis.fetch;
    try {
      delete globalThis.fetch;
      expect(resolveRequest(null)).toBe(nodeFetch);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('builds a fetch-shaped response from the https fallback', async () => {
    const response = buildResponse(200, { 'content-type':'text/html' }, Buffer.from('<p>ok</p>'));
    expect(response.ok).toBe(true);
    expect(response.headers.get('Content-Type')).toBe('text/html');
    expect(await response.text()).toBe('<p>ok</p>');
    expect(buildResponse(404, {}, Buffer.from('')).ok).toBe(false);
  });

  it('follows only real redirect statuses', () => {
    expect(isRedirect(301)).toBe(true);
    expect(isRedirect(308)).toBe(true);
    expect(isRedirect(200)).toBe(false);
  });

  it('reports missing AI key without leaking the key itself', () => {
    const status = aiReviewConfigStatus({ ADMIN_TOKEN:'set' }, () => {});
    expect(status.apiKeyConfigured).toBe(false);
    expect(status.configuredEnvKeys).toEqual([]);
    expect(JSON.stringify(status)).not.toContain('set');
  });

  it('flags a key pasted with quotes or whitespace', () => {
    const status = aiReviewConfigStatus({ AI_API_KEY:' "sk-secret" ', AI_MODEL:'kimi-for-coding' }, () => {});
    expect(status.apiKeyConfigured).toBe(true);
    expect(status.apiKeyHasSurroundingWhitespace).toBe(true);
    expect(status.apiKeyLooksQuoted).toBe(true);
    expect(status.configuredEnvKeys).toEqual(['AI_API_KEY', 'AI_MODEL']);
    expect(JSON.stringify(status)).not.toContain('sk-secret');
  });

  it('parses model output wrapped in a markdown fence', () => {
    expect(parseModelJson('```json\n{"decision":"needs_changes"}\n```')).toEqual({ decision:'needs_changes' });
  });

  const defaultOptions = { useJsonSchema:true, includeTemperature:true };

  it('drops temperature when the model rejects the value', () => {
    const next = adjustRequestOptions(400, 'invalid temperature: only 1 is allowed for this model', defaultOptions);
    expect(next).toEqual({ useJsonSchema:true, includeTemperature:false });
    expect(buildRequestBody({ model:'m' }, [], next)).not.toHaveProperty('temperature');
  });

  it('drops json_schema when the model rejects the response format', () => {
    const next = adjustRequestOptions(400, '{"error":{"message":"response_format is not supported"}}', defaultOptions);
    expect(next).toEqual({ useJsonSchema:false, includeTemperature:true });
    expect(buildRequestBody({ model:'m' }, [], next).response_format).toEqual({ type:'json_object' });
  });

  it('never downgrades on auth or rate-limit errors', () => {
    expect(adjustRequestOptions(401, 'The API Key appears to be invalid', defaultOptions)).toBeNull();
    expect(adjustRequestOptions(429, 'rate limited', defaultOptions)).toBeNull();
  });

  it('stops downgrading once an option is already removed', () => {
    const stripped = { useJsonSchema:true, includeTemperature:false };
    expect(adjustRequestOptions(400, 'invalid temperature', stripped)).toBeNull();
  });
});

describe('image evidence', () => {
  const imageResponse = bytes => ({
    ok: true,
    status: 200,
    headers: { get: name => (name.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
    arrayBuffer: async () => Buffer.alloc(bytes, 7).buffer,
    text: async () => '',
  });

  const request = url => (url.endsWith('/robots.txt')
    ? Promise.resolve({ ok: false, status: 404, headers: { get: () => '' }, text: async () => '' })
    : Promise.resolve(imageResponse(10)));

  it('inlines images as base64 because the provider rejects remote image urls', async () => {
    const [evidence] = await collectEvidence({ sources: [{ url: 'https://a.example/poster.jpg' }] }, request);
    expect(evidence.status).toBe('image');
    expect(evidence.imageUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(evidence.imageUrl).not.toBe('https://a.example/poster.jpg');
  });

  it('skips images too large to inline', async () => {
    const big = url => (url.endsWith('/robots.txt')
      ? Promise.resolve({ ok: false, status: 404, headers: { get: () => '' }, text: async () => '' })
      : Promise.resolve(imageResponse(2_000_000)));
    const [evidence] = await collectEvidence({ sources: [{ url: 'https://a.example/huge.jpg' }] }, big);
    expect(evidence.status).toBe('image_too_large');
    expect(evidence.imageUrl).toBeUndefined();
  });
});

describe('tianchi links get their real content through the race API, not a plain page fetch', () => {
  // 实测 2026-09-19：三项核验遇到天池链接系统性失败——天池详情页前后端分离，
  // 直接抓页面只拿到导航栏/页脚这层空壳。scripts/server/run-extract.mjs 的
  // 批量抽取早就用这个接口绕过去了，这里补上同一条路径。
  const url = 'https://tianchi.aliyun.com/competition/entrance/532514';

  it('calls the race detail API instead of fetching the page directly', async () => {
    let calledUrl = '';
    const request = async requestedUrl => {
      calledUrl = requestedUrl;
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { race: { name: '某某挑战赛', introduction: '这是赛事简介', reward: '一等奖 5 万元' } } }),
      };
    };
    const evidence = await fetchEvidenceUrl(request, url, new Map());
    expect(calledUrl).toContain('v3/proxy/competition/api/race/getDetail?raceId=532514');
    expect(evidence.status).toBe('reachable');
    expect(evidence.text).toContain('这是赛事简介');
    expect(evidence.text).toContain('一等奖 5 万元');
  });

  it('never falls back to fetching the empty page shell for a tianchi url', async () => {
    // 回归测试：不能因为 API 调用失败就偷偷退回普通页面抓取——那正是
    // 之前"核验全部失败"的根源，退回去等于把坑挖回来。
    let pageWasFetched = false;
    const request = async requestedUrl => {
      if (!requestedUrl.includes('v3/proxy/competition')) { pageWasFetched = true; return { ok: true, headers: { get: () => 'text/html' }, text: async () => '<html>导航 页脚</html>' }; }
      return { ok: false, headers: { get: () => '' } };
    };
    const evidence = await fetchEvidenceUrl(request, url, new Map());
    expect(pageWasFetched).toBe(false);
    expect(evidence.status).toBe('tianchi_empty');
  });

  it('does not check robots.txt for the race API call, matching the existing bulk-extraction path', async () => {
    let robotsChecked = false;
    const request = async requestedUrl => {
      if (requestedUrl.endsWith('/robots.txt')) { robotsChecked = true; return { ok: false, status: 404, headers: { get: () => '' }, text: async () => '' }; }
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: { race: { name: 'x' } } }) };
    };
    await fetchEvidenceUrl(request, url, new Map());
    expect(robotsChecked).toBe(false);
  });

  it('leaves non-tianchi urls on the normal fetch-and-check-robots path', async () => {
    let robotsChecked = false;
    const request = async requestedUrl => {
      if (requestedUrl.endsWith('/robots.txt')) { robotsChecked = true; return { ok: false, status: 404, headers: { get: () => '' }, text: async () => '' }; }
      return { ok: true, headers: { get: () => 'text/html' }, text: async () => '<p>official</p>' };
    };
    const evidence = await fetchEvidenceUrl(request, 'https://example.com/notice', new Map());
    expect(robotsChecked).toBe(true);
    expect(evidence.status).toBe('reachable');
  });
});
