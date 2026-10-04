// 后台“抓取结果账 → 查看明细”：由运行目录里的各阶段文件拼出逐条去向
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { composeRunDetail, loadRunDetail } = require('../apps/miniprogram/cloudfunctions/adminData/pipelineRunDetail.js');

const candidate = (name, url, extra = {}) => ({ name, detailUrl:url, introduction:`${name}简介`, matchedQuery:'q1', discovery:{ route:'覆盖空白' }, ...extra });
const files = {
  'baidu-candidates.json':{
    stats:{ referencesTotal:6, queries:1 }, perQuery:[{ query:'q1', route:'覆盖空白', references:6, outOfScope:1, irrelevant:0, duplicate:0, candidates:5 }],
    droppedCount:1, dropped:[{ query:'q1', route:'覆盖空白', reason:'out_of_scope', reasonText:'不在收录范围', title:'中学生竞赛', url:'https://a/0', snippet:'x' }],
    candidates:[candidate('已在库的赛事', 'https://a/1'), candidate('校内选拔通知', 'https://a/2'), candidate('关于举办某大赛的通知', 'https://a/3'), candidate('某大赛官网', 'https://a/4'), candidate('读失败', 'https://a/5')],
  },
  'tianchi-candidates.json':{ candidates:[{ name:'天池赛', detailUrl:'https://t/1' }] },
  'jev-filter-report.json':{ decisions:[
    { url:'https://a/2', action:'reject', kind:'repost_or_school_selection', reason:'校内选拔', confidence:1 },
    { url:'https://a/3', action:'fetch', kind:'organizer_notice', reason:'正式通知', confidence:0.9 },
    { url:'https://a/4', action:'fetch', kind:'competition_site', reason:'官网', confidence:0.95 },
    { url:'https://a/5', action:'fetch', kind:'competition_site', reason:'官网', confidence:0.9 },
  ] },
  'formal-notices.json':{ candidates:[{ detailUrl:'https://a/3' }] },
  'notice-resolution-leads.json':{ results:[{ noticeUrl:'https://a/3', noticeTitle:'关于举办某大赛的通知', proposedName:'某大赛', followupQuery:'某大赛 官网', leads:[{ title:'某大赛官网', url:'https://o/1' }] }] },
  'combined-candidates.json':{ candidates:[{ detailUrl:'https://a/4' }, { detailUrl:'https://a/5' }] },
  'combined-extracted.json':{ results:[{ url:'https://a/4', ok:true }, { url:'https://a/5', ok:false, status:'blocked_by_robots' }] },
  'combined-candidates.json.scope-review.json':{ held:[{ candidate:{ detailUrl:'https://a/4' }, scope:{ reason:'标题不是一场具体比赛' } }] },
  'ingest-report.json':{ added:0, failureReasons:{ '标题不是一场具体比赛':1 } },
};

describe('单轮抓取明细', () => {
  const detail = composeRunDetail('2026-09-28T17-00-00-614Z', files);
  const byUrl = Object.fromEntries(detail.rows.map(row => [row.url, row]));
  it('每一条都有去向：搜索丢弃、判重、拦截、追溯、读详情', () => {
    expect(byUrl['https://a/0'].final).toBe('搜索时丢弃：不在收录范围');
    expect(byUrl['https://a/1'].final).toBe('判重跳过');
    expect(byUrl['https://a/2']).toMatchObject({ final:'前置筛选拦截', kind:'转载或校内选拔', filter:'丢弃（与赛事无关）' });
    expect(byUrl['https://a/3'].final).toBe('转入通知追溯（找到 1 个待核验页面）');
    expect(byUrl['https://a/4'].final).toBe('读了详情页，未入库：标题不是一场具体比赛');
    expect(byUrl['https://a/5'].final).toBe('读详情页失败（blocked_by_robots）');
    expect(byUrl['https://t/1'].source).toBe('天池');
  });
  it('汇总数字和追溯、查询表', () => {
    expect(detail.summary).toMatchObject({ searchResults:6, dropped:1, candidates:6, newCandidates:4, formalNotices:1, detailRead:2, extractOk:1, added:0 });
    expect(detail.notices[0].leads[0].url).toBe('https://o/1');
    expect(detail.perQuery[0].candidates).toBe(5);
  });
  it('只接受运行编号格式，不能借此读别的目录', () => {
    expect(() => loadRunDetail('../../etc')).toThrow('invalid_run_id');
    expect(() => loadRunDetail('2026-01-01T00-00-00-000Z')).toThrow('run_not_found');
  });
});

