import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  aiReviewConfigStatus,
  collectEvidence,
  compactRecord,
  htmlToText,
  parseModelJson,
  resolveRequest,
  adjustRequestOptions,
  buildRequestBody,
  validateResult,
} = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');
const { buildResponse, isRedirect, nodeFetch } = require('../apps/miniprogram/cloudfunctions/adminData/httpClient.js');

describe('competition AI review', () => {
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

  it('loads multiple evidence sources concurrently', async () => {
    const started = [];
    const resolvers = [];
    const request = url => new Promise(resolve => {
      started.push(url);
      resolvers.push(() => resolve({ ok:true, headers:{ get:() => 'text/html' }, text:async () => '<p>official</p>' }));
    });
    const pending = collectEvidence({ sources:[{ url:'https://a.example' }, { url:'https://b.example' }] }, request);
    await Promise.resolve();
    expect(started).toEqual(['https://a.example', 'https://b.example']);
    resolvers.forEach(resolve => resolve());
    await expect(pending).resolves.toHaveLength(2);
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
