import { describe, it, expect } from 'vitest';
import { finalizeSources, formatPageFacts, runNoticeAgent, toLeadResult } from '../scripts/server/notice-agent.mjs';
import { followupCandidatesFromReport, noticeFollowupCompleted, splitTrustedFollowups } from '../scripts/server/resolve-notice-leads.mjs';

const notice = { name:'关于组织参加第十二届全国大学生生命科学竞赛的通知', detailUrl:'https://school.edu.cn/n/1', introduction:'校内选拔' };
const reply = (message, tokens = 100) => ({ ok:true, status:200, json:async () => ({ choices:[{ message }], usage:{ total_tokens:tokens } }) });
const final = body => reply({ content:JSON.stringify(body) });
const toolCall = (name, args) => reply({ content:'', tool_calls:[{ id:`c-${name}`, function:{ name, arguments:JSON.stringify(args) } }] });

describe('notice tracing by Kimi agent', () => {
  it('turns found official sources into trusted leads that skip Jev and are remembered', () => {
    const result = toLeadResult(notice, { outcome:'found_official', contest_name:'欧莱雅美妆科技黑客松', reason:'找到主办方官网',
      sources:[{ url:'https://official.example/notice.pdf', type:'organizer_notice', evidence:'报名截止2027年1月15日' }, { url:'javascript:void(0)' }],
      trace:[{ tool:'web_search', input:'欧莱雅 黑客松 官网' }, { tool:'fetch_page', input:'https://official.example/notice.pdf' }], turns:3, tokens:900 });
    expect(result.leads).toEqual([expect.objectContaining({ url:'https://official.example/notice.pdf', title:'欧莱雅美妆科技黑客松', fromNoticeText:true })]);
    expect(noticeFollowupCompleted(result)).toBe(true);
    const candidates = followupCandidatesFromReport({ results:[result] });
    expect(candidates).toHaveLength(1);
    expect(splitTrustedFollowups(candidates).trusted).toHaveLength(1);
    expect(result.agent).toMatchObject({ outcome:'found_official', searches:1, reads:1 });
  });

  it('remembers conclusive misses but retries skipped or failed notices next night', () => {
    expect(noticeFollowupCompleted(toLeadResult(notice, { outcome:'not_competition', reason:'奖学金评选' }))).toBe(true);
    expect(noticeFollowupCompleted(toLeadResult(notice, { outcome:'skipped_budget', reason:'额度用完' }))).toBe(false);
    expect(noticeFollowupCompleted(toLeadResult(notice, { outcome:'error', reason:'timeout' }))).toBe(false);
  });

  it('searches through the budgeted searcher, reads pages, and returns the conclusion', async () => {
    const replies = [toolCall('web_search', { query:'全国大学生生命科学竞赛 通知', site:'culsc.cn', recent:'year' }), toolCall('fetch_page', { url:'https://culsc.cn/notice' }),
      final({ outcome:'found_official', contest_name:'全国大学生生命科学竞赛', reason:'官网通知', sources:[{ url:'https://culsc.cn/notice', type:'organizer_notice', evidence:'“2027年1月15日，网络报名截止”' }] })];
    const searched = [];
    const scopes = [];
    const searcher = { search:async (query, options) => { searched.push(query); scopes.push(options); return { engine:'baidu', references:[{ title:'通知', url:'https://culsc.cn/notice', content:'' }] }; }, summary:() => [{ engine:'baidu', used:1 }] };
    const page = '全国大学生生命科学竞赛组委会关于举办第十二届全国大学生生命科学竞赛的通知。'.repeat(8) + '2027年1月15日，网络报名截止。';
    const report = await runNoticeAgent([notice], { provider:'kimi', key:'k', searcher, fetchImpl:async () => replies.shift(), fetchPage:async () => ({ markdown:page }), log:() => {} });
    expect(searched).toEqual(['全国大学生生命科学竞赛 通知']);
    expect(scopes).toEqual([{ site:'culsc.cn', recent:'year' }]);
    expect(report.results[0].agent.trace[0].input).toContain('site:culsc.cn');
    expect(report.results[0].leads[0].url).toBe('https://culsc.cn/notice');
    expect(report.results[0].agent.engines).toEqual({ baidu:1 });
    expect(report.engines).toEqual([{ engine:'baidu', used:1 }]);
  });

  it('stops on Kimi quota exhaustion and leaves the rest for the next night', async () => {
    const quota = { ok:false, status:403, json:async () => ({ error:{ message:"You've reached your usage limit" } }) };
    const report = await runNoticeAgent([notice, { ...notice, detailUrl:'https://school.edu.cn/n/2' }], { provider:'kimi', key:'k', concurrency:1,
      searcher:{ search:async () => null }, fetchImpl:async () => quota, log:() => {} });
    expect(report.results.map(item => item.agent.outcome)).toEqual(['skipped_budget', 'skipped_budget']);
    expect(report.results.every(item => !noticeFollowupCompleted(item))).toBe(true);
    expect(report.stopReason).toContain('额度');
  });

  const officialText = '全国大学生生命科学竞赛组委会关于举办第十二届全国大学生生命科学竞赛的通知。主办单位：全国大学生生命科学竞赛委员会。参赛对象：全国普通高等学校全日制在校本科生。2026年网络报名截止时间为2027年1月15日。'.repeat(8);
  const verified = { verdict:'official', page:0, organizer:{ value:'全国大学生生命科学竞赛委员会', quote:'主办单位：全国大学生生命科学竞赛委员会' },
    participants:{ value:'本科生', quote:'参赛对象：全国普通高等学校全日制在校本科生' }, edition:{ value:'2026', quote:'2026年网络报名截止时间为2027年1月15日' } };

  it('读网页返回核对过的要点而不是全文；核到官方来源后代码让它直接收尾（2026-10-12）', async () => {
    const bodies = [];
    const replies = [toolCall('fetch_page', { url:'https://culsc.cn/notice' }),
      final({ outcome:'found_official', contest_name:'全国大学生生命科学竞赛', reason:'官网通知', sources:[{ url:'https://culsc.cn/notice', evidence:'“参赛对象：全国普通高等学校全日制在校本科生”' }] })];
    const report = await runNoticeAgent([{ ...notice, contestName:'全国大学生生命科学竞赛', traceHint:'（固定步骤已试过：搜过「全国大学生生命科学竞赛 官网」）' }], {
      provider:'kimi', key:'k', searcher:{ search:async () => null }, log:() => {},
      fetchImpl:async (_url, init) => { bodies.push(JSON.parse(init.body)); return replies.shift(); },
      readPage:async url => ({ status:'ok', url, finalUrl:url, text:officialText, links:[{ text:'竞赛章程', url:'https://culsc.cn/rule.pdf' }] }),
      verifyPage:async () => ({ result:verified, tokens:500 }) });
    expect(bodies[0].messages[1].content).toContain('固定步骤已试过');
    expect(bodies[0].messages[1].content).toContain('认出的比赛：全国大学生生命科学竞赛');
    const toolOutput = bodies[1].messages.find(message => message.role === 'tool').content;
    expect(toolOutput).toContain('是这场比赛的官方来源');
    expect(toolOutput).toContain('主办：全国大学生生命科学竞赛委员会');
    expect(toolOutput).toContain('竞赛章程 → https://culsc.cn/rule.pdf');
    expect(toolOutput.length).toBeLessThan(officialText.length);
    expect(bodies[1].tools).toBeUndefined();
    expect(bodies[1].messages.at(-1).content).toContain('已核到官方来源');
    expect(report.results[0]).toMatchObject({ method:'agent', leads:[{ url:'https://culsc.cn/notice' }] });
    expect(report.verifyTokens).toBe(500);
  });

  it('结论里的来源由代码复核：没读到的、转载站、摘录对不上的去掉，一个不剩改为找不到', () => {
    const pages = new Map([['https://culsc.cn/notice', { status:'ok', text:officialText }], ['https://weibo.com/x', { status:'ok', text:officialText }]]);
    const result = finalizeSources({ outcome:'found_official', reason:'找到了', sources:[
      { url:'https://never-read.cn/a', evidence:'“主办单位：全国大学生生命科学竞赛委员会”' },
      { url:'https://weibo.com/x', evidence:'“主办单位：全国大学生生命科学竞赛委员会”' },
      { url:'https://culsc.cn/notice', evidence:'“主办单位是教育部高等教育司”' }] }, { pages, checks:new Map() });
    expect(result.outcome).toBe('not_found');
    expect(result.removedSources.map(item => item.why)).toEqual(['这个网址没读到正文', '转载、自媒体或屏蔽名单里的网站', '摘录不在原文里，核对也没通过']);
    const kept = finalizeSources({ outcome:'found_official', sources:[{ url:'https://culsc.cn/notice', evidence:'“主办单位：全国大学生生命科学竞赛委员会”' }] }, { pages, checks:new Map() });
    expect(kept).toMatchObject({ outcome:'found_official', sources:[{ url:'https://culsc.cn/notice' }] });
  });

  it('不读搜索引擎结果页；搜索器返回空时不再说成额度用完', async () => {
    const bodies = [];
    const replies = [reply({ content:'', tool_calls:[
      { id:'a', function:{ name:'fetch_page', arguments:JSON.stringify({ url:'https://www.baidu.com/s?wd=比赛' }) } },
      { id:'b', function:{ name:'web_search', arguments:JSON.stringify({ query:'全国大学生生命科学竞赛' }) } }] }), final({ outcome:'not_found', reason:'没搜到' })];
    let reads = 0;
    await runNoticeAgent([notice], { provider:'kimi', key:'k', searcher:{ search:async () => null }, log:() => {}, readPage:async () => { reads += 1; return { status:'ok', text:'x' }; },
      fetchImpl:async (_url, init) => { bodies.push(JSON.parse(init.body)); return replies.shift(); } });
    const tools = bodies[1].messages.filter(message => message.role === 'tool').map(message => message.content);
    expect(tools[0]).toContain('不读搜索引擎的结果页');
    expect(tools[1]).toContain('这次搜索失败');
    expect(reads).toBe(0);
  });

  it('要点格式：核不上的字段写明已去掉', () => {
    const text = formatPageFacts({ url:'https://a.cn', text:'x'.repeat(300), via:'kimi_fetch', links:[] }, { decision:'unresolved', reason:'主办方没在原文里核到', fields:{}, dropped:['organizer'] });
    expect(text).toContain('经 Kimi 读网页');
    expect(text).toContain('主办方没在原文里核到');
    expect(text).toContain('原文对不上、已去掉：主办');
  });

  it.each(['只是转发或转载', '只有往届', '主办方没在原文里核到'])('匹配原文引用也不能覆盖负核验：%s', reason => {
    const url = 'https://culsc.cn/notice';
    const result = finalizeSources({ outcome:'found_official', sources:[{ url, evidence:'“主办单位：全国大学生生命科学竞赛委员会”' }] }, {
      pages:new Map([[url, { status:'ok', text:officialText }]]), checks:new Map([[url, { decision:'unresolved', reason }]]), requireVerification:true });
    expect(result.outcome).toBe('not_found');
    expect(result.sources).toEqual([]);
    expect(result.removedSources[0].why).toContain(reason);
  });

  it('核验必需时，缺失核验不能凭匹配引用发布，也不标记 30 天完成', () => {
    const url = 'https://culsc.cn/notice';
    const result = finalizeSources({ outcome:'found_official', sources:[{ url, evidence:'“主办单位：全国大学生生命科学竞赛委员会”' }] }, {
      pages:new Map([[url, { status:'ok', text:officialText }]]), checks:new Map(), requireVerification:true });
    expect(result.outcome).toBe('error');
    expect(noticeFollowupCompleted(toLeadResult(notice, result))).toBe(false);
  });

  it('来源重定向到转载域名，不能凭原始域名和正文引用绕过屏蔽', () => {
    const url = 'https://culsc.cn/notice';
    const result = finalizeSources({ outcome:'found_official', sources:[{ url, evidence:'“主办单位：全国大学生生命科学竞赛委员会”' }] }, {
      pages:new Map([[url, { status:'ok', finalUrl:'https://mp.weixin.qq.com/s/notice', text:officialText }]]), checks:new Map() });
    expect(result.outcome).toBe('not_found');
    expect(result.removedSources[0].why).toContain('转载');
  });

  it('直接调用也默认 Codex，不会悄悄调用旧 Kimi', async () => {
    let calls = 0;
    const report = await runNoticeAgent([notice], { searcher:{ search:async () => null }, log:() => {},
      codexDecision:async () => { calls += 1; return { used:100, data:{ choices:[{ message:{ content:JSON.stringify({ outcome:'not_competition', reason:'招聘' }) } }] } }; },
      fetchImpl:async () => { throw new Error('不应调用旧代理接口'); } });
    expect(calls).toBe(1);
    expect(report.method).toBe('codex_agent');
    expect(report.results[0].agent.provider).toBe('codex');
    await expect(runNoticeAgent([], { provider:'unknown' })).rejects.toThrow('不支持');
  });

  it.each(['codex', 'kimi', 'deepseek'])('%s：最终回复提前返回，也必须停止预算用尽后的下一篇', async provider => {
    let calls = 0;
    const content = JSON.stringify({ outcome:'not_competition', reason:'招聘' });
    const report = await runNoticeAgent([notice, { ...notice, detailUrl:'https://school.edu.cn/n/2' }], {
      provider, key:'k', concurrency:1, tokenBudget:100, searcher:{ search:async () => null }, log:() => {},
      codexDecision:async () => { calls += 1; return { used:100, data:{ choices:[{ message:{ content } }] } }; },
      fetchImpl:async () => { calls += 1; return provider === 'deepseek'
        ? { ok:true, json:async () => ({ content:[{ type:'text', text:content }], usage:{ input_tokens:60, output_tokens:40 } }) }
        : reply({ content }, 100); } });
    expect(calls).toBe(1);
    expect(report.tokens).toBe(100);
    expect(report.results.map(item => item.agent.outcome)).toEqual(['not_competition', 'skipped_budget']);
    expect(report.stopReason).toContain('token 上限');
    expect(noticeFollowupCompleted(report.results[1])).toBe(false);
  });

  it.each(['found_official', 'not_found'])('核验服务超时，Codex 最终输出 %s 仍必须保留重试', async outcome => {
    const url = 'https://culsc.cn/notice';
    const replies = [
      { content:'', tool_calls:[{ id:'read', function:{ name:'fetch_page', arguments:JSON.stringify({ url }) } }] },
      { content:JSON.stringify({ outcome, reason:'判断完成', sources:[{ url, evidence:'“主办单位：全国大学生生命科学竞赛委员会”' }] }) },
    ];
    const report = await runNoticeAgent([notice], { searcher:{ search:async () => null }, log:() => {},
      codexDecision:async () => ({ used:100, data:{ choices:[{ message:replies.shift() }] } }),
      readPage:async () => ({ status:'ok', url, finalUrl:url, text:officialText }),
      verifyPage:async () => { throw new Error('HTTP 503 核验服务超时'); } });
    expect(report.results[0].agent.outcome).toBe('error');
    expect(report.results[0].leads).toEqual([]);
    expect(noticeFollowupCompleted(report.results[0])).toBe(false);
    expect(report.results[0].agent.reason).toMatch(/核验|核对/);
  });

  it('预算达到上限后，不再执行该响应所提出的付费工具', async () => {
    let reads = 0;
    const report = await runNoticeAgent([notice], { tokenBudget:100, searcher:{ search:async () => null }, log:() => {},
      codexDecision:async () => ({ used:100, data:{ choices:[{ message:{ content:'', tool_calls:[{ id:'read', function:{ name:'fetch_page', arguments:JSON.stringify({ url:'https://culsc.cn/notice' }) } }] } }] } }),
      readPage:async () => { reads += 1; return { status:'ok', text:officialText }; } });
    expect(reads).toBe(0);
    expect(report.results[0].agent.outcome).toBe('skipped_budget');
  });

  it('核验返回空对象不能当成明确找不到，仍需下次重试', async () => {
    const url = 'https://culsc.cn/notice';
    const replies = [
      { content:'', tool_calls:[{ id:'read', function:{ name:'fetch_page', arguments:JSON.stringify({ url }) } }] },
      { content:JSON.stringify({ outcome:'not_found', reason:'没核到' }) },
    ];
    const report = await runNoticeAgent([notice], { searcher:{ search:async () => null }, log:() => {},
      codexDecision:async () => ({ used:100, data:{ choices:[{ message:replies.shift() }] } }),
      readPage:async () => ({ status:'ok', url, finalUrl:url, text:officialText }), verifyPage:async () => ({ result:{}, tokens:10 }) });
    expect(report.results[0].agent.outcome).toBe('error');
    expect(noticeFollowupCompleted(report.results[0])).toBe(false);
    expect(report.verifyTokens).toBe(10);
  });

  it('Codex 已产出用量但 JSON 无效也计入预算，下一篇不再启动', async () => {
    let calls = 0;
    const report = await runNoticeAgent([notice, { ...notice, detailUrl:'https://school.edu.cn/n/2' }], {
      tokenBudget:100, concurrency:1, searcher:{ search:async () => null }, log:() => {},
      codexDecision:async () => { calls += 1; throw Object.assign(new Error('Codex 最终 JSON 无效'), { used:100 }); } });
    expect(calls).toBe(1);
    expect(report.tokens).toBe(100);
    expect(report.results.map(item => item.agent.outcome)).toEqual(['error', 'skipped_budget']);
    expect(report.results[0].agent.tokens).toBe(100);
    expect(report.results.every(item => !noticeFollowupCompleted(item))).toBe(true);
  });

  it('后续轮次失败时，每篇用量包括前面已成功的轮次，且总量不重复计费', async () => {
    let calls = 0;
    const report = await runNoticeAgent([notice], { searcher:{ search:async () => null }, log:() => {},
      codexDecision:async () => {
        calls += 1;
        if (calls === 2) throw Object.assign(new Error('Codex 输出格式错误'), { used:50 });
        return { used:100, data:{ choices:[{ message:{ content:'', tool_calls:[{ id:'search', function:{ name:'web_search', arguments:JSON.stringify({ query:'生命科学竞赛' }) } }] } }] } };
      } });
    expect(report.tokens).toBe(150);
    expect(report.results[0].agent).toMatchObject({ outcome:'error', tokens:150, turns:2, searches:1, trace:[{ tool:'web_search' }] });
  });

  it('DeepSeek 代理：搜索由 DeepSeek 执行，读网页走我们的 fetch_page；核到后最后一轮不让用工具（2026-10-12）', async () => {
    const bodies = [];
    const anth = (content, stop = 'end_turn', usage = { input_tokens:100, output_tokens:50, server_tool_use:{ web_search_requests:0 } }) => ({ ok:true, status:200, json:async () => ({ content, stop_reason:stop, usage }) });
    const replies = [
      anth([{ type:'server_tool_use', id:'s1', name:'web_search', input:{ query:'全国大学生生命科学竞赛 官网' } }, { type:'web_search_tool_result', tool_use_id:'s1', content:[] },
        { type:'tool_use', id:'t1', name:'fetch_page', input:{ url:'https://culsc.cn/notice' } }], 'tool_use', { input_tokens:200, output_tokens:80, server_tool_use:{ web_search_requests:1 } }),
      anth([{ type:'text', text:JSON.stringify({ outcome:'found_official', contest_name:'全国大学生生命科学竞赛', reason:'官网', sources:[{ url:'https://culsc.cn/notice', evidence:'“参赛对象：全国普通高等学校全日制在校本科生”' }] }) }]),
    ];
    const report = await runNoticeAgent([notice], { key:'ds', provider:'deepseek', searcher:{ search:async () => null }, log:() => {},
      fetchImpl:async (url, init) => { bodies.push({ url, body:JSON.parse(init.body), headers:init.headers }); return replies.shift(); },
      readPage:async url => ({ status:'ok', url, finalUrl:url, text:officialText, links:[] }), verifyPage:async () => ({ result:verified, tokens:300 }) });
    expect(bodies[0].url).toBe('https://api.deepseek.com/anthropic/v1/messages');
    expect(bodies[0].headers['x-api-key']).toBe('ds');
    expect(bodies[0].body.tools[0]).toMatchObject({ type:'web_search_20250305' });
    expect(bodies[0].body.system).toContain('由系统执行');
    expect(bodies[1].body.tool_choice).toEqual({ type:'none' });
    const lastUser = bodies[1].body.messages.at(-1);
    expect(lastUser.role).toBe('user');
    expect(lastUser.content.map(block => block.type)).toEqual(['tool_result', 'text']);
    expect(lastUser.content[0].content).toContain('是这场比赛的官方来源');
    expect(report).toMatchObject({ method:'deepseek_agent', model:'deepseek-flash' });
    expect(report.results[0]).toMatchObject({ leads:[{ url:'https://culsc.cn/notice' }], agent:{ engines:{ deepseek:1 }, searches:1, reads:1 } });
  });
});
