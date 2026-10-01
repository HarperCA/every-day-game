// 小程序访问异常（2026-10-01）：上报清洗、后台汇总的成功率、服务器拉取游标
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { nextCursor } from '../scripts/server/pull-client-logs.mjs';

const require = createRequire(import.meta.url);
const { sanitizeEvents } = require('../apps/miniprogram/cloudfunctions/clientLog/sanitize.js');
const { aggregateClientIssues } = require('../apps/miniprogram/cloudfunctions/adminData/clientIssues.js');

describe('上海 clientLog 收到上报时的清洗', () => {
  const at = '2026-10-01T03:00:00.000Z';
  it('只收认识的类型、只留白名单字段、逐个截断', () => {
    const [item, ...rest] = sanitizeEvents([
      { id:'abc123-xyz', kind:'load_failed', at, page:'pages/index/index', message:'x'.repeat(500), elapsedMs:12345.6, networkType:'4g', ip:'1.2.3.4', openid:'secret' },
      { kind:'hack' },
      null,
    ], at);
    expect(rest).toHaveLength(0);
    expect(item).toMatchObject({ kind:'load_failed', client_id:'abc123-xyz', page:'pages/index/index', elapsed_ms:12346, networkType:'4g', received_at:at });
    expect(item.message).toHaveLength(300);
    expect(item).not.toHaveProperty('ip');
    expect(item).not.toHaveProperty('openid');
  });
  it('一次最多 20 条', () => {
    expect(sanitizeEvents(Array.from({ length:30 }, () => ({ kind:'slow' })), at)).toHaveLength(20);
  });
});

describe('后台访问异常汇总', () => {
  const now = new Date('2026-10-01T06:00:00Z'); // 北京时间 10-01 14:00
  it('成功率 =（上海成功 + 退回美国成功）÷（再加上两边都失败）', () => {
    const report = aggregateClientIssues([
      { kind:'cloud_fallback', at:'2026-10-01T01:00:00Z', networkType:'4g', action:'publicData.list' },
      { kind:'load_failed', at:'2026-10-01T02:00:00Z', networkType:'4g', action:'publicData.list' },
      { kind:'slow', at:'2026-10-01T02:30:00Z', networkType:'wifi', action:'publicData.get' },
      { kind:'load_failed', at:'2026-09-01T02:00:00Z' }, // 超出范围
    ], [{ date:'2026-10-01', list:7, get:1 }], { days:1, now });
    expect(report.daily).toHaveLength(1);
    expect(report.daily[0]).toMatchObject({ date:'2026-10-01', shanghaiOk:8, fallback:1, failed:1, slow:1, attempts:10 });
    expect(report.daily[0].successRate).toBeCloseTo(0.9);
    expect(report.byNetwork).toEqual({ '4g':2, wifi:1 });
    expect(report.recent.map(item => item.kind)).toEqual(['slow', 'load_failed', 'cloud_fallback']);
  });
  it('按北京时间分天：UTC 前一天 17 点之后算第二天', () => {
    const report = aggregateClientIssues([{ kind:'load_failed', at:'2026-09-30T17:30:00Z' }], [], { days:2, now });
    expect(report.daily.find(day => day.date === '2026-10-01').failed).toBe(1);
  });
  it('没有任何数据时成功率显示为空，而不是 0% 或 100%', () => {
    expect(aggregateClientIssues([], [], { days:3, now }).summary.successRate).toBeNull();
  });
});

describe('服务器拉取游标', () => {
  it('同一时刻的记录用“大于等于”重拉时按 id 去重，不重复也不漏', () => {
    const page = [
      { _id:'a', received_at:'2026-10-01T01:00:00.000Z' },
      { _id:'b', received_at:'2026-10-01T02:00:00.000Z' },
      { _id:'c', received_at:'2026-10-01T02:00:00.000Z' },
    ];
    const { fresh, since } = nextCursor(page, '2026-10-01T00:00:00.000Z', new Set(['a']));
    expect(fresh.map(item => item._id)).toEqual(['b', 'c']);
    expect(since).toBe('2026-10-01T02:00:00.000Z');
  });
});
