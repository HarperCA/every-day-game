import { afterEach, describe, expect, it, vi } from 'vitest';
import { Fetcher } from '../scripts/crawler/lib/fetcher.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
// 流水线部署时 crawler/ 会同步到同级；本地只执行无副作用的校验函数。
const pipelineSource = fs.readFileSync(new URL('../scripts/server/run-crawl-pipeline.mjs', import.meta.url), 'utf8');
const validationSource = pipelineSource.match(/export function validateBootstrap[\s\S]*?\n}/)[0].replace('export ', '');
const validateBootstrap = vm.runInNewContext(`(${validationSource})`);

afterEach(() => vi.unstubAllGlobals());
describe('crawler failure handling', () => {
  it('does not retain transient HTTP errors in the successful page cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status:503, headers:{ 'content-type':'text/html' } })));
    const crawler = new Fetcher({ perHostDelayMs:0 });
    crawler.loadRobots = async () => '';
    crawler.writeCache = vi.fn();
    expect((await crawler.getDirect('https://example.com/contest')).status).toBe('http_503');
    expect(crawler.writeCache).not.toHaveBeenCalled();
  });
  it('keeps a successful page usable even if the cache disk write fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('contest', { headers:{ 'content-type':'text/html' } })));
    const crawler = new Fetcher({ perHostDelayMs:0 });
    crawler.loadRobots = async () => '';
    crawler.writeCache = async () => { throw new Error('disk full'); };
    const result = await crawler.getDirect('https://example.com/contest');
    expect(result.status).toBe('ok');
    expect(result.text).toBe('contest');
    expect(crawler.stats.cacheErrors).toBe(1);
  });
  it('refuses malformed or rejected snapshots instead of deduplicating against an empty database', () => {
    for (const snapshot of [{ ok:false, data:{ records:[] } }, { ok:true, data:{} }, { ok:true, data:{ records:{} } }]) {
      expect(() => validateBootstrap(snapshot)).toThrow('bootstrap');
    }
    expect(() => validateBootstrap({ ok:true, data:{ records:[] } }, false)).toThrow('bootstrap');
    expect(validateBootstrap({ ok:true, data:{ records:[] } })).toEqual([]);
  });
});