// 2026-10-01：数据流图——每条比赛带“经过路径”，流程图上的数字由路径算出，点开的清单一定和图上数字一致
import { NODES } from '../apps/miniprogram/cloudfunctions/adminData/pipelineFlow.js';

describe('流程图定义自洽', () => {
  it('每个处理结果指向的环节都存在；结束环节没有后续', () => {
    for (const [id, node] of Object.entries(NODES)) {
      if (node.kind === 'end') { expect(node.outcomes, id).toBeUndefined(); continue; }
      for (const [outcome, def] of Object.entries(node.outcomes)) expect(NODES[def.to], `${id}.${outcome} → ${def.to}`).toBeTruthy();
    }
  });
});

describe('每条比赛的路径与流程图', () => {
  const withIngest = {
    ...files,
    'combined-candidates.json':{ candidates:[{ detailUrl:'https://a/4', externalId:'search-a4' }, { detailUrl:'https://a/5' }, { detailUrl:'https://f/1', externalId:'trace-f1', name:'追溯来的大赛' }] },
    'combined-extracted.json':{ results:[{ url:'https://a/4', ok:true }, { url:'https://a/5', ok:false, status:'blocked_by_robots' }, { url:'https://f/1', ok:true }] },
    'combined-candidates.json.scope-review.json':{ held:[] },
    'notice-followup-filter-report.json':{ decisions:[{ url:'https://f/1', title:'f.example.org', proposedName:'追溯来的大赛', action:'fetch', kind:'competition_site', confidence:0.9, source:'notice_text' }] },
    'ingest-report.json':{ added:1, addedIds:['edition-search-a4'], updatedIds:[], addedList:[{ name:'x', label:'archive', id:'edition-search-a4' }],
      skippedList:[{ name:'追溯来的大赛', reason:'发现时已过报名截止时间' }], failureReasons:{} },
  };
  const detail = composeRunDetail('2026-09-30T17-00-15-235Z', withIngest);
  const byUrl = Object.fromEntries(detail.rows.map(row => [row.url, row]));
  const path = row => row.trail.map(entry => `${entry.n}:${entry.o}`).join(' > ');

  it('真正写入的才算入库；写入的带上是归档还是自动发布；入库时跳过的显示原因', () => {
    expect(byUrl['https://a/4']).toMatchObject({ final:'读了详情页，已写入后台' });
    expect(path(byUrl['https://a/4'])).toBe('search:ok > dedupe:new > rule:pass > jev:fetch > read:ok > extract:ok > same_name:new > scope:pass > gate:written > end_written:');
    expect(byUrl['https://a/4'].trail.find(entry => entry.n === 'gate').note).toContain('归档');
    expect(byUrl['https://f/1']).toMatchObject({ source:'通知追溯', final:'读了详情页，未入库：发现时已过报名截止时间' });
    expect(path(byUrl['https://f/1'])).toBe('trace:found > followup:read > read:ok > extract:ok > same_name:new > scope:pass > gate:skip > end_scope:');
  });
  it('读取失败、判重跳过、前置筛选各自落在对应的结束环节', () => {
    expect(path(byUrl['https://a/5'])).toBe('search:ok > dedupe:new > rule:pass > jev:fetch > read:fail > end_readfail:');
    expect(path(byUrl['https://a/1'])).toBe('search:ok > dedupe:skip > end_dup:');
    expect(path(byUrl['https://a/0'])).toBe('search:dropped > end_dropped:');
    expect(path(byUrl['https://a/2'])).toBe('search:ok > dedupe:new > rule:pass > jev:reject > end_rejected:');
  });
  it('标题是通知、被转去追溯的：路径标明“转去追溯”，并带上找到几个页面', () => {
    expect(path(byUrl['https://a/3'])).toBe('search:ok > dedupe:new > rule:pass > jev:notice > trace:found');
  });
  it('图上的数字就是路径里数出来的：节点流入、处理结果、连线', () => {
    const node = id => detail.flow.nodes.find(item => item.id === id);
    const edge = id => detail.flow.edges.find(item => item.id === id)?.count || 0;
    expect(node('read').in).toBe(2 + 1);          // a/4、a/5 和追溯来的 f/1
    expect(node('read').outcomes.find(item => item.id === 'fail').count).toBe(1);
    expect(node('extract').outcomes.find(item => item.id === 'ok').count).toBe(2);
    expect(node('end_written').in).toBe(1);
    expect(edge('read>extract')).toBe(2);
    // 从“通知追溯”出来的页面连线（虚拟路径）算连线，但不算追溯环节处理了它
    expect(edge('trace>followup')).toBeGreaterThanOrEqual(1);
    expect(node('trace').in).toBe(detail.rows.filter(row => row.trail.some(entry => entry.n === 'trace' && !entry.virtual)).length);
  });
  it('老的运行没有入库明细时不报错，按原来的判断显示', () => {
    const old = composeRunDetail('2026-09-28T17-00-00-614Z', { ...files, 'ingest-report.json':{ added:0, failureReasons:{} } });
    expect(old.rows.every(row => Array.isArray(row.trail))).toBe(true);
  });
});

