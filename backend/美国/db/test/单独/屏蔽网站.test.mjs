// 屏蔽网站（百度搜索的屏蔽名单）：旧代码原样搬来（2026-11-02 用户定），旧测试 tests/site-blocklist.test.mjs 的用例照搬；
// 新加的是存放：旧的存在后台 admin_state 集合的一份文档里，新的存在比赛库“后台状态”表的一行里，编号同样是 site_blocklist。
// 没搬的旧用例：“百度请求默认带内置名单”——新代码里百度接口在 AI 总管，名单由调用方经 blocked 传，见 pipeline 的测试。
import { describe, expect, it } from 'vitest';
import { open } from '../复用/样例数据.mjs';
import { 屏蔽网站 } from '../../index.mjs';

const { BUILTIN_BLOCKED, BUILTIN_HOSTS, isBlockedHost, mergeBlocked, normalizeHost, applyDecision, mergeSuggestions } = 屏蔽网站;

describe('屏蔽网站名单（2026-10-12）', () => {
  it('内置名单含已有抓取器的平台、百度百科和微信公众号', () => {
    for (const host of ['tianchi.aliyun.com', 'datafountain.cn', 'baike.baidu.com', 'mp.weixin.qq.com', 'zhihu.com']) expect(BUILTIN_HOSTS).toContain(host);
    expect(BUILTIN_BLOCKED).toHaveLength(9);
  });
  it('按域名比对，子站也算', () => {
    expect(normalizeHost('https://www.EOL.cn/news/1.html')).toBe('eol.cn');
    expect(isBlockedHost('https://kjds.52jingsai.com/x', BUILTIN_HOSTS)).toBe(true);
    expect(isBlockedHost('https://www.cie.org.cn', BUILTIN_HOSTS)).toBe(false);
  });
  it('后台确认的和内置的合并、去重', () => {
    expect(mergeBlocked([{ host:'eol.cn' }, 'www.zhihu.com', { host:'不是域名' }])).toEqual([...BUILTIN_HOSTS, 'eol.cn']);
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

describe('存在比赛库（后台状态表的 site_blocklist 一行）', () => {
  const now = () => new Date('2026-10-12T02:00:00Z');
  it('还没存过：空的状态，内置名单直接从代码里来（旧的要等第一次统计后才显示）', () => {
    const s = 屏蔽网站.读状态(open());
    expect(s).toMatchObject({ blocked: [], suggestions: [], dismissed: [], generatedAt: '' });
    expect(s.builtin).toEqual(BUILTIN_BLOCKED);
    expect(屏蔽网站.当前屏蔽(open())).toEqual(BUILTIN_HOSTS);
  });
  it('写建议、确认、取消都存进库里，再读还在；当前屏蔽 = 内置 + 后台确认的', () => {
    const db = open();
    expect(屏蔽网站.写建议(db, { suggestions: [{ host: 'eol.cn', refs: 20, reason: '近 9 晚出现 20 次' }, { host: 'gk100.com', refs: 16 }], runs: 9, minRefs: 15, windowDays: 30 }, { now })).toEqual({ suggestions: 2, blocked: 0 });
    let s = 屏蔽网站.决定(db, { host: 'eol.cn', decision: 'block' }, { now });
    expect(s.blocked.map(x => x.host)).toEqual(['eol.cn']);
    s = 屏蔽网站.决定(db, { host: 'gk100.com', decision: 'dismiss' }, { now });
    expect(屏蔽网站.读状态(db)).toMatchObject({ suggestions: [], dismissed: [{ host: 'gk100.com' }], runs: 9, generatedAt: '2026-10-12T02:00:00.000Z' });
    expect(屏蔽网站.当前屏蔽(db)).toEqual([...BUILTIN_HOSTS, 'eol.cn']);
    屏蔽网站.决定(db, { host: 'eol.cn', decision: 'unblock' }, { now });
    expect(屏蔽网站.当前屏蔽(db)).toEqual(BUILTIN_HOSTS);
    expect(db.get('admin_state', 'site_blocklist').data.data.updated_at).toBe('2026-10-12T02:00:00.000Z');
  });
  it('名单(状态) 从读到的一行算：读不到或坏了只用内置名单', () => {
    expect(屏蔽网站.名单({ blocked: [{ host: 'eol.cn' }] })).toEqual([...BUILTIN_HOSTS, 'eol.cn']);
    expect(屏蔽网站.名单(null)).toEqual(BUILTIN_HOSTS);
    expect(屏蔽网站.名单({ blocked: '坏了' })).toEqual(BUILTIN_HOSTS);
  });
});
