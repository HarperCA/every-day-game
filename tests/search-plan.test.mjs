import { describe, expect, it } from 'vitest';
import { allocate, buildPlan, normalizeName, planGapQueries, planProbeQueries, planTraceTargets, queryBytes, updateCooldown, NOTICE_FOLLOWUP_CALLS } from '../scripts/server/search-plan.mjs';
import { nextTask, pickLeads } from '../scripts/server/trace-drafts.mjs';
import { queriesFromPlan } from '../scripts/server/search-baidu.mjs';

const now = new Date('2026-09-25T00:30:00+08:00');
const official = [{ url:'https://org.cn/notice', source_type:'organizer_notice', is_official:true, validity_status:'valid' }];

describe('次日搜索计划', () => {
  it('按 60/25/15 分配额度，合计等于总额度', () => {
    expect(allocate(45)).toEqual({ 追溯线索与主办方监测:27, 覆盖空白:11, 新词试探:7 });
    expect(Object.values(allocate(50)).reduce((a, b) => a + b, 0)).toBe(50);
  });

  it('追溯只挑缺当届官方原文的待办记录，按期限先后，冷却中的跳过，查询不超过接口长度', () => {
    const records = [
      { id:'a', name:'湖南省大学生统计建模大赛', dataStatus:'draft', ruleVersion:'hunan-directory-v1', sources:official },
      { id:'b', name:'测试竞赛', dataStatus:'draft', triage:{ bucket:'需要追溯', traceDue:'2026-10-08T23:59:59+08:00', traceTodo:'需取组委会原文' }, sources:official },
      { id:'c', name:'已发布竞赛', dataStatus:'published', sources:[] },
      { id:'d', name:'齐全竞赛', dataStatus:'pending_manual_review', sources:official, qualityIssues:[] },
      { id:'e', name:'冷却竞赛', dataStatus:'draft', sources:[], task:{ nextCheckAt:'2026-09-30T00:00:00Z' } },
      { id:'f', name:'很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长的竞赛名称', dataStatus:'draft', sources:[] },
    ];
    const targets = planTraceTargets(records, 10, now);
    expect(targets.map(t => t.recordId)).toEqual(['b', 'f', 'a']);
    expect(targets[0].reason).toContain('需取组委会原文');
    for (const t of targets) expect(queryBytes(t.query)).toBeLessThanOrEqual(72);
  });

  it('覆盖空白优先已发布最少的专业大类，同一大类最多两条，冷却中的查询跳过', () => {
    const records = Array.from({ length:5 }, (_, i) => ({ dataStatus:'published', professions:['计算机与AI'], id:String(i) }));
    const picked = planGapQueries(records, 11, { queries:{} }, now, 2026);
    expect(picked).toHaveLength(11);
    expect(picked.some(q => q.category === '计算机与AI')).toBe(false);
    const counts = picked.reduce((acc, q) => ({ ...acc, [q.category]:(acc[q.category] || 0) + 1 }), {});
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(2);
    const pausedQuery = picked[0].query;
    const again = planGapQueries(records, 11, { queries:{ [pausedQuery]:{ pausedUntil:'2026-10-01T00:00:00Z' } } }, now, 2026);
    expect(again.map(q => q.query)).not.toContain(pausedQuery);
  });

  it('新词只取立项目录里库中还没有的赛事，试过的不重复', () => {
    const records = [{ name:'湖南省大学生数学建模竞赛' }];
    const dir = [
      { name:'2026年湖南省大学生数学建模竞赛', org:'湖南第一师范学院', list:'湖南省' },
      { name:'湖南省大学生物理竞赛', org:'湖南大学', list:'湖南省' },
      { name:'江苏大学生创新大赛', org:'江苏省教育厅', list:'江苏省' },
    ];
    const picked = planProbeQueries(records, dir, 7, { queries:{} }, now);
    expect(picked.map(q => q.name)).toEqual(['湖南省大学生物理竞赛', '江苏大学生创新大赛']);
    const tried = planProbeQueries(records, dir, 7, { queries:{ [picked[0].query]:{ lastRunAt:'2026-09-20T00:00:00Z' } } }, now);
    expect(tried.map(q => q.name)).toEqual(['江苏大学生创新大赛']);
    expect(normalizeName('2026年第八届“测试杯”全国大学生设计大赛')).toBe('测试杯全国大学生设计');
  });

  it('新词先过收录范围：选拔赛、展演等非比赛标题不去试', async () => {
    const { createRequire } = await import('node:module');
    const { classifyCompetitionScope } = createRequire(import.meta.url)('../apps/miniprogram/cloudfunctions/adminData/competitionScope.js');
    const scopeOk = name => classifyCompetitionScope({ name, participants:'高等学校在校学生' }).decision !== 'reject';
    const dir = ['中美青年创客大赛（厦门站选拔赛）', '江苏省大学生艺术展演', '福建省大学生信息素养大赛'].map(name => ({ name, list:'测试' }));
    expect(planProbeQueries([], dir, 7, { queries:{} }, now, scopeOk).map(q => q.name)).toEqual(['福建省大学生信息素养大赛']);
  });

  it('追溯查询去掉括号说明并补上年份', () => {
    const [t] = planTraceTargets([{ id:'x', name:'湖南省大学生结构设计竞赛（与省住房和城乡建设厅联合主办）', dataStatus:'draft', sources:[] }], 1, now);
    expect(t.query).toBe('湖南省大学生结构设计竞赛 2026 通知 报名');
  });

  it('连续两次零候选开始暂停，冷却期逐次加倍，有产出即恢复', () => {
    let state = { queries:{} };
    state = updateCooldown(state, [{ query:'q', candidates:0 }], now);
    expect(state.queries.q.pausedUntil).toBeNull();
    state = updateCooldown(state, [{ query:'q', candidates:0 }], now);
    expect(Date.parse(state.queries.q.pausedUntil) - now.getTime()).toBe(2 * 86400000);
    state = updateCooldown(state, [{ query:'q', candidates:0 }], now);
    expect(Date.parse(state.queries.q.pausedUntil) - now.getTime()).toBe(4 * 86400000);
    state = updateCooldown(state, [{ query:'q', candidates:3 }], now);
    expect(state.queries.q).toMatchObject({ zeroStreak:0, pausedUntil:null });
  });

  it('整份计划不超额度，搜索脚本能读出查询和路线', () => {
    const records = Array.from({ length:40 }, (_, i) => ({ id:`r${i}`, name:`测试竞赛${i}`, dataStatus:'draft', sources:[] }));
    const plan = buildPlan({ records, directoryEntries:[{ name:'湖南省大学生物理竞赛', list:'湖南省' }], state:{ queries:{} }, now, budget:45 });
    expect(plan.trace.drafts).toHaveLength(27 - NOTICE_FOLLOWUP_CALLS);
    expect(NOTICE_FOLLOWUP_CALLS + plan.trace.drafts.length + plan.search.length + plan.unused).toBe(45);
    const queries = queriesFromPlan(plan);
    expect(queries.every(q => ['覆盖空白', '新词试探'].includes(q.route))).toBe(true);
    expect(queries.find(q => q.route === '新词试探').query).toContain('湖南省大学生物理竞赛');
  });
});

