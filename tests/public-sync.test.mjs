// 公开赛事数据同步到上海云开发（2026-10-01）：只推有变化的；服务器这边下架的，上海也删；每天整体核对一次
import { describe, expect, it } from 'vitest';
import { hashOf, isPublic, planSync } from '../scripts/server/sync-public-cache.mjs';

const doc = (id, extra = {}) => ({ id, name:id, data_status:'published', system_validation:'passed', manual_review:'passed', ...extra });
const now = Date.parse('2026-10-01T03:00:00Z');

describe('公开数据同步计划', () => {
  it('只推公开的', () => {
    expect(isPublic(doc('a'))).toBe(true);
    expect(isPublic(doc('b', { manual_review:'pending' }))).toBe(false);
    expect(isPublic(doc('c', { data_status:'draft' }))).toBe(false);
  });
  it('第一次：全部推送，并整体核对', () => {
    const plan = planSync([doc('a'), doc('b')], {}, { now });
    expect(plan.upserts.map(d => d.id)).toEqual(['a', 'b']);
    expect(plan).toMatchObject({ prune:true, fullDue:true, keepIds:['a', 'b'] });
  });
  it('之后：没变化不发请求；只推改了的；删掉的在上海也删', () => {
    const a = doc('a'); const b = doc('b');
    const state = { hashes:{ a:hashOf(a), b:hashOf(b), gone:'x' }, lastFullAt:'2026-10-01T02:00:00Z' };
    const unchanged = planSync([a, b], { ...state, hashes:{ a:hashOf(a), b:hashOf(b) } }, { now });
    expect(unchanged.upserts).toHaveLength(0);
    expect(unchanged.prune).toBe(false);
    const changed = planSync([a, { ...b, name:'改名了' }], state, { now });
    expect(changed.upserts.map(d => d.id)).toEqual(['b']);
    expect(changed.removed).toEqual(['gone']);
    expect(changed.prune).toBe(true);
  });
  it('距上次整体核对超过一天：全部重推', () => {
    const a = doc('a');
    const plan = planSync([a], { hashes:{ a:hashOf(a) }, lastFullAt:'2026-09-29T00:00:00Z' }, { now });
    expect(plan).toMatchObject({ fullDue:true, prune:true });
    expect(plan.upserts).toHaveLength(1);
  });
});

describe('按大小分批', async () => {
  const { batchBySize } = await import('../scripts/server/sync-public-cache.mjs');
  it('每批不超过上限，顺序不变，一条不丢', () => {
    const docs = Array.from({ length:10 }, (_, i) => doc(`d${i}`, { body:'x'.repeat(300) }));
    const batches = batchBySize(docs, 1000);
    expect(batches.flat().map(d => d.id)).toEqual(docs.map(d => d.id));
    expect(batches.every(batch => Buffer.byteLength(JSON.stringify(batch)) <= 1000 + 50)).toBe(true);
    expect(batches.length).toBeGreaterThan(1);
  });
});

describe('保持运行的地址', () => {
  it('由同步地址换出 /public-data', async () => {
    const { warmEndpoint } = await import('../scripts/server/sync-public-cache.mjs');
    expect(warmEndpoint('https://env-123.ap-shanghai.app.tcloudbase.com/public-sync')).toBe('https://env-123.ap-shanghai.app.tcloudbase.com/public-data');
    expect(warmEndpoint('')).toBe('');
  });
});
