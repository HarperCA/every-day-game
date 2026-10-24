// 后台海报规则（2026-10-24）：和服务器 adminData/posterImage.js 一致
import { describe, expect, it } from 'vitest';
import { addCandidate, compressToLimit, isPosterRatio, MAX_CANDIDATES, POSTER_MAX_BYTES, removeCandidate } from '../apps/admin/src/posterRules';

const candidate = (file: string) => ({ file, width:1080, height:1920, bytes:1000, source:'manual' as const, sourceUrl:'', addedAt:'2026-10-24T00:00:00Z' });

describe('后台海报规则', () => {
  it('16:9 判断和服务器一样：1.76～1.79', () => {
    expect([isPosterRatio(1920, 1080), isPosterRatio(1919, 1080), isPosterRatio(1080, 1080), isPosterRatio(1800, 1000)]).toEqual([true, true, false, false]);
  });
  it('候选图片：同一张不重复加，最多 10 张，超出去掉最早的；可以删', () => {
    let list = addCandidate([], candidate('a'));
    list = addCandidate(list, candidate('a'));
    expect(list.map(item => item.file)).toEqual(['a']);
    for (let i = 0; i < 12; i++) list = addCandidate(list, candidate(`f${i}`));
    expect(list).toHaveLength(MAX_CANDIDATES);
    expect(list[0].file).toBe('f2');
    expect(removeCandidate(list, 'f5').map(item => item.file)).not.toContain('f5');
  });
  it('压缩：从 0.9 往下试，第一张不超过 60 KB 的就用；都超返回 null', async () => {
    const sizes: Record<string, number> = { '0.9':90000, '0.85':80000, '0.8':70000, '0.75':59000 };
    const tried: number[] = [];
    const result = await compressToLimit(async quality => { tried.push(quality); return new Blob([new Uint8Array(sizes[String(quality)] ?? 100)]); });
    expect(result?.quality).toBe(0.75);
    expect(tried).toEqual([0.9, 0.85, 0.8, 0.75]);
    expect(await compressToLimit(async () => new Blob([new Uint8Array(POSTER_MAX_BYTES + 1)]))).toBeNull();
  });
});
