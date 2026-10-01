// 通知追溯的搜索引擎：百度 → Kimi → DeepSeek 依次补位，每次都留下“用了哪个、返回了什么”
import { describe, expect, it, vi } from 'vitest';
import { baiduEngine, createSearcher, deepseekEngine, kimiEngine } from '../scripts/server/search-engines.mjs';
import { decideByProbabilities } from '../scripts/crawler/lib/jevCandidateFilter.mjs';

const ok = body => ({ ok:true, status:200, json:async () => body });
const fail = status => ({ ok:false, status, json:async () => ({}) });
const fake = (name, impl) => ({ name, label:name, key:'k', search:vi.fn(impl) });
const refs = n => ({ references:Array.from({ length:n }, (_, i) => ({ title:`t${i}`, url:`https://x/${i}`, content:'', date:'' })) });

describe('三个引擎把返回统一成同一个形状', () => {
  it('百度：references → 标题、网址、摘要、日期', async () => {
    const fetchImpl = vi.fn(async () => ok({ references:[{ title:'官网', url:'https://a/1', content:'报名入口', date:'2026-09-23' }, { title:'无网址' }] }));
    const result = await baiduEngine({ key:'k', fetchImpl }).search('q');
    expect(result.references).toEqual([{ title:'官网', url:'https://a/1', content:'报名入口', date:'2026-09-23' }]);
    expect(fetchImpl.mock.calls[0][1].headers['X-Appbuilder-Authorization']).toBe('Bearer k');
  });
  it('Kimi：search_results，自己截断到 10 条（接口不一定遵守 limit）', async () => {
    const list = Array.from({ length:14 }, (_, i) => ({ title:`t${i}`, url:`https://k/${i}`, snippet:'摘', content:'', date:'2026-01-01' }));
    const fetchImpl = vi.fn(async () => ok({ search_results:list }));
    const result = await kimiEngine({ key:'k', fetchImpl }).search('q');
    expect(result.references).toHaveLength(10);
    expect(result.references[0]).toMatchObject({ url:'https://k/0', content:'摘' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ text_query:'q', enable_page_crawling:false });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.kimi.com/coding/v1/search');
  });
  it('DeepSeek：web_search_tool_result 里只有标题和网址，同时返回 token 用量', async () => {
    const fetchImpl = vi.fn(async () => ok({ content:[{ type:'thinking' }, { type:'server_tool_use', input:{ query:'q' } },
      { type:'web_search_tool_result', content:[{ type:'web_search_result', title:'官网', url:'https://d/1', encrypted_content:'xxx', page_age:null }] }], usage:{ input_tokens:2100, output_tokens:80 } }));
    const result = await deepseekEngine({ key:'k', fetchImpl }).search('q');
    expect(result.references).toEqual([{ title:'官网', url:'https://d/1', content:'', date:'' }]);
    expect(result.usage).toEqual({ inputTokens:2100, outputTokens:80 });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.deepseek.com/anthropic/v1/messages');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).tools[0]).toMatchObject({ type:'web_search_20250305', max_uses:1 });
  });
  it('DeepSeek 搜索出错（结果块不是列表）要报错，不当成“没找到”', async () => {
    const fetchImpl = async () => ok({ content:[{ type:'web_search_tool_result', content:{ type:'web_search_tool_result_error', error_code:'unavailable' } }] });
    await expect(deepseekEngine({ key:'k', fetchImpl }).search('q')).rejects.toThrow('search_error:unavailable');
  });
  it('HTTP 出错抛错', async () => {
    await expect(kimiEngine({ key:'k', fetchImpl:async () => fail(429) }).search('q')).rejects.toThrow('http_429');
  });
});

