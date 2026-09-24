import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { toCandidate } from '../scripts/server/search-baidu.mjs';
import { followupCandidatesFromReport } from '../scripts/server/resolve-notice-leads.mjs';
import { stampDiscovery } from '../scripts/server/discovery.mjs';
import { buildMetrics, buildRouteLedger, runDirTime } from '../scripts/server/route-ledger.mjs';

const require = createRequire(import.meta.url);
const { candidateToRecord } = require('../apps/miniprogram/cloudfunctions/adminData/candidateToRecord.js');

describe('来源链：查询词/路线 → 网址 → 记录', () => {
  it('搜索结果带着查询词和路线一路进入记录', () => {
    const candidate = stampDiscovery(toCandidate({ url:'https://contest.org/2026', title:'全国大学生测试设计竞赛', content:'' }, '2026 大学生 测试 竞赛'), 'baidu', 'run-1');
    const record = candidateToRecord(candidate, null);
    expect(record.discovery).toEqual({ route:'覆盖空白', query:'2026 大学生 测试 竞赛', source:'百度AI搜索', runId:'run-1', url:'https://contest.org/2026', noticeUrl:null });
  });

  it('通知追溯候选记下追溯查询、原通知以及原通知的来源', () => {
    const [candidate] = followupCandidatesFromReport({ results:[{
      noticeUrl:'https://school.edu/notice', noticeTitle:'关于举办全国大学生结构设计竞赛的通知', followupQuery:'全国大学生结构设计竞赛 官网',
      noticeDiscovery:{ route:'覆盖空白', query:'2026 土木 竞赛', source:'baidu' }, proposedName:'全国大学生结构设计竞赛',
      leads:[{ title:'赛事官网', url:'https://contest.org/home' }],
    }] });
    const stamped = stampDiscovery(candidate, '通知追溯', 'run-2');
    expect(stamped.discovery).toMatchObject({ route:'追溯线索与主办方监测', query:'全国大学生结构设计竞赛 官网', runId:'run-2',
      via:{ noticeUrl:'https://school.edu/notice', discovery:{ query:'2026 土木 竞赛' } } });
  });

  it('平台抓取归入追溯与监测路线；候选没有来源时记录写 null，不编造', () => {
    expect(stampDiscovery({ name:'x' }, 'tianchi', 'run-3').discovery).toEqual({ route:'追溯线索与主办方监测', source:'tianchi', runId:'run-3' });
    expect(candidateToRecord({ externalId:'manual-1', name:'全国大学生测试竞赛', detailUrl:'https://contest.org' }, null).discovery).toBeNull();
  });
});

describe('路线台账', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  const status = record => record.status;
  const rec = (route, query, dataStatus, statusText, firstSeenAt = '2026-10-10T00:00:00Z') => ({ dataStatus, status:statusText, firstSeenAt, discovery:{ route, query } });

  it('合格新增只算已发布和已归档，报名中与即将报名加倍；待审单列', () => {
    const records = [
      rec('覆盖空白', 'q1', 'published', '报名中'),
      rec('覆盖空白', 'q1', 'archived', '已截止'),
      rec('覆盖空白', 'q1', 'pending_manual_review', '报名中'),
      rec('覆盖空白', 'q2', 'quarantined', '报名中'),
      rec('覆盖空白', 'q1', 'published', '报名中', '2026-08-01T00:00:00Z'),
      { dataStatus:'published', firstSeenAt:'2026-10-10T00:00:00Z' },
    ];
    const runs = [{ time:Date.parse('2026-10-09T17:00:00Z'),
      baidu:{ perQuery:[{ query:'q1', route:'覆盖空白' }, { query:'q2', route:'覆盖空白' }, { query:'q3', route:'覆盖空白' }], failures:[{ query:'q3' }] },
      noticeLeads:{ results:[{ followupQuery:'t1' }, { followupQuery:'t2', error:'http_429' }] } }];
    const ledger = buildRouteLedger(records, runs, { now, registrationStatus:status });
    expect(ledger.routes.find(r => r.route === '覆盖空白')).toMatchObject({ calls:2, discovered:4, qualified:2, qualifiedOpen:1, score:3, pending:1, failed:1, scorePerCall:1.5 });
    expect(ledger.routes.find(r => r.route === '追溯线索与主办方监测').calls).toBe(1);
    expect(ledger.queries.find(q => q.query === 'q1')).toMatchObject({ calls:1, score:3 });
  });

  it('解析运行目录名', () => {
    expect(runDirTime('2026-09-24T04-24-19-472Z')).toBe(Date.parse('2026-09-24T04:24:19.472Z'));
    expect(runDirTime('probe')).toBeNaN();
  });
});

describe('处理任务指标', () => {
  it('转化、卡住天数、发布耗时与每条合格的搜索次数', () => {
    const now = new Date('2026-10-20T00:00:00Z');
    const since = now.getTime() - 28 * 86400000;
    const records = [
      { dataStatus:'published', firstSeenAt:'2026-10-01T00:00:00Z', publishedAt:'2026-10-05T00:00:00Z' },
      { dataStatus:'draft', firstSeenAt:'2026-10-10T00:00:00Z' },
      { dataStatus:'pending_manual_review', firstSeenAt:'2026-10-18T00:00:00Z' },
      { dataStatus:'archived', firstSeenAt:'2026-08-01T00:00:00Z', task:{ firstAttemptAt:'2026-10-02T00:00:00Z' } },
    ];
    const runs = [{ time:Date.parse('2026-10-09T00:00:00Z'), baidu:{ perQuery:[{ query:'a' }, { query:'b' }] }, traceDrafts:{ results:[{ query:'t' }, { query:'s', skipped:'额度' }] }, jev:{ costUsd:0.01 } }];
    records[0].discovery = { route:'覆盖空白' };
    records[1].curationBatch = 'manual';
    expect(buildMetrics(records, runs, { now, since })).toEqual({
      byOrigin:{
        自动发现:{ entered:1, qualified:1, conversion:1, publishDaysMedian:4 },
        人工整理:{ entered:1, qualified:0, conversion:0, publishDaysMedian:null },
        '早期记录（无来源链）':{ entered:1, qualified:0, conversion:0, publishDaysMedian:null },
        记录追溯:{ entered:1, qualified:1, conversion:1, publishDaysMedian:null },
      },
      entered:4, qualified:2, conversion:0.5, pendingNow:2, pendingDaysAverage:6, pendingDaysMedian:2,
      publishDaysMedian:4, publishedInWindow:1, searchCalls:3, automatedQualified:2, searchCallsPerQualified:1.5, jevUsd:0.01, extractionUsd:null,
    });
  });
});
