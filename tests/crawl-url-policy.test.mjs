import { it, expect } from 'vitest';
import { normalizeCrawlUrl, readLimitedBody } from '../scripts/crawler/lib/urlPolicy.mjs';
it('removes trackers without removing region, language or pagination', () => {
  expect(normalizeCrawlUrl('https://example.com/a?utm_source=x&lang=zh&region=cn&page=2#top')).toBe('https://example.com/a?lang=zh&region=cn&page=2');
  expect(normalizeCrawlUrl('https://example.com/a?sig=abc&utm_source=x')).toContain('utm_source=x');
  expect(() => normalizeCrawlUrl('file:///tmp/a')).toThrow();
});
it('limits both declared size and chunked bodies', async () => {
  await expect(readLimitedBody(new Response('abc', {headers:{'content-length':'100'}}), 2)).rejects.toThrow('too_large');
  await expect(readLimitedBody(new Response('abc'), 2)).rejects.toThrow('too_large');
  expect((await readLimitedBody(new Response('abc'), 3)).toString()).toBe('abc');
});
