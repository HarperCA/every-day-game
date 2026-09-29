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
    expect(byUrl['https://a/2']).toMatchObject({ final:'前置筛选拦截', kind:'转载或校内选拔', filter:'拦截' });
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
