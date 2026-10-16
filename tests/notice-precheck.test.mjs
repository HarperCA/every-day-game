import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { evidenceHolds, extractContestNames, precheckNotices } from '../scripts/server/notice-precheck.mjs';
import { matchCandidate, regionsOf } from '../scripts/crawler/lib/dedupe.mjs';

const require = createRequire(import.meta.url);
const { composeRunDetail } = require('../apps/miniprogram/cloudfunctions/adminData/pipelineRunDetail.js');

const tiaozhanbei = { name:'计算机与人工智能学院关于举办巢湖学院第十二届“挑战杯”大学生课外学术科技作品竞赛院级选拔赛的通知', detailUrl:'https://chu.edu.cn/n/1', introduction:'' };
const math = { name:'教科成果', detailUrl:'https://sci.cau.edu.cn/col', introduction:'我院学子在全国大学生数学竞赛中获一等奖' };
const tea = { name:'关于2026年“百岳杯”四川省大学生茶学技能大赛的通知', detailUrl:'https://yyx.sicau.edu.cn/1', introduction:'' };
const tea2 = { ...tea, name:'关于2026年“百岳杯”四川省大学生茶学技能大赛的第二轮通知', detailUrl:'https://yyx.sicau.edu.cn/2' };
const life = { name:'关于举办2026年安徽省大学生生命科学竞赛（生物标本制作赛道）校内选拔赛的通知', detailUrl:'https://aqnu.edu.cn/3', introduction:'' };

const masters = [
  { id:'ev-tzb', standard_name:'“挑战杯”全国大学生课外学术科技作品竞赛', aliases:[], sourceUrls:['https://www.tiaozhanbei.net/'], recordIds:['r-tzb-2026'] },
  { id:'ev-math', standard_name:'全国大学生数学竞赛', aliases:[], sourceUrls:['https://www.cmathc.org.cn/'], recordIds:['r-math-2025'] },
  { id:'ev-culsc', standard_name:'全国大学生生命科学竞赛（CULSC）', aliases:[], sourceUrls:[], recordIds:['r-culsc'] },
];
const recordsById = new Map([
  ['r-tzb-2026', { id:'r-tzb-2026', dataStatus:'published', editionName:'第十九届' }],
  ['r-math-2025', { id:'r-math-2025', dataStatus:'archived', editionName:'第十七届' }],
  ['r-culsc', { id:'r-culsc', dataStatus:'published' }],
]);

describe('追溯前查库：认出的名字要有原文依据', () => {
  it('片段在标题或摘要里、且比赛主体词大部分出现才算', () => {
    expect(evidenceHolds(tiaozhanbei, { name:'“挑战杯”全国大学生课外学术科技作品竞赛', evidence:'第十二届“挑战杯”大学生课外学术科技作品竞赛' })).toBe(true);
    expect(evidenceHolds(math, { name:'全国大学生数学竞赛', evidence:'全国大学生数学竞赛中获一等奖' })).toBe(true);
    expect(evidenceHolds(math, { name:'全国大学生数学竞赛', evidence:'中国数学会主办的数学竞赛' })).toBe(false);
    expect(evidenceHolds(math, { name:'全国大学生物理竞赛', evidence:'全国大学生数学竞赛' })).toBe(false);
  });
});

describe('追溯前查库：哪些不派代理', () => {
  const names = new Map([
    [0, { name:'“挑战杯”全国大学生课外学术科技作品竞赛', evidence:'第十二届“挑战杯”大学生课外学术科技作品竞赛' }],
    [1, { name:'全国大学生数学竞赛', evidence:'全国大学生数学竞赛中获一等奖' }],
    [2, { name:'“百岳杯”四川省大学生茶学技能大赛', evidence:'“百岳杯”四川省大学生茶学技能大赛' }],
    [3, { name:'“百岳杯”四川省大学生茶学技能大赛', evidence:'“百岳杯”四川省大学生茶学技能大赛' }],
    [4, { name:'安徽省大学生生命科学竞赛', evidence:'安徽省大学生生命科学竞赛' }],
  ]);
  const notices = [tiaozhanbei, math, tea, tea2, life, { name:'讲座通知', detailUrl:'https://x.edu.cn/5' }];
  const result = precheckNotices(notices, names, { masters, recordsById, match:matchCandidate });
  it('库里已有的跳过（含已归档，和代理之后的判重一致）；另一层级、认不出的照常追溯；同一晚同名只追一次', () => {
    expect(result.skipped.map(item => [item.title.slice(0, 12), item.kind])).toEqual([[tiaozhanbei.name.slice(0, 12), 'in_library'], [math.name, 'in_library'], [tea2.name.slice(0, 12), 'same_night']]);
    expect(result.toTrace.map(item => item.detailUrl)).toEqual([tea.detailUrl, life.detailUrl, 'https://x.edu.cn/5']);
    expect(result.skipped[0].matched).toMatchObject({ id:'ev-tzb', records:[{ id:'r-tzb-2026', dataStatus:'published' }] });
    expect(result.skipped[1].reason).toContain('archived');
    expect(result.checked.find(item => item.url === life.detailUrl).result).toBe('same_event_other_tier');
  });
});