describe('依次补位：百度 → Kimi → DeepSeek', () => {
  it('先用百度，百度额度用完换 Kimi，再用完换 DeepSeek，都用完返回 null（没轮上）', async () => {
    const baidu = fake('baidu', async () => refs(3)), kimi = fake('kimi', async () => refs(2)), deepseek = fake('deepseek', async () => refs(1));
    const searcher = createSearcher([{ engine:baidu, budget:2 }, { engine:kimi, budget:1 }, { engine:deepseek, budget:1 }]);
    const used = [];
    for (let i = 0; i < 5; i += 1) used.push((await searcher.search(`q${i}`))?.engine || null);
    expect(used).toEqual(['baidu', 'baidu', 'kimi', 'deepseek', null]);
    expect(searcher.summary().map(item => `${item.engine}:${item.used}/${item.left}`)).toEqual(['baidu:2/0', 'kimi:1/0', 'deepseek:1/0']);
  });
  it('每次搜索都记下用了哪个引擎、返回了几条', async () => {
    const searcher = createSearcher([{ engine:fake('baidu', async () => refs(7)), budget:1 }]);
    const result = await searcher.search('q');
    expect(result).toMatchObject({ engine:'baidu', references:expect.any(Array) });
    expect(result.attempts).toEqual([expect.objectContaining({ engine:'baidu', ok:true, returned:7 })]);
  });
  it('一个引擎失败就换下一个，并把失败也记下来；失败不扣额度', async () => {
    const baidu = fake('baidu', async () => { throw new Error('http_429'); });
    const kimi = fake('kimi', async () => refs(4));
    const searcher = createSearcher([{ engine:baidu, budget:3 }, { engine:kimi, budget:3 }]);
    const result = await searcher.search('q');
    expect(result.engine).toBe('kimi');
    expect(result.attempts.map(item => `${item.engine}:${item.ok}`)).toEqual(['baidu:false', 'kimi:true']);
    expect(result.attempts[0].error).toBe('http_429');
    expect(searcher.summary()[0]).toMatchObject({ used:0, left:3 });
  });
  it('连续失败两次的引擎本轮不再用，免得每个赛事组都白撞一次', async () => {
    const baidu = fake('baidu', async () => { throw new Error('http_429'); });
    const searcher = createSearcher([{ engine:baidu, budget:5 }, { engine:fake('kimi', async () => refs(1)), budget:5 }]);
    await searcher.search('a'); await searcher.search('b'); await searcher.search('c');
    expect(baidu.search).toHaveBeenCalledTimes(2);
    expect(searcher.summary()[0].disabled).toBe(true);
  });
  it('没配密钥的引擎直接跳过；全部失败时返回 failed，带上各引擎的错误', async () => {
    const noKey = { name:'baidu', label:'百度', key:'', search:vi.fn() };
    const broken = fake('kimi', async () => { throw new Error('http_500'); });
    const searcher = createSearcher([{ engine:noKey, budget:5 }, { engine:broken, budget:5 }]);
    const result = await searcher.search('q');
    expect(noKey.search).not.toHaveBeenCalled();
    expect(result).toMatchObject({ failed:true, references:[] });
    expect(result.attempts).toEqual([expect.objectContaining({ engine:'kimi', ok:false, error:'http_500' })]);
  });
});

describe('Jev 新判法：先看“与赛事无关”，再比两组概率（来自近 5 晚真实数据）', () => {
  it('招聘公告、招生简章（无关概率 > 0.5）丢弃', () => {
    expect(decideByProbabilities({ unrelated:0.73, repost_or_school_selection:0.2 }).action).toBe('reject');
  });
  it('无关概率 0.2～0.5：只留线索', () => {
    expect(decideByProbabilities({ unrelated:0.38, competition_site:0.38 })).toMatchObject({ action:'lead', lowConfidence:true });
  });
  it('第一名只有 0.52，但整体是赛事官网类：读详情（原先因 < 0.8 被搁置）', () => {
    const result = decideByProbabilities({ competition_site:0.52, registration_entry:0.2, organizer_notice:0.1, repost_or_school_selection:0.15, unrelated:0 });
    expect(result.action).toBe('fetch');
    expect(result.reason).toContain('读详情');
  });
  it('转载 + 新闻合计更高：追溯上级赛事；主办方通知归读详情这一组', () => {
    expect(decideByProbabilities({ repost_or_school_selection:0.42, news_or_result:0.2, organizer_notice:0.3, unrelated:0.02 }).action).toBe('trace');
    expect(decideByProbabilities({ organizer_notice:0.5, repost_or_school_selection:0.42, competition_site:0.06 }).action).toBe('fetch');
  });
  it('目录清单概率比两组都高：只留线索', () => {
    expect(decideByProbabilities({ directory_lead:0.6, repost_or_school_selection:0.2, organizer_notice:0.1 }).action).toBe('lead');
  });
});
