import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runCompetitionAiReviewAgentic } = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');

const TOOLS_DECLARATION = {
  tools: [{ type:'function', function:{ name:'fetch', description:'Fetch a URL', parameters:{ type:'object', properties:{ url:{ type:'string' } }, required:['url'] } } }],
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

// 记录只用于路由 mock 响应，不携带真实 sources——collectEvidence 会拿到空数组，
// 省得还要连带 mock robots.txt 那一层，测试焦点在工具调用循环本身。
const record = { id:'e1', name:'某某挑战赛', sources:[] };

describe('letting the model decide to fetch another link (Formula API tool calls)', () => {
  it('refuses to run without a Moonshot tools key — this is a different account from the review/extract provider', async () => {
    await expect(runCompetitionAiReviewAgentic(record, () => {}, { apiKey:'' }))
      .rejects.toThrow('moonshot_tools_api_key_not_configured');
  });

  it('answers directly when the model never asks to fetch anything', async () => {
    let chatCalls = 0;
    const request = async url => {
      if (url.includes('/formulas/') && url.includes('/tools')) return jsonResponse(200, TOOLS_DECLARATION);
      if (url.endsWith('/chat/completions')) {
        chatCalls += 1;
        return jsonResponse(200, { choices:[{ message:{ role:'assistant', content:JSON.stringify({ decision:'recommend_approve', risk_level:'low', summary:'资料齐全，符合要求', issues:[], evidence_refs:[] }) } }] });
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const result = await runCompetitionAiReviewAgentic(record, request, { apiKey:'sk-test' });
    expect(chatCalls).toBe(1);
    expect(result.decision).toBe('recommend_approve');
    expect(result.provider).toBe('moonshot-agentic');
    expect(result.tool_calls).toEqual([]);
  });

  it('executes a fetch the model asks for, feeds the result back, and reaches a final answer', async () => {
    let chatCalls = 0;
    let fiberCalls = 0;
    const request = async (url, options) => {
      if (url.includes('/formulas/') && url.endsWith('/tools')) return jsonResponse(200, TOOLS_DECLARATION);
      if (url.includes('/formulas/') && url.endsWith('/fibers')) {
        fiberCalls += 1;
        const body = JSON.parse(options.body);
        expect(body.name).toBe('fetch');
        return jsonResponse(200, { status:'succeeded', context:{ output:'# 官方通知\n报名截止 2026-10-01' } });
      }
      if (url.endsWith('/chat/completions')) {
        chatCalls += 1;
        if (chatCalls === 1) {
          // 第一轮：模型觉得资料不够，要求调用 fetch 工具
          return jsonResponse(200, { choices:[{ message:{ role:'assistant', content:null, tool_calls:[{ id:'call_1', type:'function', function:{ name:'fetch', arguments:'{"url":"https://example.com/notice"}' } }] } }] });
        }
        // 第二轮：拿到工具结果后给出最终结论
        return jsonResponse(200, { choices:[{ message:{ role:'assistant', content:JSON.stringify({ decision:'needs_changes', risk_level:'medium', summary:'补充了报名截止日期', issues:[], evidence_refs:['https://example.com/notice'] }) } }] });
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const result = await runCompetitionAiReviewAgentic(record, request, { apiKey:'sk-test' });
    expect(fiberCalls).toBe(1);
    expect(chatCalls).toBe(2);
    expect(result.decision).toBe('needs_changes');
    expect(result.tool_calls).toEqual([{ name:'fetch', arguments:'{"url":"https://example.com/notice"}', ok:true }]);
  });

  it('keeps going when a tool call fails — the model sees the failure and can still conclude', async () => {
    let chatCalls = 0;
    const request = async (url, options) => {
      if (url.includes('/formulas/') && url.endsWith('/tools')) return jsonResponse(200, TOOLS_DECLARATION);
      if (url.includes('/formulas/') && url.endsWith('/fibers')) return jsonResponse(200, { status:'failed', context:{} });
      if (url.endsWith('/chat/completions')) {
        chatCalls += 1;
        if (chatCalls === 1) {
          return jsonResponse(200, { choices:[{ message:{ role:'assistant', content:null, tool_calls:[{ id:'call_1', type:'function', function:{ name:'fetch', arguments:'{"url":"https://dead-link.example"}' } }] } }] });
        }
        return jsonResponse(200, { choices:[{ message:{ role:'assistant', content:JSON.stringify({ decision:'insufficient_evidence', risk_level:'medium', summary:'链接打不开，证据不足', issues:[], evidence_refs:[] }) } }] });
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const result = await runCompetitionAiReviewAgentic(record, request, { apiKey:'sk-test' });
    expect(result.decision).toBe('insufficient_evidence');
    expect(result.tool_calls[0]).toMatchObject({ ok:false });
    expect(result.tool_calls[0].error).toContain('moonshot_fiber_failed');
  });

  it('stops offering the tool after the turn cap and forces a final answer instead of looping forever', async () => {
    let chatCalls = 0;
    const request = async (url, options) => {
      if (url.includes('/formulas/') && url.endsWith('/tools')) return jsonResponse(200, TOOLS_DECLARATION);
      if (url.includes('/formulas/') && url.endsWith('/fibers')) return jsonResponse(200, { status:'succeeded', context:{ output:'没什么新信息' } });
      if (url.endsWith('/chat/completions')) {
        chatCalls += 1;
        const body = JSON.parse(options.body);
        if (body.tools) {
          // 只要还给了 tools，模型就死缠着要调用——测试轮数上限能不能真的掐断它
          return jsonResponse(200, { choices:[{ message:{ role:'assistant', content:null, tool_calls:[{ id:`call_${chatCalls}`, type:'function', function:{ name:'fetch', arguments:'{"url":"https://x.example"}' } }] } }] });
        }
        // 最后一轮没有 tools 字段，只能乖乖回答
        return jsonResponse(200, { choices:[{ message:{ role:'assistant', content:JSON.stringify({ decision:'insufficient_evidence', risk_level:'medium', summary:'调用次数用完，信息仍不够', issues:[], evidence_refs:[] }) } }] });
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const result = await runCompetitionAiReviewAgentic(record, request, { apiKey:'sk-test', maxToolTurns:2 });
    // 2 轮允许工具 + 1 轮强制收尾 = 3 次 chat.completions；工具本身只调用了 2 次，不是无限循环。
    expect(chatCalls).toBe(3);
    expect(result.tool_calls).toHaveLength(2);
    expect(result.decision).toBe('insufficient_evidence');
  });
});
