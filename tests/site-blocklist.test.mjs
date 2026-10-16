import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { BUILTIN_HOSTS, isBlockedHost, mergeBlocked, normalizeHost } from '../scripts/server/site-blocklist.mjs';
import { buildSuggestions, sourceHosts } from '../scripts/server/site-block-suggest.mjs';
import { baiduEngine, baiduSearchBody } from '../scripts/server/search-engines.mjs';

const require = createRequire(import.meta.url);
const { applyDecision, mergeSuggestions } = require('../apps/miniprogram/cloudfunctions/adminData/siteBlocklist.js');

describe('屏蔽网站名单（2026-10-12）', () => {
  it('内置名单含已有抓取器的平台、百度百科和微信公众号', () => {
    for (const host of ['tianchi.aliyun.com', 'datafountain.cn', 'baike.baidu.com', 'mp.weixin.qq.com', 'zhihu.com']) expect(BUILTIN_HOSTS).toContain(host);
  });
  it('按域名比对，子站也算', () => {
    expect(normalizeHost('https://www.EOL.cn/news/1.html')).toBe('eol.cn');
    expect(isBlockedHost('https://kjds.52jingsai.com/x', BUILTIN_HOSTS)).toBe(true);
    expect(isBlockedHost('https://www.cie.org.cn', BUILTIN_HOSTS)).toBe(false);
  });
  it('后台确认的和内置的合并、去重', () => {
    expect(mergeBlocked([{ host:'eol.cn' }, 'www.zhihu.com', { host:'不是域名' }])).toEqual([...BUILTIN_HOSTS, 'eol.cn']);
  });
  it('百度请求默认带内置名单，引擎可指定名单', async () => {
    expect(baiduSearchBody('q').block_websites).toEqual(expect.arrayContaining(['baike.baidu.com', 'tianchi.aliyun.com', 'mp.weixin.qq.com']));
    const bodies = [];
    const fetchImpl = async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok:true, status:200, text:async () => '{"references":[]}' }; };
    process.env.BAIDU_MANUAL = '1';
    process.env.BAIDU_USAGE_FILE = `${process.env.TEMP || '/tmp'}/baidu-usage-test-${Date.now()}.json`;
    try { await baiduEngine({ key:'k', fetchImpl, blocked:['eol.cn'] }).search('q'); }
    finally { delete process.env.BAIDU_MANUAL; delete process.env.BAIDU_USAGE_FILE; }
    expect(bodies[0].block_websites).toEqual(['eol.cn']);
  });
});

const run = (id, { dropped = [], candidates = [], decisions = [], results = [] } = {}) =>
  ({ id, baidu:{ dropped, candidates }, jev:{ decisions }, notices:{ results } });
const drop = (url, reason = 'irrelevant', title = '高考志愿') => ({ url, reason, title });

