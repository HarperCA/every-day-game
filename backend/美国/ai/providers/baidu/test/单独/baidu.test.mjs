// 百度千帆搜索：请求体（网站、时间范围、屏蔽名单）、结果整理、报错归类。用假的 fetch，不连真实接口。
import { describe, expect, test } from 'vitest';
import { createBaidu, normalizeSite, searchBody } from '../../index.mjs';

describe('百度搜索', () => {
  test('网址只留主机名；不像域名的当作不限网站', () => {
    expect(normalizeSite('https://www.mcm.edu.cn/html_cn/node/x.html')).toBe('www.mcm.edu.cn');
    expect(normalizeSite('MCM.edu.cn:8080')).toBe('mcm.edu.cn');
    expect(normalizeSite('不是网址')).toBe('');
  });
  test('请求体：只在某网站搜、只要近期、屏蔽名单；认不得的时间范围不带', () => {
    expect(searchBody('数学建模', { site: 'https://www.mcm.edu.cn/a', recent: 'month', blocked: ['zhihu.com'] })).toMatchObject({
      messages: [{ content: '数学建模', role: 'user' }], search_source: 'baidu_search_v2', block_websites: ['zhihu.com'],
      search_filter: { match: { site: ['www.mcm.edu.cn'] } }, search_recency_filter: 'month' });
    expect(searchBody('x', { recent: 'decade' }).search_recency_filter).toBeUndefined();
  });
  test('交回整理好的结果；HTTP 错误归到统一类型', async () => {
    let sent;
    const ok = createBaidu({ fetchImpl: async (url, init) => { sent = { url, headers: init.headers };
      return new Response(JSON.stringify({ references: [{ title: '通知', url: 'https://a.cn', content: '摘要', date: '2026-09-01' }, { title: '没网址' }] })); } });
    const out = await ok.search({ query: 'x', key: 'k' });
    expect(sent).toMatchObject({ url: 'https://qianfan.baidubce.com/v2/ai_search/web_search', headers: { 'X-Appbuilder-Authorization': 'Bearer k' } });
    expect(out.references).toEqual([{ title: '通知', url: 'https://a.cn', content: '摘要', date: '2026-09-01' }]);
    const limited = createBaidu({ fetchImpl: async () => new Response('{}', { status: 429 }) });
    await expect(limited.search({ query: 'x', key: 'k' })).rejects.toMatchObject({ kind: '请求太多' });
  });
});