describe('判重交给 AI 裁决后的明细', () => {
  const arbFiles = {
    ...files,
    'dedupe-arbitration-baidu.json':{ decisions:{
      'https://a/1':{ relation:'same_edition', promote:false, label:'同一场比赛的同一届（重复）', reason:'库里已有当前这一届', thinking:'比较了届次……' },
      'https://a/4':{ relation:'new_edition', promote:true, label:'同一场比赛的新一届（新的替代旧的）', reason:'2026 比库里 2025 新' },
    } },
    'dedupe-arbitration-baidu-input.json':{ items:[] },
  };
  const detail = composeRunDetail('2026-09-28T17-00-00-614Z', arbFiles);
  const byUrl = Object.fromEntries(detail.rows.map(row => [row.url, row]));
  it('AI 判为重复的，写明 AI 的理由，路径走“判重裁决 → 跳过”', () => {
    expect(byUrl['https://a/1'].final).toContain('AI 裁决');
    expect(byUrl['https://a/1'].final).toContain('库里已有当前这一届');
    expect(byUrl['https://a/1'].thinking).toBe('比较了届次……');
    expect(byUrl['https://a/1'].trail.map(item => `${item.n}:${item.o}`)).toContain('arbitrate:skip');
  });
  it('AI 判为新一届的，路径走“判重裁决 → 继续”', () => {
    expect(byUrl['https://a/4'].dup).toContain('AI 裁决');
    expect(byUrl['https://a/4'].trail.map(item => `${item.n}:${item.o}`)).toContain('arbitrate:new');
    expect(detail.flow.nodes.find(node => node.id === 'dedupe')).toBeTruthy();
  });
});

