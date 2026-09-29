// Kimi Code 接口：试出能用的参数后记住，后面一次成功，不再每次先 400 两次（2026-09-29）
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { completeWithLearnedOptions, resetLearnedRequestOptions } = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');

// 模拟 Kimi Code：带 temperature 或 JSON 结构约束就 400
function fakeKimi() {
  const calls = [];
  const send = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if ('temperature' in body) return new Response(JSON.stringify({ error:{ message:'invalid temperature: only 1 is allowed' } }), { status:400 });
    if (body.response_format?.type === 'json_schema') return new Response(JSON.stringify({ error:{ message:'response_format json_schema not supported' } }), { status:400 });
    return new Response(JSON.stringify({ choices:[{ message:{ content:'{}' } }] }), { status:200 });
  };
  return { send, calls };
}

describe('Kimi 请求参数记忆', () => {
  const config = { baseUrl:'https://api.kimi.com/coding/v1', model:'kimi-for-coding', apiKey:'k' };
  const messages = [{ role:'user', content:'x' }];
  it('第一次试出来，第二次直接成功', async () => {
    resetLearnedRequestOptions();
    const kimi = fakeKimi();
    const first = await completeWithLearnedOptions(kimi.send, config, messages, { useJsonSchema:true, includeTemperature:true, schema:{ type:'object' } });
    expect(first.ok).toBe(true);
    expect(kimi.calls).toHaveLength(3);
    const second = await completeWithLearnedOptions(kimi.send, config, messages, { useJsonSchema:true, includeTemperature:true, schema:{ type:'object' } });
    expect(second.ok).toBe(true);
    expect(kimi.calls).toHaveLength(4);
  });
});
