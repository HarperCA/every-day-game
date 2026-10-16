import { describe, expect, it } from 'vitest';
import { summarizePipelineRuns, summarizePipelineRows } from '../apps/admin/src/pipelineStatistics.ts';

const run = (id, extras = {}) => ({ id, status:'completed', finishedAt:`2026-10-0${id}T01:00:00Z`,
  searchResults:10, newLeads:5, eligibleDiscovered:null, newRecords:null,
  qualifiedNew:null, publishedNew:null, publishedExisting:null, publishedTotal:null,
  existingEnriched:null, existingUpdated:null, extractionAttempted:0, extractionSucceeded:null,
  failures:[], ...extras });

describe('结果账汇总', () => {
  it('只加总唯一的完整轮次，并区分缺失与真实的零', () => {
    const summary = summarizePipelineRuns([
      run('1', { newRecords:2, publishedTotal:0, failures:[{stage:'admission',reason:'范围不符',count:2}] }),
      run('1', { newRecords:2, publishedTotal:0, failures:[{stage:'admission',reason:'范围不符',count:2}] }),
      run('2', { newRecords:null, failures:[{stage:'scope',reason:'范围不符',count:1}] }),
      run('3', { status:'dry_run', newRecords:99 }),
    ]);
    expect(summary.coverage).toMatchObject({totalRuns:3, completedRuns:2, excludedRuns:1});
    expect(summary.metrics.newRecords).toEqual({value:2, recordedRuns:1, missingRuns:1});
    expect(summary.metrics.publishedTotal).toEqual({value:0, recordedRuns:1, missingRuns:1});
    expect(summary.metrics.eligibleDiscovered).toEqual({value:null, recordedRuns:0, missingRuns:2});
    expect(summary.failures).toEqual([
      {stage:'admission',reason:'范围不符',count:2},
      {stage:'scope',reason:'范围不符',count:1},
    ]);
  });
});

const row = (...steps) => ({ trail:steps.map(([n, o, note = '']) => ({n, o, note})) });
describe('逐条最终去向汇总', () => {
  it('只把成功读取和抽取后被同名、范围或门槛拦下的线索算作未入库问题', () => {
    const rows = [
      row(['read','ok'],['extract','ok'],['same_name','exists','库里已有同名赛事「A」，来源已存在，不新增'],['end_scope','']),
      row(['read','ok'],['extract','ok'],['same_name','exists','库里已有同名赛事「B」，来源已存在，不新增'],['end_scope','']),
      row(['read','ok'],['extract','ok'],['scope','reject','非专业赛事'],['end_scope','']),
      row(['read','ok'],['extract','ok'],['gate','skip','门槛 reject'],['end_scope','']),
      row(['read','ok'],['extract','ok'],['gate','dry','试运行'],['end_scope','']),
      row(['read','fail','robots'],['end_readfail','']),
      row(['jev','lead'],['end_lead','']),
      row(['read','ok'],['extract','ok'],['gate','written'],['end_written','']),
    ];
    const summary = summarizePipelineRows(rows);
    expect(summary.totalRows).toBe(8);
    expect(summary.terminalCounts).toMatchObject({end_scope:5,end_readfail:1,end_lead:1,end_written:1});
    expect(summary.afterReadNotStored).toEqual({total:4,byProblem:[
      {stage:'same_name',reason:'库里已有同名赛事（来源已存在）',count:2},
      {stage:'gate',reason:'门槛 reject',count:1},
      {stage:'scope',reason:'非专业赛事',count:1},
    ]});
  });
});
