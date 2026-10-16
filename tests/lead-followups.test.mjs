import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backfillLeadFollowups } from '../scripts/server/backfill-lead-followups.mjs';
import { dueReadFollowups, leadKey, loadLeadFollowups, recordJevLeads, recordReadOutcomes, recordRediscoveries, retryableReadFailure } from '../scripts/server/lead-followups.mjs';

const now = new Date('2026-10-04T00:00:00Z');
const candidate = { name:'某大学生设计竞赛', detailUrl:'https://www.example.org/contest', introduction:'赛事摘要' };
const empty = { version:1, entries:{} };

describe('抓取线索后续任务', () => {
  it('Jev 只留线索持久记录原因与次数，同样的线索不会自动重试', () => {
    const decision = { candidate, action:'lead', kind:'directory_lead', reason:'目录清单' };
    const first = recordJevLeads(empty, [decision], now);
    const second = recordJevLeads(first, [decision], new Date('2026-10-05T00:00:00Z'));
    expect(second.entries[leadKey(candidate.detailUrl)]).toMatchObject({
      status:'manual_review', followupType:'directory', reason:'目录清单', firstSeenAt:now.toISOString(), seenCount:2,
    });
    expect(dueReadFollowups(second, new Date('2026-10-30T00:00:00Z'))).toEqual([]);
    const rediscovered = recordRediscoveries(first, [candidate], new Date('2026-10-05T00:00:00Z'));
    expect(rediscovered.entries[leadKey(candidate.detailUrl)]).toMatchObject({ seenCount:2, kind:'directory_lead' });
  });

  it('机构和栏目归为信源待办，低置信度归为人工复核', () => {
    const state = recordJevLeads(empty, [
      { candidate, action:'lead', kind:'organization_lead', reason:'机构名称' },
      { candidate:{ ...candidate, detailUrl:'https://example.org/column' }, action:'lead', kind:'column_lead', reason:'栏目' },
      { candidate:{ ...candidate, detailUrl:'https://example.org/uncertain' }, action:'lead', kind:'competition_site', reason:'拿不准' },
    ], now);
    expect(Object.values(state.entries).map(item => item.followupType)).toEqual(['source', 'source', 'manual_review']);
  });

  it('详情读取失败下一轮重读，三次失败后停止自动重读，成功即清除', () => {
    const fail = [{ url:candidate.detailUrl, ok:false, status:'http_503' }];
    const first = recordReadOutcomes(empty, [candidate], fail, now);
    expect(dueReadFollowups(first, now)).toEqual([]);
    expect(dueReadFollowups(first, new Date('2026-10-05T00:00:00Z'))).toHaveLength(1);
    const second = recordReadOutcomes(first, [candidate], fail, new Date('2026-10-05T00:00:00Z'));
    expect(dueReadFollowups(second, new Date('2026-10-06T00:00:00Z'))).toEqual([]);
    expect(dueReadFollowups(second, new Date('2026-10-07T00:00:00Z'))).toHaveLength(1);
    const third = recordReadOutcomes(second, [candidate], fail, new Date('2026-10-07T00:00:00Z'));
    expect(third.entries[leadKey(candidate.detailUrl)]).toMatchObject({ status:'manual_review', readAttempts:3, nextRetryAt:null });
    expect(dueReadFollowups(third, new Date('2026-11-30T00:00:00Z'))).toEqual([]);
    const success = recordReadOutcomes(second, [candidate], [{ url:candidate.detailUrl, ok:true }], now);
    expect(success.entries).toEqual({});
  });

  it('robots 明确禁止抓取时不安排自动重试', () => {
    const state = recordReadOutcomes(empty, [candidate], [{ url:candidate.detailUrl, ok:false, status:'blocked_by_robots' }], now);
    expect(state.entries[leadKey(candidate.detailUrl)].status).toBe('manual_review');
    expect(dueReadFollowups(state, new Date('2026-10-30T00:00:00Z'))).toEqual([]);
  });

  it('AI 抽取失败不当成网页读取失败重试', () => {
    expect(retryableReadFailure('fetch_failed')).toBe(true);
    expect(retryableReadFailure('page_is_boilerplate')).toBe(true);
    expect(retryableReadFailure('ai_extract_empty_response')).toBe(false);
    const state = recordReadOutcomes(empty, [candidate], [{ url:candidate.detailUrl, ok:false, status:'ai_extract_empty_response' }], now);
    expect(state.entries[leadKey(candidate.detailUrl)]).toMatchObject({ status:'manual_review', readTerminal:true, readAttempts:1 });
  });

  it('历史 Jev 报告可回填且重复执行不会重复计数', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-followups-'));
    try {
      const runs = path.join(root, 'runs');
      const dir = path.join(runs, '2026-10-04T00-00-00-000Z');
      fs.mkdirSync(dir, { recursive:true });
      fs.writeFileSync(path.join(dir, 'baidu-candidates.json'), JSON.stringify({ candidates:[candidate] }));
      fs.writeFileSync(path.join(dir, 'jev-filter-report.json'), JSON.stringify({ createdAt:now.toISOString(), decisions:[
        { name:candidate.name, url:candidate.detailUrl, action:'lead', kind:'directory_lead', reason:'目录清单' },
        { name:'已经转入通知追溯', url:'https://example.org/notice', action:'lead', kind:'column_lead', reason:'栏目' },
      ] }));
      fs.writeFileSync(path.join(dir, 'formal-notices.json'), JSON.stringify({ candidates:[{ detailUrl:'https://example.org/notice' }] }));
      const queue = path.join(root, 'queue.json');
      backfillLeadFollowups(runs, queue);
      backfillLeadFollowups(runs, queue);
      expect(loadLeadFollowups(queue).entries[leadKey(candidate.detailUrl)]).toMatchObject({
        candidate, followupType:'directory', seenCount:1, observedRuns:['2026-10-04T00-00-00-000Z'],
      });
      expect(Object.keys(loadLeadFollowups(queue).entries)).toHaveLength(1);
    } finally { fs.rmSync(root, { recursive:true, force:true }); }
  });
});
