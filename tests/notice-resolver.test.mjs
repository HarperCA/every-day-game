import { describe, it, expect } from 'vitest';
import { checkVerification, contestKey, lookupSite, quoteFound, rankOfficialCandidates, rememberSite, resolveNotices, scoreCandidate, triedNote } from '../scripts/server/notice-resolver.mjs';
import { createPageReader } from '../scripts/server/page-reader.mjs';

const now = new Date('2026-10-12T12:00:00Z');
const name = '全国大学生生命科学竞赛';

describe('固定步骤：挑候选网址', () => {
  const refs = [
    { title:'关于举办第十二届全国大学生生命科学竞赛的通知', url:'https://culsc.cn/notice/646', date:'2026-09-01' },
    { title:'全国大学生生命科学竞赛 - 微博', url:'https://weibo.com/2/detail/1' },
    { title:'××大学关于组织参加全国大学生生命科学竞赛校内选拔的通知', url:'https://jwc.x.edu.cn/1', date:'2026-09-20' },
    { title:'喜报！我院斩获全国大学生生命科学竞赛一等奖', url:'https://bio.y.edu.cn/2', date:'2026-08-01' },
    { title:'教育厅关于转发全国大学生生命科学竞赛通知', url:'https://jyt.ah.gov.cn/3', date:'2026-09-05' },
    { title:'全国大学生生命科学竞赛 章程', url:'https://culsc.cn/rule' },
  ];
  it('转载站排除；学校转发、新闻扣分；官网和主管部门排前面；同一网站只取一个；最多两个', () => {
    const { picked, rejected } = rankOfficialCandidates(refs, name, 2026, { now });
    expect(picked.map(item => item.url)).toEqual(['https://jyt.ah.gov.cn/3', 'https://culsc.cn/notice/646']);
    expect(rejected.find(item => item.url.includes('weibo')).why).toContain('转载');
    expect(rejected.find(item => item.url === 'https://jwc.x.edu.cn/1').why).toContain('得分');
    expect(rejected.find(item => item.url === 'https://culsc.cn/rule').why).toBe('前两个已选定');
  });
  it('打分理由可读', () => {
    expect(scoreCandidate(refs[2], name, 2026, now)).toMatchObject({ reasons:expect.arrayContaining(['像学校转发（−3）']) });
  });
});

const officialPage = { status:'ok', url:'https://culsc.cn/notice/646', finalUrl:'https://culsc.cn/notice/646',
  text:'关于举办第十二届全国大学生生命科学竞赛（2026）的通知。主办单位：全国大学生生命科学竞赛委员会。参赛对象：全国普通高等学校全日制在校本科生。网络报名截止时间为2026年11月30日。' };
const result = (extra = {}) => ({ verdict:'official', page:0, organizer:{ value:'全国大学生生命科学竞赛委员会', quote:'主办单位：全国大学生生命科学竞赛委员会' },
  participants:{ value:'本科生', quote:'参赛对象：全国普通高等学校全日制在校本科生' }, edition:{ value:'第十二届 2026', quote:'第十二届全国大学生生命科学竞赛（2026）' }, ...extra });

describe('固定步骤：代码核对，不信模型的结论', () => {
  it('官方来源、主办和参赛对象在原文里、当届：核到', () => {
    const check = checkVerification(result(), [officialPage], { year:2026 });
    expect(check.decision).toBe('found');
    expect(Object.keys(check.fields)).toEqual(['organizer', 'participants', 'edition']);
  });
  it('引用对不上原文的字段去掉；主办方没核到就不算', () => {
    const check = checkVerification(result({ organizer:{ value:'教育部', quote:'主办单位：教育部高等教育司' } }), [officialPage], { year:2026 });
    expect(check).toMatchObject({ decision:'unresolved', dropped:['organizer'] });
  });
  it('参赛对象、报名截止都没核到不算；往届不算；转发不算；转载站不算', () => {
    expect(checkVerification(result({ participants:{} }), [officialPage], { year:2026 }).reason).toContain('参赛对象和报名截止都没核到');
    expect(checkVerification(result({ edition:{ value:'2023', quote:'第十二届全国大学生生命科学竞赛（2026）' } }), [officialPage], { year:2026 }).reason).toContain('不是当届');
    expect(checkVerification(result({ verdict:'repost' }), [officialPage], { year:2026 }).reason).toContain('转发');
    expect(checkVerification(result(), [{ ...officialPage, finalUrl:'https://weibo.com/x' }], { year:2026 }).reason).toContain('转载');
  });
  it('不是比赛要两次判断一致才下结论', () => {
    expect(checkVerification({ verdict:'not_competition' }, [officialPage], { year:2026, noticeKind:'not_competition' }).decision).toBe('not_competition');
    expect(checkVerification({ verdict:'not_competition' }, [officialPage], { year:2026, noticeKind:'competition' }).decision).toBe('unresolved');
  });
  it('引用至少 8 字、忽略空格标点', () => {
    expect(quoteFound('主办单位 ：全国大学生生命科学竞赛委员会', officialPage.text)).toBe(true);
    expect(quoteFound('主办单位', officialPage.text)).toBe(false);
  });
});