describe('通知追溯没找到的几种原因、追溯页面没读的几种原因', () => {
  const notice = (url, name) => ({ name, detailUrl:url, introduction:'', discovery:{} });
  const tfiles = {
    'baidu-candidates.json':{ candidates:[notice('https://n/1', 'A'), notice('https://n/2', 'A 第二篇'), notice('https://n/3', 'B'), notice('https://n/4', 'C'), notice('https://n/5', '教务处')] },
    'formal-notices.json':{ candidates:[notice('https://n/1', 'A'), notice('https://n/2', 'A 第二篇'), notice('https://n/3', 'B'), notice('https://n/4', 'C'), notice('https://n/5', '教务处')] },
    'jev-filter-report.json':{ decisions:['1', '2', '3', '4', '5'].map(i => ({ url:`https://n/${i}`, action:'trace', kind:'repost_or_school_selection', confidence:1, reason:'' })) },
    'notice-resolution-leads.json':{ results:[
      { noticeUrl:'https://n/1', followupQuery:'A 官网', notices:[{ url:'https://n/1' }, { url:'https://n/2' }], leads:[{ url:'https://o/1' }] },   // 同组的第二篇也要算“找到”
      { noticeUrl:'https://n/3', followupQuery:'B 官网', notices:[{ url:'https://n/3' }], leads:[] },                                        // 搜了没找到
      { noticeUrl:'https://n/4', notices:[{ url:'https://n/4' }], leads:[] },                                                               // 提得出名字但没轮上额度
    ] },
    'notice-followup-filter-report.json':{ decisions:[
      { url:'https://o/1', title:'官网', action:'review', kind:'competition_site', lowConfidence:true, reason:'低' },
      { url:'https://o/2', title:'关于举办2026某赛的通知', action:'fetch', kind:'organizer_notice', confidence:0.97, reason:'通知' },
      { url:'https://o/3', title:'喜报', action:'trace', kind:'news_or_result', confidence:0.9, reason:'新闻' },
      { url:'https://o/4', title:'某赛官网', action:'fetch', kind:'competition_site', confidence:0.9, reason:'重复' },
    ] },
  };
  const detail = composeRunDetail('2026-09-28T17-00-00-614Z', tfiles);
  const stepOf = (url, node) => detail.rows.find(row => row.url === url)?.trail.find(item => item.n === node)?.o;
  it('通知追溯：找到（含同组第二篇）/ 搜了没找到 / 没轮上额度 / 提不出赛事名', () => {
    expect(stepOf('https://n/1', 'trace')).toBe('found');
    expect(stepOf('https://n/2', 'trace')).toBe('found');
    expect(stepOf('https://n/3', 'trace')).toBe('none');
    expect(stepOf('https://n/4', 'trace')).toBe('noquota');
    expect(stepOf('https://n/5', 'trace')).toBe('noname');
  });
  it('没找到页面的，最终结论按原因写，不再统一写“转入通知追溯”', () => {
    const finalOf = url => detail.rows.find(row => row.url === url)?.final;
    expect(finalOf('https://n/1')).toBe('转入通知追溯（找到 1 个待核验页面）');
    expect(finalOf('https://n/3')).toBe('追溯没找到（搜了，没搜到可用页面）');
    expect(finalOf('https://n/4')).toBe('追溯没找到（没轮上搜索额度）');
    expect(finalOf('https://n/5')).toBe('追溯没找到（标题提不出合法赛事名，没搜）');
  });
  it('追溯页面没读：把握低 / 通知类 / 新闻 / 重复，各有各的出口', () => {
    expect(stepOf('https://o/1', 'followup')).toBe('skip_low');
    expect(stepOf('https://o/2', 'followup')).toBe('skip_notice');
    expect(stepOf('https://o/3', 'followup')).toBe('skip_news');
    expect(stepOf('https://o/4', 'followup')).toBe('skip_dup');
  });
  it('图上各出口的数字对得上', () => {
    const trace = detail.flow.nodes.find(node => node.id === 'trace');
    expect(Object.fromEntries(trace.outcomes.map(outcome => [outcome.id, outcome.count]))).toMatchObject({ found:2, none:1, noquota:1, noname:1 });
  });
});

