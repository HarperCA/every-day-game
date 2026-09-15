import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isAllowed, parseGroups, pickGroup } = require('../apps/miniprogram/cloudfunctions/adminData/robots.js');

const UA = 'competition-review/1.0 (+admin source verification)';

// 取自 2026.tiaozhanbei.net 的真实 robots.txt（节选）
const tiaozhanbei = `
User-agent: Googlebot
Allow: /

User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: *
Disallow: /project/
Disallow: /project/list/
`;

const blockAll = `
User-agent: *
Disallow: /
`;

describe('robots.txt', () => {
  it('falls back to the * group for an unnamed crawler', () => {
    expect(isAllowed(tiaozhanbei, UA, '/')).toBe(true);
    expect(isAllowed(tiaozhanbei, UA, '/notice/123.html')).toBe(true);
    expect(isAllowed(tiaozhanbei, UA, '/project/list/')).toBe(false);
  });

  it('honours a site that disallows every crawler', () => {
    expect(isAllowed(blockAll, UA, '/')).toBe(false);
    expect(isAllowed(blockAll, UA, '/anything')).toBe(false);
  });

  it('applies named rules when the user agent matches', () => {
    expect(isAllowed(tiaozhanbei, 'GPTBot/1.0', '/')).toBe(false);
    expect(isAllowed(tiaozhanbei, 'Googlebot/2.1', '/project/list/')).toBe(true);
  });

  it('treats an empty or missing robots.txt as unrestricted', () => {
    expect(isAllowed('', UA, '/any')).toBe(true);
    expect(isAllowed('# 只有注释', UA, '/any')).toBe(true);
  });

  it('lets the longest matching rule win', () => {
    const text = 'User-agent: *\nDisallow: /docs/\nAllow: /docs/public/\n';
    expect(isAllowed(text, UA, '/docs/secret')).toBe(false);
    expect(isAllowed(text, UA, '/docs/public/a.html')).toBe(true);
  });

  it('ignores an empty Disallow value', () => {
    expect(isAllowed('User-agent: *\nDisallow:\n', UA, '/any')).toBe(true);
  });

  it('groups consecutive user-agent lines together', () => {
    const groups = parseGroups('User-agent: a\nUser-agent: b\nDisallow: /x\n');
    expect(groups).toHaveLength(1);
    expect(groups[0].agents).toEqual(['a', 'b']);
    expect(pickGroup(groups, 'b-crawler').rules[0].path).toBe('/x');
  });
});

describe('http client total-duration timeout', () => {
  const { nodeFetch } = require('../apps/miniprogram/cloudfunctions/adminData/httpClient.js');
  const http = require('node:http');

  it('aborts a response that keeps trickling data past the deadline', async () => {
    // 模拟大模型持续吐 token：连接一直有数据，socket 空闲超时不会触发。
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      const tick = setInterval(() => res.write('token '), 50);
      res.on('close', () => clearInterval(tick));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      const started = Date.now();
      await expect(nodeFetch(`http://127.0.0.1:${port}/`, { timeoutMs: 600 }))
        .rejects.toThrow(/request_timeout_after_600ms/);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      server.close();
    }
  });
});