describe('固定步骤：官网记忆', () => {
  it('30 天内直接用，过期的写入时清掉；键忽略年份和届次', () => {
    let memory = rememberSite({ version:1, sites:{} }, { name:'2026年第十二届全国大学生生命科学竞赛', url:'https://culsc.cn/', by:'fixed' }, new Date('2026-09-01T00:00:00Z'));
    expect(contestKey('2026年第十二届全国大学生生命科学竞赛')).toBe(contestKey('全国大学生生命科学竞赛'));
    expect(lookupSite(memory, name, new Date('2026-09-20T00:00:00Z'))).toMatchObject({ url:'https://culsc.cn/' });
    expect(lookupSite(memory, name, new Date('2026-10-12T00:00:00Z'))).toBeNull();
    memory = rememberSite(memory, { name:'另一场比赛', url:'https://b.cn/', by:'agent' }, new Date('2026-10-12T00:00:00Z'));
    expect(Object.keys(memory.sites)).toHaveLength(1);
  });
});

describe('固定步骤：整体', () => {
  const notice = (n, title) => ({ name:title, detailUrl:`https://school.edu.cn/${n}` });
  it('核到的给结论、不是比赛的给结论、没核到的交给代理并附上试过什么', async () => {
    const named = [
      { notice:notice(1, '关于组织参加全国大学生生命科学竞赛的通知'), name, kind:'competition' },
      { notice:notice(2, '奖学金评审通知'), name:'国家奖学金评审', kind:'not_competition' },
      { notice:notice(3, '关于举办某某冷门大赛的通知'), name:'某某冷门大赛', kind:'competition' },
      { notice:notice(4, '园冶杯通知'), name:'园冶杯大学生国际竞赛', kind:'competition' },
    ];
    const searched = [];
    const searchEngine = { search:async query => { searched.push(query);
      if (query.startsWith(name)) return { references:[{ title:'关于举办第十二届全国大学生生命科学竞赛的通知', url:officialPage.url, date:'2026-09-01' }] };
      if (query.startsWith('国家奖学金')) return { references:[{ title:'国家奖学金评审办法 通知 2026', url:'https://xsc.gov.cn/1' }] };
      return { references:[{ title:'某某冷门大赛 微博', url:'https://weibo.com/9' }] }; } };
    const readPage = async url => url === officialPage.url ? officialPage : url.includes('yuanyebei') ? { status:'error', url, text:'' } : { status:'ok', url, finalUrl:url, text:'国家奖学金评审办法……'.repeat(30) };
    const verify = async (contest, _title, pages) => ({ tokens:100, result:contest === name ? result() : { verdict:'not_competition' } });
    const siteMemory = rememberSite({ version:1, sites:{} }, { name:'园冶杯大学生国际竞赛', url:'https://www.yuanyebei.com/', by:'agent' }, now);
    const out = await resolveNotices(named, { searchEngine, readPage, verify, siteMemory, now, year:2026, concurrency:1 });
    expect(out.stats).toMatchObject({ total:4, fromMemory:1, resolved:1, notCompetition:1, unresolved:2, verifyCalls:2 });
    const found = out.results.find(item => item.agent.outcome === 'found_official');
    expect(found).toMatchObject({ method:'fixed', leads:[{ url:officialPage.url, title:name, fromNoticeText:true }] });
    expect(found.followupQuery).toBe(`${name} 2026 通知`);
    expect(out.results.find(item => item.agent.outcome === 'not_competition').method).toBe('fixed');
    expect(out.unresolved.map(item => item.reason)).toEqual(['搜索结果里没有像官方来源的网页', '记忆里的官网读不到']);
    expect(out.unresolved[0].tried.urls[0].why).toContain('转载');
    expect(out.siteMemory.sites[contestKey(name)]).toMatchObject({ url:officialPage.url, by:'fixed' });
    expect(searched).not.toContain('园冶杯大学生国际竞赛 官网');
    expect(triedNote(out.unresolved[0].tried, out.unresolved[0].reason)).toContain('搜过「某某冷门大赛 2026 通知」「某某冷门大赛 官网」');
  });
});

