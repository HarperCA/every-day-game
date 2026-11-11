// DeepSeek 接口：用假的 fetch 检查请求怎么组装、报错怎么归类，不连真实接口。
import { describe, expect, test } from 'vitest';
import { createDeepseek } from '../../index.mjs';

describe('DeepSeek 接口', () => {
  test('请求按 OpenAI 格式组装，关掉思考模式；要 JSON 时带 response_format', async () => {
    let sent;
    const client = createDeepseek({ fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{}' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } })); } });
    const r = await client.chat({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }], json: true, key: 'k' });
    expect(sent.url).toBe('https://api.deepseek.com/chat/completions');
    expect(sent.body).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, response_format: { type: 'json_object' } });
    expect(sent.auth).toBe('Bearer k');
    expect(r).toMatchObject({ tokensIn: 7, tokensOut: 3 });
  });
  test('HTTP 错误归到统一类型', async () => {
    const client = createDeepseek({ fetchImpl: async () => new Response('{"error":{"message":"rate limit"}}', { status: 429 }) });
    await expect(client.chat({ model: 'x', messages: [], key: 'k' })).rejects.toMatchObject({ kind: '请求太多', status: 429 });
  });
});

describe('DeepSeek 搜索', () => {
  test('用 Anthropic 兼容接口的 web_search，只搜一次；交回标题和网址', async () => {
    let sent;
    const client = createDeepseek({ fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body), headers: init.headers };
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '完成' }, { type: 'web_search_tool_result', content: [{ title: '通知', url: 'https://a.cn/n' }, { title: '没网址' }] }], usage: { input_tokens: 5, output_tokens: 2 } })); } });
    const r = await client.search({ query: '数学建模 报名', key: 'k' });
    expect(sent.url).toBe('https://api.deepseek.com/anthropic/v1/messages');
    expect(sent.headers['x-api-key']).toBe('k');
    expect(sent.body.tools[0]).toMatchObject({ type: 'web_search_20250305', max_uses: 1 });
    expect(r).toMatchObject({ references: [{ title: '通知', url: 'https://a.cn/n' }], tokensIn: 5, tokensOut: 2 });
  });
  test('搜索工具自己报错且没有结果：报“对方出错”', async () => {
    const client = createDeepseek({ fetchImpl: async () => new Response(JSON.stringify({ content: [{ type: 'web_search_tool_result', content: { error_code: 'unavailable' } }] })) });
    await expect(client.search({ query: 'x', key: 'k' })).rejects.toMatchObject({ kind: '对方出错' });
  });
});

describe('DeepSeek 对话参数', () => {
  test('带工具时 tool_choice 按调用方给的带上；没给就不带，由接口默认（2026-11-01）', async () => {
    const bodies = [];
    const client = createDeepseek({ fetchImpl: async (url, init) => { bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '好' } }] })); } });
    const tools = [{ type: 'function', function: { name: 'ask_user', parameters: { type: 'object', properties: {} } } }];
    await client.chat({ model: 'deepseek-flash', messages: [], tools, toolChoice: 'none', key: 'k' });
    await client.chat({ model: 'deepseek-flash', messages: [], tools, key: 'k' });
    expect(bodies[0]).toMatchObject({ tools, tool_choice: 'none' });
    expect('tool_choice' in bodies[1]).toBe(false);
  });
  test('开思考、温度、最大长度按用途配置带上；不给就不带', async () => {
    const bodies = [];
    const client = createDeepseek({ fetchImpl: async (url, init) => { bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{}', reasoning_content: '想一想' } }] })); } });
    const r = await client.chat({ model: 'deepseek-flash', messages: [], json: true, thinking: true, temperature: 0.1, maxTokens: 32000, key: 'k' });
    await client.chat({ model: 'deepseek-flash', messages: [], key: 'k' });
    expect(bodies[0]).toMatchObject({ thinking: { type: 'enabled' }, temperature: 0.1, max_tokens: 32000 });
    expect(bodies[1].thinking).toEqual({ type: 'disabled' });
    expect('temperature' in bodies[1] || 'max_tokens' in bodies[1]).toBe(false);
    expect(r.message.reasoning_content).toBe('想一想');
  });
});

describe('DeepSeek 搜索 API（/v1/tools/search，按次计费；2026-11-07 找官网用）', () => {
  test('searchApi 为 tools：POST /v1/tools/search，Bearer 密钥，带 query、count；site 拼成 site: 写在搜索词后面', async () => {
    let sent;
    const client = createDeepseek({ fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
      return new Response(JSON.stringify({ results: [
        { rerank_score: 2.4, title: '关于举办2026年全国大学生数学建模竞赛的通知', url: 'https://www.mcm.edu.cn/a.html', snippet: '短', summary: '长摘要', content: '', site_name: '数模组委会', date: '2026-04-01T00:00:00+00:00', authority: 3 },
        { title: '没网址' }] })); } });
    const r = await client.search({ searchApi: 'tools', count: 20, query: '全国大学生数学建模竞赛', site: 'mcm.edu.cn', key: 'k' });
    expect(sent.url).toBe('https://api.deepseek.com/v1/tools/search');
    expect(sent.auth).toBe('Bearer k');
    expect(sent.body).toEqual({ query: '全国大学生数学建模竞赛 site:mcm.edu.cn', count: 20 });
    expect(r.references).toEqual([{ title: '关于举办2026年全国大学生数学建模竞赛的通知', url: 'https://www.mcm.edu.cn/a.html', content: '长摘要', date: '2026-04-01', authority: 3, rerank: 2.4, website: '数模组委会' }]);
    expect(r).toMatchObject({ tokensIn: null, tokensOut: null });
  });
  test('搜索词超过 128 个字截掉；没结果交回空列表；HTTP 错误照常归类', async () => {
    let sent;
    const client = createDeepseek({ fetchImpl: async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ results: [] })); } });
    expect((await client.search({ searchApi: 'tools', query: '赛'.repeat(200), key: 'k' })).references).toEqual([]);
    expect(sent.query).toHaveLength(128);
    expect(sent.count).toBe(10);
    const 坏 = createDeepseek({ fetchImpl: async () => new Response('{"error":{"message":"Insufficient Balance"}}', { status: 402 }) });
    await expect(坏.search({ searchApi: 'tools', query: 'x', key: 'k' })).rejects.toMatchObject({ status: 402 });
  });
});