describe('每周统计建议屏蔽的网站', () => {
  const many = (host, n, extra = {}) => Array.from({ length:n }, (_, i) => drop(`https://${host}/a/${i}`, extra.reason, `${host} 标题${i}`));
  it('出现够多、从没被放行或追溯成功的才建议', () => {
    const runs = [
      run('2026-10-10T17-00-00-000Z', { dropped:[...many('eol.cn', 10), ...many('hncci.com', 10), ...many('few.cn', 3), ...many('traced.org', 10)],
        candidates:[{ detailUrl:'https://hncci.com/c1', name:'比赛' }, { detailUrl:'https://traced.org/n1', name:'通知' }],
        decisions:[{ url:'https://hncci.com/c1', action:'fetch' }, { url:'https://traced.org/n1', action:'trace' }],
        results:[{ noticeUrl:'https://traced.org/n1', agent:{ outcome:'found_official' } }] }),
      run('2026-10-11T17-00-00-000Z', { dropped:[...many('eol.cn', 8), ...many('hncci.com', 8), ...many('traced.org', 8)] }),
    ];
    const list = buildSuggestions(runs, { minRefs:15 });
    expect(list.map(item => item.host)).toEqual(['eol.cn']);
    expect(list[0]).toMatchObject({ refs:18, dropped:18, firstSeen:'2026-10-10T17-00-00-000Z', lastSeen:'2026-10-11T17-00-00-000Z' });
    expect(list[0].samples).toHaveLength(3);
    expect(list[0].reason).toContain('不含“赛”字 18');
  });
  it('已屏蔽、已忽略、学校网站、库里赛事的来源网站不建议', () => {
    const runs = [run('2026-10-11T17-00-00-000Z', { dropped:[...many('baike.baidu.com', 20), ...many('gk100.com', 20), ...many('chem.whu.edu.cn', 20), ...many('cie.org.cn', 20), ...many('zsb.eol.cn', 20)] })];
    const protectedHosts = sourceHosts([{ sources:[{ url:'https://www.cie.org.cn/notice' }] }]);
    const list = buildSuggestions(runs, { blocked:[...BUILTIN_HOSTS, 'eol.cn'], dismissed:[{ host:'gk100.com' }], protectedHosts, minRefs:15 });
    expect(list).toEqual([]);
  });
});

describe('后台：建议、确认、忽略', () => {
  const state = { blocked:[], suggestions:[], dismissed:[], builtin:[{ host:'zhihu.com', reason:'问答' }], generatedAt:'', windowDays:30, minRefs:15, runs:0 };
  const now = new Date('2026-10-12T02:00:00Z');
  it('新一周的建议去掉已屏蔽和已忽略的', () => {
    const next = mergeSuggestions({ ...state, blocked:[{ host:'a.cn' }], dismissed:[{ host:'b.cn' }] },
      { suggestions:[{ host:'a.cn' }, { host:'b.cn' }, { host:'www.c.cn', refs:20 }], runs:9, minRefs:15, builtin:[{ host:'zhihu.com', reason:'问答' }] }, now);
    expect(next.suggestions.map(item => item.host)).toEqual(['c.cn']);
    expect(next).toMatchObject({ runs:9, minRefs:15, generatedAt:now.toISOString() });
  });
  it('确认屏蔽把建议移进名单并留下统计依据；不屏蔽的移进忽略；可取消、可恢复', () => {
    const withSuggestion = { ...state, generatedAt:'2026-10-12T01:00:00.000Z', suggestions:[{ host:'eol.cn', refs:176, candidates:4, reason:'近 9 晚出现 176 次' }, { host:'gk100.com', refs:49 }] };
    let next = applyDecision(withSuggestion, { host:'eol.cn', decision:'block' }, now);
    expect(next.blocked).toEqual([{ host:'eol.cn', reason:'近 9 晚出现 176 次', decidedAt:now.toISOString(), evidence:{ refs:176, candidates:4, generatedAt:'2026-10-12T01:00:00.000Z' } }]);
    next = applyDecision(next, { host:'gk100.com', decision:'dismiss' }, now);
    expect(next.suggestions).toEqual([]);
    expect(next.dismissed.map(item => item.host)).toEqual(['gk100.com']);
    expect(applyDecision(next, { host:'eol.cn', decision:'unblock' }, now).blocked).toEqual([]);
    expect(applyDecision(next, { host:'gk100.com', decision:'restore' }, now).dismissed).toEqual([]);
  });
  it('内置名单不能重复确认，乱填的拒绝', () => {
    expect(() => applyDecision(state, { host:'zhihu.com', decision:'block' }, now)).toThrow('site_already_builtin');
    expect(() => applyDecision(state, { host:'x', decision:'block' }, now)).toThrow('invalid_site_host');
    expect(() => applyDecision(state, { host:'a.cn', decision:'delete' }, now)).toThrow('invalid_site_decision');
    expect(() => applyDecision(state, { host:'a.cn', decision:'unblock' }, now)).toThrow('site_not_blocked');
  });
});
