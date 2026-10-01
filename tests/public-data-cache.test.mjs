// 上海 publicData：保持运行（定时触发）和 60 秒缓存（2026-10-01）
import Module, { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const record = (id, status = 'published') => ({ _id:id, id, name:id, data_status:status, system_validation:'passed', manual_review:'passed',
  registration_start:'2026-11-01T00:00:00+08:00', registration_end:'2026-12-01T00:00:00+08:00', professions:['计算机与AI'], search_text:id });
const records = [record('edition-a'), record('edition-b', 'archived')];
const calls = { listReads:0, docReads:0, countWrites:0 };
const fakeDb = {
  command:{ in:value => value, inc:value => value },
  collection:name => ({
    where:() => ({ limit:() => ({ get:async () => { calls.listReads += 1; return { data:records }; } }) }),
    doc:id => ({
      get:async () => { calls.docReads += 1; return { data:records.find(item => item.id === id) || null }; },
      update:async () => { if (name === 'client_stats') calls.countWrites += 1; return { stats:{ updated:1 } }; },
      set:async () => undefined,
    }),
  }),
  createCollection:async () => undefined,
};
const fakeCloud = { init:() => undefined, DYNAMIC_CURRENT_ENV:'test', database:() => fakeDb };

const originalLoad = Module._load;
Module._load = function load(request, ...rest) { return request === 'wx-server-sdk' ? fakeCloud : originalLoad.call(this, request, ...rest); };
process.env.PUBLIC_CACHE_SECONDS = '60';
process.env.COUNT_LOADS = '1';
const { main } = require('../apps/miniprogram/cloudfunctions/publicData/index.js');
afterAll(() => { Module._load = originalLoad; delete process.env.PUBLIC_CACHE_SECONDS; delete process.env.COUNT_LOADS; });

describe('上海 publicData 的保持运行与缓存', () => {
  it('定时触发：刷新缓存、不算用户访问', async () => {
    const result = await main({ Type:'Timer', TriggerName:'keepWarm' });
    expect(result).toEqual({ ok:true, warmed:2 });
    expect(calls.listReads).toBe(1);
    expect(calls.countWrites).toBe(0);
  });
  it('60 秒内的列表请求直接用缓存，不再读数据库；访问照常计数', async () => {
    const first = await main({ action:'list', query:{} });
    const second = await main({ action:'list', query:{} });
    expect(first.ok && second.ok).toBe(true);
    expect(first.data.total).toBe(2);
    expect(calls.listReads).toBe(1);
    expect(calls.countWrites).toBe(2);
  });
  it('同一个查询的排序结果也缓存：结果相同，换了查询条件照样算', async () => {
    const one = await main({ action:'list', query:{ keyword:'edition-a' } });
    const two = await main({ action:'list', query:{ keyword:'edition-a' } });
    expect(two).toEqual(one);
    expect(one.data.total).toBe(1);
    expect((await main({ action:'list', query:{} })).data.total).toBe(2);
  });
  it('详情先在缓存里找，找到就不查数据库；找不到的照旧查数据库并返回“查无此条”', async () => {
    const hit = await main({ action:'get', id:'edition-a' });
    expect(hit.ok).toBe(true);
    expect(calls.docReads).toBe(0);
    const miss = await main({ action:'get', id:'edition-zzz' });
    expect(miss).toEqual({ ok:false, message:'public_record_not_found' });
    expect(calls.docReads).toBe(1);
  });
});