describe('记录追溯', () => {
  const record = { name:'湖南省大学生统计建模大赛', sources:[{ url:'https://old.edu.cn/a' }] };
  it('只收含赛事名主体、像通知或赛事页的结果，去掉已有来源', () => {
    const leads = pickLeads([
      { url:'https://old.edu.cn/a', title:'湖南省大学生统计建模大赛通知' },
      { url:'http://jyt.hunan.gov.cn/x', title:'关于举办2026年湖南省大学生统计建模大赛的通知', content:'' },
      { url:'https://news.com/y', title:'湖南新闻', content:'今日天气' },
      { url:'https://blog.com/z', title:'统计建模学习笔记', content:'湖南省大学生统计建模大赛 心得' },
    ], record, now);
    expect(leads.map(lead => lead.url)).toEqual(['http://jyt.hunan.gov.cn/x', 'https://blog.com/z']);
    expect(leads[0].status).toBe('待核验');
  });

  it('找到线索 7 天后复查；没找到按 2、4 天退避；搜索失败次日重试，不计空转', () => {
    const found = nextTask(record, { query:'q', leads:[{ url:'https://a' }] }, now);
    expect(found).toMatchObject({ attempts:1, emptyStreak:0, lastResult:'找到 1 条待核验线索' });
    expect(Date.parse(found.nextCheckAt) - now.getTime()).toBe(7 * 86400000);
    const empty1 = nextTask({ ...record, task:found }, { query:'q', leads:[] }, now);
    expect(Date.parse(empty1.nextCheckAt) - now.getTime()).toBe(2 * 86400000);
    const empty2 = nextTask({ ...record, task:empty1 }, { query:'q', leads:[] }, now);
    expect(Date.parse(empty2.nextCheckAt) - now.getTime()).toBe(4 * 86400000);
    const failed = nextTask({ ...record, task:empty2 }, { query:'q', leads:[], error:'http_500' }, now);
    expect(failed).toMatchObject({ attempts:4, emptyStreak:2 });
    expect(Date.parse(failed.nextCheckAt) - now.getTime()).toBe(86400000);
    expect(failed.leads).toHaveLength(1);
    expect(failed.firstAttemptAt).toBe(found.firstAttemptAt);
  });
});