describe('追溯前查库：认错比赛的防护', () => {
  it('标题写了比赛的，拿标题核对名字：摘要里顺带提到的别的比赛不算（2026-10-12 实测）', () => {
    const beijing = { name:'关于举办第十三届北京市大学生生物学竞赛的通知', detailUrl:'https://bj.edu.cn/1', introduction:'本届竞赛由北京市教育委员会主办……曾获第十二届全国大学生生命科学竞赛(科学探究类)一等奖' };
    const names = new Map([[0, { name:'全国大学生生命科学竞赛', evidence:'第十二届全国大学生生命科学竞赛(科学探究类)' }]]);
    const result = precheckNotices([beijing], names, { masters, recordsById, match:matchCandidate, regions:regionsOf });
    expect(result.skipped).toEqual([]);
    expect(result.checked[0].result).toBe('evidence_mismatch');
  });
  it('片段写某省的比赛、认成全国比赛的，地区层级对不上，照常追溯', () => {
    const notice = { name:'学院新闻', detailUrl:'https://x.edu.cn/9', introduction:'我院学子在北京市大学生生命科学竞赛中获奖' };
    const names = new Map([[0, { name:'全国大学生生命科学竞赛', evidence:'北京市大学生生命科学竞赛' }]]);
    const result = precheckNotices([notice], names, { masters, recordsById, match:matchCandidate, regions:regionsOf });
    expect(result.checked[0].result).toBe('level_conflict');
  });
});

describe('追溯前查库：真实标题不该被误挡（2026-10-12 实测）', () => {
  const cases = [
    [{ name:'关于2026年“百岳杯”四川省大学生茶学技能大赛的通知', introduction:'四川省教育厅决定举办2026年四川省大学生茶学技能大赛' }, '四川省大学生茶学技能大赛', '四川省教育厅决定举办2026年四川省大学生茶学技能大赛'],
    [{ name:'关于举行2026年湖南省大学生工业设计大赛--长沙学院校内选拔赛的通知' }, '湖南省大学生工业设计大赛', '2026年湖南省大学生工业设计大赛--长沙学院校内选拔赛'],
    [{ name:'CCF SAC2026第二届全国大学生智慧农业大赛' }, '全国大学生智慧农业大赛', 'CCF SAC2026第二届全国大学生智慧农业大赛'],
    [{ name:'学院新闻', introduction:'我院师生在全国大学生土地资源实践创新大赛估价赛道中斩获佳绩' }, '全国大学生土地资源实践创新大赛', '我院师生在全国大学生土地资源实践创新大赛估价赛道中斩获佳绩'],
  ];
  it.each(cases)('%#', (notice, name, evidence) => {
    const result = precheckNotices([{ detailUrl:'https://x.cn/1', ...notice }], new Map([[0, { name, evidence }]]), { masters:[], match:matchCandidate, regions:regionsOf });
    expect(result.checked[0].result).toBe('new');
  });
});

describe('追溯前查库：认名字的调用', () => {
  it('按批调用、关掉思考、只认本批编号；失败重试一次，仍失败的照常追溯', async () => {
    const bodies = [];
    let call = 0;
    const fetchImpl = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      call += 1;
      if (call >= 2) return { ok:false, status:500, json:async () => ({ error:'boom' }) };
      return { ok:true, status:200, json:async () => ({ choices:[{ message:{ content:JSON.stringify({ items:[{ i:0, name:'全国大学生数学竞赛', evidence:'全国大学生数学竞赛' }, { i:99, name:'越界' }] }) } }] }) };
    };
    const logs = [];
    const names = await extractContestNames([math, tea, life], { key:'k', fetchImpl, batchSize:2, log:line => logs.push(line) });
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toMatchObject({ model:'deepseek-flash', thinking:{ type:'disabled' }, response_format:{ type:'json_object' } });
    expect([...names.keys()]).toEqual([0]);
    expect(logs[0]).toContain('第 3～3 篇认名字失败');
    expect((await extractContestNames([math], { key:'' })).size).toBe(0);
  });
});

describe('后台明细显示追溯前查库', () => {
  it('跳过的通知走“追溯前查库”到“找到后筛选不读”', () => {
    const url = tiaozhanbei.detailUrl;
    const detail = composeRunDetail('2026-10-12T17-00-00-000Z', {
      'baidu-candidates.json':{ candidates:[{ name:tiaozhanbei.name, detailUrl:url }] },
      'jev-filter-report.json':{ decisions:[{ name:tiaozhanbei.name, url, action:'trace', kind:'repost_or_school_selection', source:'rule', reason:'校内选拔' }] },
      'formal-notices.json':{ candidates:[tiaozhanbei] },
      'notice-precheck.json':{ skipped:[{ url, title:tiaozhanbei.name, name:'“挑战杯”全国大学生课外学术科技作品竞赛', kind:'in_library', matched:{ name:'“挑战杯”全国大学生课外学术科技作品竞赛' }, reason:'库里已有当届' }] },
    });
    const row = detail.rows.find(item => item.url === url);
    expect(row.final).toContain('追溯前查库：库里已有');
    expect(row.trail.map(item => `${item.n}:${item.o}`)).toEqual(expect.arrayContaining(['trace:known', 'end_trace_skip:']));
  });
});
