// 固定来源（天池、辽宁平台）每 7 天才抓一次；百度搜索每晚都跑
import { describe, expect, it } from 'vitest';
import { FIXED_SOURCE_INTERVAL_DAYS, checkDue, markCrawled } from '../scripts/server/source-schedule.mjs';

const at = iso => new Date(iso);

describe('固定来源抓取频率', () => {
  it('默认间隔是 7 天', () => {
    expect(FIXED_SOURCE_INTERVAL_DAYS).toBe(7);
  });
  it('没有抓取记录：本轮抓取', () => {
    expect(checkDue({}, 'tianchi', 7, at('2026-10-02T17:00:00Z'))).toMatchObject({ run:true, lastCrawledAt:null });
  });
  it('上次抓取之后不满 7 天：跳过，并给出下次的时间', () => {
    const state = { tianchi:{ lastCrawledAt:'2026-09-30T17:00:15Z' } };
    const due = checkDue(state, 'tianchi', 7, at('2026-10-02T17:00:00Z'));
    expect(due).toMatchObject({ run:false, nextDueAt:'2026-10-07T17:00:15.000Z' });
    expect(due.reason).toContain('本轮跳过');
  });
  it('满 7 天：抓取；定时器晚几秒、早几小时都不会被推迟一整周', () => {
    const state = { tianchi:{ lastCrawledAt:'2026-09-30T17:00:15Z' } };
    expect(checkDue(state, 'tianchi', 7, at('2026-10-07T17:00:00Z')).run).toBe(true);   // 比上次早 15 秒
    expect(checkDue(state, 'tianchi', 7, at('2026-10-07T17:00:30Z')).run).toBe(true);
    expect(checkDue(state, 'tianchi', 7, at('2026-10-06T17:00:00Z')).run).toBe(false);  // 才 6 天
  });
  it('百度搜索（没有间隔）每晚都抓', () => {
    expect(checkDue({ baidu:{ lastCrawledAt:'2026-10-01T17:00:00Z' } }, 'baidu', 0, at('2026-10-01T17:05:00Z')).run).toBe(true);
  });
  it('各来源互不影响；记录写入后立刻生效', () => {
    let state = markCrawled({}, 'tianchi', 'run-1', at('2026-10-01T17:00:00Z'));
    state = markCrawled(state, 'upln', 'run-1', at('2026-10-01T17:01:00Z'));
    expect(checkDue(state, 'tianchi', 7, at('2026-10-02T17:00:00Z')).run).toBe(false);
    expect(checkDue(state, 'upln', 7, at('2026-10-08T17:00:00Z')).run).toBe(true);
    expect(state.tianchi.runId).toBe('run-1');
  });
  it('记录损坏（时间不是日期）按没有记录处理，不会永远不抓', () => {
    expect(checkDue({ tianchi:{ lastCrawledAt:'坏的' } }, 'tianchi', 7, at('2026-10-02T17:00:00Z')).run).toBe(true);
  });
});