describe('通知追溯：搜索用了哪个引擎、返回了什么', () => {
  const notice = (url, name) => ({ name, detailUrl:url, introduction:'', discovery:{} });
  const sfiles = {
    'baidu-candidates.json':{ candidates:[notice('https://n/1', 'A'), notice('https://n/2', 'B'), notice('https://n/3', 'C')] },
    'formal-notices.json':{ candidates:[notice('https://n/1', 'A'), notice('https://n/2', 'B'), notice('https://n/3', 'C')] },
    'jev-filter-report.json':{ decisions:['1', '2', '3'].map(i => ({ url:`https://n/${i}`, action:'trace', kind:'news_or_result', confidence:1, reason:'' })) },
    'notice-resolution-leads.json':{
      engines:[{ engine:'baidu', label:'百度', used:1, left:0, disabled:false, configured:true }, { engine:'kimi', label:'Kimi', used:1, left:14, disabled:false, configured:true }],
      results:[
        { noticeUrl:'https://n/1', noticeTitle:'A', proposedName:'A赛', followupQuery:'A赛 官网', notices:[{ url:'https://n/1' }], leads:[{ title:'官网', url:'https://o/1' }],
          search:{ engine:'baidu', label:'百度', query:'A赛 官网', returned:10, kept:1, results:[{ title:'官网', url:'https://o/1', kept:true }, { title:'别的', url:'https://o/2', kept:false }], attempts:[{ engine:'baidu', label:'百度', ok:true, returned:10 }] } },
        { noticeUrl:'https://n/2', noticeTitle:'B', proposedName:'B赛', followupQuery:'B赛 官网', notices:[{ url:'https://n/2' }], leads:[],
          search:{ engine:'kimi', label:'Kimi', query:'B赛 官网', returned:8, kept:0, results:[{ title:'x', url:'https://o/3', kept:false }], attempts:[{ engine:'baidu', label:'百度', ok:false, error:'http_429' }, { engine:'kimi', label:'Kimi', ok:true, returned:8 }] },
          searchAttempts:[{ engine:'baidu', label:'百度', ok:false, error:'http_429' }, { engine:'kimi', label:'Kimi', ok:true, returned:8 }] },
        { noticeUrl:'https://n/3', noticeTitle:'C', proposedName:'C赛', followupQuery:'C赛 官网', notices:[{ url:'https://n/3' }], leads:[], error:'百度：http_500；Kimi：http_500' },
      ] },
  };
  const detail = composeRunDetail('2026-09-28T17-00-00-614Z', sfiles);
  const traceStep = url => detail.rows.find(row => row.url === url).trail.find(item => item.n === 'trace');
  it('路径上写明用了哪个引擎、返回几条、保留几条', () => {
    expect(traceStep('https://n/1').note).toContain('用百度搜索，返回 10 条，保留 1 条');
    expect(traceStep('https://n/2')).toMatchObject({ o:'none' });
    expect(traceStep('https://n/2').note).toContain('用Kimi搜索，返回 8 条');
  });
  it('全部引擎失败时写明各自的错误，不当成“没找到”', () => {
    expect(traceStep('https://n/3').note).toContain('搜索失败：百度：http_500；Kimi：http_500');
  });
  it('通知表格带上搜索详情：返回的每一条和是否保留，换过引擎的带上失败记录', () => {
    const [first, second] = detail.notices;
    expect(first.search).toMatchObject({ label:'百度', returned:10, kept:1 });
    expect(first.search.results).toEqual([{ no:'1.1', title:'官网', url:'https://o/1', kept:true }, { no:'', title:'别的', url:'https://o/2', kept:false }]);
    expect(second.search.attempts.map(item => `${item.label}:${item.ok}`)).toEqual(['百度:false', 'Kimi:true']);
    expect(detail.searchEngines.map(item => item.label)).toEqual(['百度', 'Kimi']);
  });
});

