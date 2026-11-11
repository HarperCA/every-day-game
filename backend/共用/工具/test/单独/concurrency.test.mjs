// 并发池：同时请求数不超过上限；同一网站的间隔不小于设定值；失败会重试；一条失败不影响其他条。
import { describe, expect, test } from 'vitest';
import { createPool } from '../../concurrency.mjs';
import { createBudget } from '../../budget.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('并发池', () => {
  test('同时最多 limit 个', async () => {
    const pool = createPool({ limit: 3 });
    let active = 0, peak = 0;
    const results = await pool.map(Array.from({ length: 12 }, (_, i) => i), async i => {
      active += 1; peak = Math.max(peak, active); await wait(10); active -= 1; return i * 2;
    });
    expect(peak).toBe(3);
    expect(results.map(r => r.value)).toEqual(Array.from({ length: 12 }, (_, i) => i * 2));
  });

  test('同一网站之间至少间隔 perHostGapMs，不同网站不受影响', async () => {
    const pool = createPool({ limit: 4, perHostGapMs: 60 });
    const starts = { a: [], b: [] };
    await pool.map(['a', 'a', 'a', 'b'], async host => { starts[host].push(Date.now()); }, { hostOf: host => host });
    const gaps = starts.a.slice(1).map((t, i) => t - starts.a[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(55);
    expect(starts.b[0] - starts.a[0]).toBeLessThan(40);
  });

  test('失败重试；重试完仍失败的单独记失败，其他条照常成功', async () => {
    const pool = createPool({ limit: 2, retries: 2, retryDelayMs: 1 });
    const tries = {};
    const results = await pool.map(['ok', 'flaky', 'bad'], async (key, _, attempt) => {
      tries[key] = attempt + 1;
      if (key === 'flaky' && attempt < 1) throw new Error('429 请求太多');
      if (key === 'bad') throw new Error('一直失败');
      return key;
    });
    expect(results.map(r => r.ok)).toEqual([true, true, false]);
    expect(tries).toEqual({ ok: 1, flaky: 2, bad: 3 });
  });

  test('停止信号：还没开始的任务直接取消', async () => {
    const controller = new AbortController();
    const pool = createPool({ limit: 1, signal: controller.signal });
    let started = 0;
    const pending = pool.map([1, 2, 3], async () => { started += 1; await wait(30); });
    await wait(5);
    controller.abort(new Error('整晚被停下'));
    const results = await pending;
    expect(started).toBe(1);
    expect(results.filter(r => !r.ok).length).toBe(2);
  });
});

describe('额度', () => {
  test('用完就返回 false，剩余正确', () => {
    const budget = createBudget({ baidu: 2 });
    expect(budget.use('baidu')).toBe(true);
    expect(budget.use('baidu')).toBe(true);
    expect(budget.use('baidu')).toBe(false);
    expect(budget.left('baidu')).toBe(0);
    expect(budget.left('deepseek')).toBe(Infinity);
  });
});
