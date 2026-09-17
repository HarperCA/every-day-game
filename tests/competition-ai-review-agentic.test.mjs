import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runCompetitionAiReviewAgentic } = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
    headers: { get: () => '' },
  };
}

// 记录只用于路由 mock 响应，不携带真实 sources——collectEvidence 会拿到空数组，
// 省得还要连带 mock robots.txt 那一层；工具调用触发的抓取单独测。
const record = { id:'e1', name:'某某挑战赛', sources:[] };

// 复用已经配置好的 readAiConfig()（AI_API_KEY/AI_BASE_URL），不是另开一个
// 账号体系——这正是这次改动要验证的事：tool_calls 是模型通用能力，不需要
// 额外的 Moonshot 开发者平台密钥。
describe('letting the model decide to fetch another link (self-implemented tool, existing key)', () => {
  const originalKey = process.env.AI_API_KEY;
  const originalBaseUrl = process.env.AI_BASE_URL;
  beforeEach(() => { process.env.AI_API_KEY = 'test-key'; process.env.AI_BASE_URL = 'https://api.example.com/v1'; });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = originalKey;
    if (originalBaseUrl === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = originalBaseUrl;
  });

  it('refuses to run without the same AI_API_KEY the rest of the review flow uses', async () => {
    delete process.env.AI_API_KEY;
    await expect(runCompetitionAiReviewAgentic(record, () => {})).rejects.toThrow('ai_api_key_not_configured');
  });

  it('answers directly when the model never asks to fetch anything', async () => {
    let chatCalls = 0;
    const request = async url => {
      if (url.endsWith('/chat/completions')) {
        chatCalls += 1;
        return jsonResponse(200, { choices:[{ message:{ role:'assistant', content:JSON.stringify({ decision:'recommend_approve', risk_level:'low', summary:'资料齐全，符合要求', issues:[], evidence_refs:[] }) } }] });
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const result = await runCompetitionAiReviewAgentic(record, request);
    expect(chatCalls).toBe(1);
    expect(result.decision).toBe('recommend_approve');
    expect(result.tool_calls).toEqual([]);
  });

  it('fetches a url the model asks for — through our own robots.txt-checked fetcher, not a third party', async () => {
    let chatCalls = 0;
    const fetchedUrls = [];
    const request = async (url, options) => {
      if (url.endsWith('/robots.txt')) return jsonResponse(404, {});
      if (url === 'https://example.com/notice') {
        fetchedUrls.push(url);
        return { ok:true, headers:{ get:() => 'text/html' }, text:async () => '<p>报名截止 2026-10-01</p>' };
      }
      if (url.endsWith('/chat/completions')) {
        chatCalls += 1;
        if (chatCalls === 1) {
          return jsonResponse(200, { choices:[{ message:{ role:'assistant', content:null, tool_calls:[{ id:'call_1', type:'function', function:{ name:'fetch_url', arguments:'{"url":"https://example.com/notice"}' } }] } }] });
        }
        return jsonResponse(200, { choices:[{ message:{ role:'assistant', content:JSON.stringify({ decision:'needs_changes', risk_level:'medium', summary:'补充了报名截止日期', issues:[], evidence_refs:['https://example.com/notice'] }) } }] });
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const result = await runCompetitionAiReviewAgentic(record, request);
    expect(fetchedUrls).toEqual(['https://example.com/notice']);
    expect(chatCalls).toBe(2);
    expect(result.decision).toBe('needs_changes');
    expect(result.tool_calls).toEqual([{ name:'fetch_url', arguments:'{"url":"https://example.com/notice"}', url:'https://example.com/notice', status:'reachable', ok:true }]);
  });

  it('still checks robots.txt for a link the model itself asked for — that permission does not get waived', async () => {
    let chatCalls = 0;
    const request = async url => {
      if (url === 'https://blocked.example/robots.txt') return { ok:true, headers:{ get:() => '' }, text:async () => 'User-agent: *\nDisallow: /' };
      if (url.endsWith('/chat/completions')) {
        chatCalls += 1;
        if (chatCalls === 1) {
          return jsonResponse(200, { choices:[{ message:{ role:'assistant', content:null, tool_calls:[{ id:'call_1', type:'function', function:{ name:'fetch_url', arguments:'{"url":"https://blocked.example/page"}' } }] } }] });
        }
        return jsonResponse(200, { choices:[{ message:{ role:'assistant', content:JSON.stringify({ decision:'insufficient_evidence', risk_level:'medium', summary:'来源禁止抓取，证据不足', issues:[], evidence_refs:[] }) } }] });
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const result = await runCompetitionAiReviewAgentic(record, request);
    expect(result.tool_calls[0]).toMatchObject({ status:'blocked_by_robots', ok:false });
    expect(result.decision).toBe('insufficient_evidence');
  });

  it('stops offering the tool after the turn cap and forces a final answer instead of looping forever', async () => {
    let chatCalls = 0;
    const request = async (url, options) => {
      if (url.endsWith('/robots.txt')) return jsonResponse(404, {});
      if (url === 'https://x.example') return { ok:true, headers:{ get:() => 'text/html' }, text:async () => '没什么新信息' };
      if (url.endsWith('/chat/completions')) {
        chatCalls += 1;
        const body = JSON.parse(options.body);
        if (body.tools) {
          // 只要还给了 tools，模型就死缠着要调用——测试轮数上限能不能真的掐断它
          return jsonResponse(200, { choices:[{ message:{ role:'assistant', content:null, tool_calls:[{ id:`call_${chatCalls}`, type:'function', function:{ name:'fetch_url', arguments:'{"url":"https://x.example"}' } }] } }] });
        }
        // 最后一轮没有 tools 字段，只能乖乖回答
        return jsonResponse(200, { choices:[{ message:{ role:'assistant', content:JSON.stringify({ decision:'insufficient_evidence', risk_level:'medium', summary:'调用次数用完，信息仍不够', issues:[], evidence_refs:[] }) } }] });
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const result = await runCompetitionAiReviewAgentic(record, request, { maxToolTurns:2 });
    // 2 轮允许工具 + 1 轮强制收尾 = 3 次 chat.completions；工具本身只调用了 2 次，不是无限循环。
    expect(chatCalls).toBe(3);
    expect(result.tool_calls).toHaveLength(2);
    expect(result.decision).toBe('insufficient_evidence');
  });
});
