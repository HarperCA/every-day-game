// 通知追溯的搜索引擎：百度 → Kimi → DeepSeek 依次补位，每次都留下“用了哪个、返回了什么”
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { baiduEngine, createSearcher, deepseekEngine, kimiEngine, takeBaiduQuota } from '../scripts/server/search-engines.mjs';

// 百度调用会记共享用量文件：测试写到临时目录，不碰仓库
process.env.BAIDU_USAGE_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'baidu-usage-')), 'baidu-usage.json');

describe('百度每天自动任务最多 30 次，剩下的留给测试', () => {
  const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'baidu-q-')), 'u.json');
  it('自动任务到 30 次就领不到，跨程序共用同一个计数', () => {
    const f = file();
    const now = new Date('2026-10-10T17:00:00Z');
    for (let i = 0; i < 30; i += 1) expect(takeBaiduQuota({ file:f, now, caller:i < 20 ? 'nightly' : 'trace', manual:false }).ok).toBe(true);
    expect(takeBaiduQuota({ file:f, now, manual:false }).ok).toBe(false);
    expect(JSON.parse(fs.readFileSync(f, 'utf8')).byCaller).toEqual({ nightly:20, trace:10 });
  });
  it('手动测试单独记，不受 30 次限制；北京时间换日后重新计数', () => {
    const f = file();
    const now = new Date('2026-10-10T15:59:00Z');
    for (let i = 0; i < 30; i += 1) takeBaiduQuota({ file:f, now, manual:false });
    expect(takeBaiduQuota({ file:f, now, manual:true }).ok).toBe(true);
    expect(takeBaiduQuota({ file:f, now:new Date('2026-10-10T16:00:00Z'), manual:false })).toMatchObject({ ok:true, used:1 });
  });
  it('额度用完时百度引擎不发请求，搜索链换下一个引擎', async () => {
    const f = file();
    for (let i = 0; i < 30; i += 1) takeBaiduQuota({ file:f, manual:false });
    process.env.BAIDU_USAGE_FILE = f;
    const fetchImpl = vi.fn();
    await expect(baiduEngine({ key:'k', fetchImpl }).search('q')).rejects.toThrow('baidu_daily_auto_limit');
    expect(fetchImpl).not.toHaveBeenCalled();
    process.env.BAIDU_USAGE_FILE = file();
  });
});
import { decideByProbabilities } from '../scripts/crawler/lib/jevCandidateFilter.mjs';