describe('编号：最初的信息源逐条编号，追溯结果挂在发起追溯的那条下面', () => {
  const cand = (url, name) => ({ name, detailUrl:url, introduction:'', discovery:{} });
  const nfiles = {
    'baidu-candidates.json':{ dropped:[{ title:'搜索时丢弃', url:'https://d/0', reason:'out_of_scope', reasonText:'不在收录范围' }],
      candidates:[cand('https://n/1', '甲通知'), cand('https://n/2', '乙通知'), cand('https://n/3', '甲通知转发')] },
    'tianchi-candidates.json':{ candidates:[{ name:'天池赛', detailUrl:'https://t/1' }] },
    'formal-notices.json':{ candidates:[cand('https://n/1', '甲通知'), cand('https://n/2', '乙通知'), cand('https://n/3', '甲通知转发')] },
    'jev-filter-report.json':{ decisions:['1', '2', '3'].map(i => ({ url:`https://n/${i}`, action:'trace', kind:'news_or_result', confidence:1, reason:'' })) },
    'notice-resolution-leads.json':{ results:[
      { noticeUrl:'https://n/1', noticeTitle:'甲通知', proposedName:'甲赛', followupQuery:'甲赛 官网', notices:[{ url:'https://n/1' }, { url:'https://n/3' }],
        leads:[{ title:'官网A', url:'https://o/a' }, { title:'官网B', url:'https://o/b' }], search:{ engine:'baidu', label:'百度', returned:2, kept:2, results:[{ title:'官网A', url:'https://o/a', kept:true }, { title:'筛掉的', url:'https://o/x', kept:false }] } },
      { noticeUrl:'https://n/2', noticeTitle:'乙通知', proposedName:'乙赛', followupQuery:'乙赛 官网', notices:[{ url:'https://n/2' }], leads:[{ title:'官网C', url:'https://o/c' }] },
    ] },
    'notice-followup-filter-report.json':{ decisions:[
      { url:'https://o/b', title:'官网B', action:'review', kind:'competition_site', lowConfidence:true, reason:'低' },
      { url:'https://o/a', title:'官网A', action:'fetch', kind:'competition_site', confidence:0.9, reason:'' },
      { url:'https://o/c', title:'官网C', action:'fetch', kind:'competition_site', confidence:0.9, reason:'' },
    ] },
  };
  const detail = composeRunDetail('2026-09-28T17-00-00-614Z', nfiles);
  const no = url => detail.rows.find(row => row.url === url)?.no;
  it('最初的每一条信息源（含搜索时丢弃的）依次编一级编号', () => {
    expect(['https://d/0', 'https://n/1', 'https://n/2', 'https://n/3', 'https://t/1'].map(no)).toEqual(['1', '2', '3', '4', '5']);
  });
  it('追溯搜到的页面挂在发起追溯的那条下面：3.1、3.2；另一组 3 的下一条是 4.x 不会混', () => {
    // 甲通知是 2 号，乙通知是 3 号；同组的转发（4 号）不另搜，结果挂在 2 号下
    expect(no('https://o/a')).toBe('2.1');
    expect(no('https://o/b')).toBe('2.2');
    expect(no('https://o/c')).toBe('3.1');
  });
  it('表格按编号排：追溯结果紧跟在发起追溯的那条后面', () => {
    expect(detail.rows.map(row => row.no).filter(Boolean)).toEqual(['1', '2', '2.1', '2.2', '3', '3.1', '4', '5']);
  });
  it('通知这条的说明里写着追溯结果的编号，同组其他通知指向它', () => {
    const note = url => detail.rows.find(row => row.url === url).trail.find(item => item.n === 'trace').note;
    expect(note('https://n/1')).toContain('追溯结果编号：2.1、2.2');
    expect(note('https://n/3')).toContain('挂在 #2 下');
  });
  it('通知表和搜索结果里也带编号，保留的结果标出对应的追溯编号', () => {
    const first = detail.notices[0];
    expect(first.no).toBe('2');
    expect(first.leads.map(lead => lead.no)).toEqual(['2.1', '2.2']);
    expect(first.search.results.map(result => result.no)).toEqual(['2.1', '']);
  });
});