describe('读网页（page-reader）', () => {
  const extract = {
    extractText:html => html.replace(/<[^>]+>/g, ''),
    findNoticeLinks:() => [{ text:'竞赛通知', url:'https://a.cn/n.pdf', score:9 }],
    extractPdfText:async () => ({ text:'PDF 正文：报名截止 2026年11月30日', status:'ok' }),
    extractDocxText:() => ({ text:'' }),
  };
  const fetcherFor = page => ({ get:async () => page });
  it('网页正文够长就直接用，并带上页面里的通知链接', async () => {
    const read = createPageReader({ fetcher:fetcherFor({ status:'ok', contentType:'text/html', text:`<p>${'正文'.repeat(200)}</p>` }), extract, kimiFetch:async () => { throw new Error('不该调用'); } });
    expect(await read('https://a.cn')).toMatchObject({ status:'ok', via:'direct', links:[{ text:'竞赛通知' }] });
  });
  it('空壳页改用 Kimi 读；robots 不允许的不读；PDF 读出文字', async () => {
    const shell = createPageReader({ fetcher:fetcherFor({ status:'ok', contentType:'text/html', text:'<p>首页 登录</p>' }), extract, kimiFetch:async () => ({ markdown:'渲染后的正文'.repeat(50) }) });
    expect(await shell('https://a.cn')).toMatchObject({ status:'ok', via:'kimi_fetch' });
    const robots = createPageReader({ fetcher:fetcherFor({ status:'blocked_by_robots' }), extract, kimiFetch:async () => { throw new Error('不该调用'); } });
    expect((await robots('https://mp.weixin.qq.com/s/1')).status).toBe('blocked');
    const pdf = createPageReader({ fetcher:fetcherFor({ status:'ok', contentType:'application/pdf', body:Buffer.from('%PDF-1.4 ...') }), extract });
    expect(await pdf('https://a.cn/n.pdf')).toMatchObject({ status:'ok', format:'pdf', text:expect.stringContaining('报名截止') });
  });
});

describe('后台明细显示固定步骤', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { composeRunDetail } = require('../apps/miniprogram/cloudfunctions/adminData/pipelineRunDetail.js');
  it('固定步骤核到的走 trace:found_fixed；没核到交给代理的写明原因', () => {
    const a = { name:'关于组织参加全国大学生生命科学竞赛的通知', detailUrl:'https://s.edu.cn/a' };
    const b = { name:'关于举办某某冷门大赛的通知', detailUrl:'https://s.edu.cn/b' };
    const detail = composeRunDetail('2026-10-12T17-00-00-000Z', {
      'baidu-candidates.json':{ candidates:[a, b] },
      'jev-filter-report.json':{ decisions:[{ name:a.name, url:a.detailUrl, action:'trace', kind:'repost_or_school_selection', source:'rule' }, { name:b.name, url:b.detailUrl, action:'trace', kind:'repost_or_school_selection', source:'rule' }] },
      'formal-notices.json':{ candidates:[a, b] },
      'notice-fixed-results.json':{ unresolved:[{ url:b.detailUrl, reason:'搜索结果里没有像官方来源的网页' }] },
      'notice-resolution-leads.json':{ results:[
        { noticeUrl:a.detailUrl, method:'fixed', followupQuery:'全国大学生生命科学竞赛 2026 通知', leads:[{ url:'https://culsc.cn/notice' }], agent:{ outcome:'found_official', label:'找到官方来源', reason:'固定步骤：官方来源', searches:2, reads:1, turns:0 } },
        { noticeUrl:b.detailUrl, method:'agent', followupQuery:'x', leads:[], agent:{ outcome:'not_found', label:'是比赛，但找不到官方来源', reason:'没搜到', searches:3, reads:2, turns:4 } }] },
    });
    const rowA = detail.rows.find(row => row.url === a.detailUrl);
    const rowB = detail.rows.find(row => row.url === b.detailUrl);
    expect(rowA.trail.map(item => `${item.n}:${item.o}`)).toContain('trace:found_fixed');
    expect(rowA.final).toContain('固定步骤核到官方来源');
    expect(rowB.trail.find(item => item.n === 'trace').note).toContain('固定步骤没核到（搜索结果里没有像官方来源的网页），交给代理');
  });
});
