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
  it('AI 判为重复的，写明 AI 的理由，路径走“AI 判重跳过”', () => {
    expect(byUrl['https://a/1'].final).toContain('AI 裁决');
    expect(byUrl['https://a/1'].final).toContain('库里已有当前这一届');
    expect(byUrl['https://a/1'].thinking).toBe('比较了届次……');
    expect(byUrl['https://a/1'].trail.map(item => `${item.n}:${item.o}`)).toContain('dedupe:ai_skip');
  });
  it('AI 判为新一届的，路径走“AI 判为不同或新一届”继续往下', () => {
    expect(byUrl['https://a/4'].dup).toContain('AI 裁决');
    expect(byUrl['https://a/4'].trail.map(item => `${item.n}:${item.o}`)).toContain('dedupe:ai_new');
    expect(detail.flow.nodes.find(node => node.id === 'dedupe')).toBeTruthy();
  });
});