describe('固定来源抓取频率在明细里的说明', () => {
  it('这一轮没抓的固定来源：写明上次和下次的时间', () => {
    const detail = composeRunDetail('2026-09-28T17-00-00-614Z', { 'baidu-candidates.json':{ candidates:[] }, 'source-schedule.json':{ sources:[
      { source:'tianchi', ran:false, everyDays:7, lastCrawledAt:'2026-09-30T17:00:15Z', nextDueAt:'2026-10-07T17:00:15.000Z', reason:'本轮跳过' },
      { source:'baidu', ran:true, everyDays:0, reason:'每晚抓取' }] } });
    expect(detail.sourceSchedule).toEqual([
      { source:'天池', ran:false, everyDays:7, lastCrawledAt:'2026-09-30T17:00:15Z', nextDueAt:'2026-10-07T17:00:15.000Z', reason:'本轮跳过' },
      { source:'百度搜索', ran:true, everyDays:0, lastCrawledAt:null, nextDueAt:null, reason:'每晚抓取' },
    ]);
  });
  it('老的运行没有这个文件，也不报错', () => {
    expect(composeRunDetail('2026-09-28T17-00-00-614Z', { 'baidu-candidates.json':{ candidates:[] } }).sourceSchedule).toEqual([]);
  });
});

describe('读不了的站转追溯、标题没有信息量的路径', () => {
  const sfiles = {
    'baidu-candidates.json':{ candidates:[
      { name:'2026年9月27日 09:54广东', detailUrl:'https://mp.weixin.qq.com/s?mid=1', introduction:'举办2026年“强国杯”英语能力大赛。', discovery:{} },
      { name:'2026年9月25日 09:06广东', detailUrl:'https://mp.weixin.qq.com/s?mid=2', introduction:'x', discovery:{} },
    ] },
    'formal-notices.json':{ candidates:[{ name:'2026年“强国杯”英语能力大赛', detailUrl:'https://mp.weixin.qq.com/s?mid=1', introduction:'', discovery:{} }, { name:'2026年9月25日 09:06广东', detailUrl:'https://mp.weixin.qq.com/s?mid=2', introduction:'x', discovery:{} }] },
    'jev-filter-report.json':{ decisions:[
      { url:'https://mp.weixin.qq.com/s?mid=1', action:'trace', kind:'organizer_notice', unreadable:true, confidence:0.89, source:'jev', reason:'读不了' },
      { url:'https://mp.weixin.qq.com/s?mid=2', action:'trace', kind:'title_no_info', confidence:1, source:'rule', reason:'标题没有信息量' },
    ] },
    'notice-resolution-leads.json':{ results:[{ noticeUrl:'https://mp.weixin.qq.com/s?mid=1', noticeTitle:'x', proposedName:'强国杯英语能力大赛', followupQuery:'q', notices:[{ url:'https://mp.weixin.qq.com/s?mid=1' }], leads:[] }] },
  };
  const detail = composeRunDetail('2026-09-28T17-00-00-614Z', sfiles);
  const trail = url => detail.rows.find(row => row.url === url).trail.map(item => `${item.n}:${item.o}`);
  it('读不了的站：Jev 放行后转去追溯，不进读详情', () => {
    expect(trail('https://mp.weixin.qq.com/s?mid=1')).toEqual(expect.arrayContaining(['jev:unreadable', 'trace:none']));
    expect(trail('https://mp.weixin.qq.com/s?mid=1').some(item => item.startsWith('read:'))).toBe(false);
  });
  it('标题没有信息量：规则一步判成追溯线索，提不出赛事名的记为“没搜”', () => {
    expect(trail('https://mp.weixin.qq.com/s?mid=2')).toEqual(expect.arrayContaining(['rule:trace', 'trace:noname']));
    expect(detail.rows.find(row => row.url === 'https://mp.weixin.qq.com/s?mid=2').kind).toBe('标题没有信息量');
  });
});
