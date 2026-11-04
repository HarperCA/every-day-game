// Kimi：对话、搜索、读网页的请求怎么组装、结果怎么整理。用假的 fetch，不连真实接口。
import { describe, expect, test } from 'vitest';
import { createKimi } from '../../index.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
function recorder(responses) {
  const sent = [];
  return { sent, fetchImpl: async (url, init) => { sent.push({ url, body: JSON.parse(init.body), headers: init.headers }); return responses.shift(); } };
}

describe('Kimi 对话', () => {
  test('不带 temperature；要 JSON 时只用 json_object（会员通道不认 JSON 结构约束）', async () => {
    const r = recorder([reply({ choices: [{ message: { role: 'assistant', content: '{}' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } })]);
    const out = await createKimi({ fetchImpl: r.fetchImpl }).chat({ model: 'kimi-for-coding', messages: [{ role: 'user', content: 'hi' }], json: true, key: 'k' });
    expect(r.sent[0].url).toBe('https://api.kimi.com/coding/v1/chat/completions');
    expect(r.sent[0].body).toEqual({ model: 'kimi-for-coding', messages: [{ role: 'user', content: 'hi' }], response_format: { type: 'json_object' } });
    expect(r.sent[0].headers.Authorization).toBe('Bearer k');
    expect(out).toMatchObject({ tokensIn: 3, tokensOut: 1 });
  });
});

describe('Kimi 搜索', () => {
  test('结果超过上限自己截断', async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ title: `t${i}`, url: `https://a.cn/${i}` }));
    const r = recorder([reply({ search_results: many })]);
    const out = await createKimi({ fetchImpl: r.fetchImpl }).search({ query: '数学建模', key: 'k' });
    expect(r.sent[0].body).toMatchObject({ text_query: '数学建模', limit: 10, enable_page_crawling: false });
    expect(r.sent[0].headers['X-Msh-Tool-Call-Id']).toBeTruthy();
    expect(out.references).toHaveLength(10);
  });
  test('5xx 等一会儿重试一次；带 site: 的搜索重试后仍 500 按没有结果交回', async () => {
    const r = recorder([reply({}, 500), reply({}, 500)]);
    const out = await createKimi({ fetchImpl: r.fetchImpl, retryDelayMs: 0 }).search({ query: '报名 site:mcm.edu.cn', key: 'k' });
    expect(r.sent).toHaveLength(2);
    expect(out.references).toEqual([]);
  });
  test('不带 site: 的 500 照样算出错', async () => {
    const r = recorder([reply({}, 500), reply({}, 500)]);
    await expect(createKimi({ fetchImpl: r.fetchImpl, retryDelayMs: 0 }).search({ query: '报名', key: 'k' })).rejects.toMatchObject({ kind: '对方出错' });
  });
});

describe('Kimi 读网页', () => {
  test('正文去掉图片，图片地址单独交回', async () => {
    const r = recorder([reply({ markdown: '# 通知\n![图](https://img.kimi/1.png)\n\n\n\n报名截止 9 月 1 日' })]);
    const out = await createKimi({ fetchImpl: r.fetchImpl }).fetchPage({ url: 'https://a.cn', key: 'k' });
    expect(r.sent[0]).toMatchObject({ url: 'https://api.kimi.com/coding/v1/fetch', body: { url: 'https://a.cn' } });
    expect(out).toEqual({ markdown: '# 通知\n\n报名截止 9 月 1 日', images: ['https://img.kimi/1.png'] });
  });
});
