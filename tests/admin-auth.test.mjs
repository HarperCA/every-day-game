import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { issueAdminSession, requireStaticAdminToken, verifyAdminSession, SESSION_DURATION_MS } = require('../apps/miniprogram/cloudfunctions/adminData/adminAuth.js');

describe('admin cloud session', () => {
  it('issues a signed session that expires after eight hours', () => {
    const now = Date.parse('2026-08-31T00:00:00.000Z');
    const token = issueAdminSession('test-secret', now);
    expect(verifyAdminSession(token, 'test-secret', now + SESSION_DURATION_MS - 1)).toBe(true);
    expect(verifyAdminSession(token, 'test-secret', now + SESSION_DURATION_MS)).toBe(false);
  });

  it('rejects tampered sessions and incorrect static tokens', () => {
    const token = issueAdminSession('test-secret', 1000);
    expect(verifyAdminSession(`${token}x`, 'test-secret', 1001)).toBe(false);
    expect(() => requireStaticAdminToken('wrong', 'test-secret')).toThrow('admin_unauthorized');
    expect(() => requireStaticAdminToken('test-secret', 'test-secret')).not.toThrow();
  });
});
