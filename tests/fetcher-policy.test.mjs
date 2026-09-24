import { it, expect, vi, afterEach } from 'vitest';
import { Fetcher } from '../scripts/crawler/lib/fetcher.mjs';
afterEach(() => vi.unstubAllGlobals());
it('checks robots again before following a redirect', async () => {
  const fetch = vi.fn(async url => {
    if (url === 'https://a.example/robots.txt') return new Response('User-agent: *\nAllow: /');
    if (url === 'https://a.example/page') return new Response(null, {status:302,headers:{location:'https://b.example/private'}});
    if (url === 'https://b.example/robots.txt') return new Response('User-agent: *\nDisallow: /private');
    throw new Error('must not fetch disallowed page');
  });
  vi.stubGlobal('fetch', fetch);
  expect((await new Fetcher({perHostDelayMs:0}).get('https://a.example/page')).status).toBe('blocked_by_robots');
  expect(fetch).toHaveBeenCalledTimes(3);
});
it('rejects media at response headers, but allows official PDF attachments', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => url.endsWith('robots.txt') ? new Response('') : new Response('abc', {headers:{'content-type':url.endsWith('.pdf') ? 'application/pdf' : 'video/mp4'}})));
  const crawler = new Fetcher({perHostDelayMs:0});
  expect((await crawler.get('https://a.example/a.mp4')).status).toBe('unsupported_type');
  expect((await crawler.get('https://a.example/a.pdf')).isBinary).toBe(true);
});