const ok = body => ({ ok:true, status:200, json:async () => body, text:async () => JSON.stringify(body) });
const fail = status => ({ ok:false, status, json:async () => ({}), text:async () => '{}' });
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
  it('Kimi 报 500 时重试一次，第二次成功就用第二次的结果', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail(500)).mockResolvedValueOnce(ok({ search_results:[{ title:'t', url:'https://k/1' }] }));
    const result = await kimiEngine({ key:'k', fetchImpl, retryDelayMs:0 }).search('q');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.references).toHaveLength(1);
  });
  it('Kimi 带 site: 的搜索重试后仍是 500，按没有结果返回；不带 site: 的仍报错', async () => {
    const fetchImpl = vi.fn(async () => fail(500));
    await expect(kimiEngine({ key:'k', fetchImpl, retryDelayMs:0 }).search('site:zjedu.gov.cn "多媒体作品设计竞赛"')).resolves.toEqual({ references:[] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await expect(kimiEngine({ key:'k', fetchImpl, retryDelayMs:0 }).search('多媒体作品设计竞赛')).rejects.toThrow('http_500');
  });
  it('Kimi 4xx 不重试', async () => {
    const fetchImpl = vi.fn(async () => fail(429));
    await expect(kimiEngine({ key:'k', fetchImpl, retryDelayMs:0 }).search('site:a.cn q')).rejects.toThrow('http_429');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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

describe('Kimi 读网页接口（重读空壳页）', () => {
  it('返回执行脚本后的正文，图片去掉；记下用时', async () => {
    const { kimiFetchPage } = await import('../scripts/server/search-engines.mjs');
    const fetchImpl = vi.fn(async () => ok({ url:'https://www.bmedesign.cn', markdown:'第十一届全国大学生生物医学工程创新设计竞赛，由中国生物医学工程学会主办。\n\n\n\n![image1](https://img/x.png)\n报名延长通知' }));
    const page = await kimiFetchPage('https://www.bmedesign.cn', { key:'k', fetchImpl });
    expect(page.markdown).toBe('第十一届全国大学生生物医学工程创新设计竞赛，由中国生物医学工程学会主办。\n\n报名延长通知');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.kimi.com/coding/v1/fetch');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ url:'https://www.bmedesign.cn' });
  });
  it('出错时抛错，由调用方保留原来的“空壳页”结果', async () => {
    const { kimiFetchPage } = await import('../scripts/server/search-engines.mjs');
    await expect(kimiFetchPage('https://a.cn', { key:'k', fetchImpl:async () => fail(500) })).rejects.toThrow('http_500');
    await expect(kimiFetchPage('https://a.cn', { key:'' })).rejects.toThrow('kimi_key_not_configured');
  });
});

describe('保存搜索接口的原始返回（SEARCH_RAW_FILE）', () => {
  it('设了才保存：每次调用一行，带引擎、查询词、状态和原样正文', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const file = path.join(os.tmpdir(), `raw-${Date.now()}.jsonl`);
    const body = { search_results:[{ title:'官网', url:'https://k/1' }] };
    const fetchImpl = async () => ({ ok:true, status:200, text:async () => JSON.stringify(body) });
    await kimiEngine({ key:'k', fetchImpl }).search('不保存');
    expect(fs.existsSync(file)).toBe(false);
    process.env.SEARCH_RAW_FILE = file;
    try {
      const result = await kimiEngine({ key:'k', fetchImpl }).search('全国大学生生命科学竞赛报名入口');
      expect(result.references[0].url).toBe('https://k/1');
      const line = JSON.parse(fs.readFileSync(file, 'utf8').trim());
      expect(line).toMatchObject({ engine:'kimi', query:'全国大学生生命科学竞赛报名入口', status:200, body:JSON.stringify(body) });
    } finally { delete process.env.SEARCH_RAW_FILE; fs.rmSync(file, { force:true }); }
  });
});

describe('百度搜索范围参数（2026-10-10，通知追溯代理可选用）', async () => {
  const { baiduSearchBody, normalizeSite } = await import('../scripts/server/search-engines.mjs');
  it('限定网站和近期结果按官方参数名写进请求', () => {
    const body = baiduSearchBody('第十二届 通知', { site:'https://www.culsc.cn/#/Home', recent:'semiyear' });
    expect(body.search_filter).toEqual({ match:{ site:['www.culsc.cn'] } });
    expect(body.search_recency_filter).toBe('semiyear');
    expect(body.query_policy).toEqual({ enable_rewrite:true });
    expect(body.block_websites).toContain('mp.weixin.qq.com');
  });
  it('不认识的取值不带上，不传就是普通搜索', () => {
    const body = baiduSearchBody('q', { site:'不是域名', recent:'day' });
    expect(body.search_filter).toBeUndefined();
    expect(body.search_recency_filter).toBeUndefined();
    expect(normalizeSite('jyt.ah.gov.cn/tsdw/x.html')).toBe('jyt.ah.gov.cn');
  });
  it('搜索链把范围参数交给引擎', async () => {
    const seen = [];
    const searcher = createSearcher([{ engine:{ name:'baidu', label:'百度', key:'k', search:async (q, options) => { seen.push(options); return refs(1); } }, budget:1 }]);
    await searcher.search('q', { site:'culsc.cn', recent:'year' });
    expect(seen).toEqual([{ site:'culsc.cn', recent:'year' }]);
  });
});
