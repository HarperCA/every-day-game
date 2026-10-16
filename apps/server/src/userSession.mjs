import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GENERAL_FEEDBACK_ACTIONS = new Set(['submitGeneralFeedback', 'listGeneralFeedback']);
export const USER_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

// A restart invalidates sessions; the client obtains a new one with wx.login.
export function createUserSessions(secret = randomBytes(32)) {
  const signature = payload => createHmac('sha256', secret).update(payload).digest('base64url');
  return {
    issue({ openid, appid }, now = Date.now()) {
      if (!openid) throw new Error('unauthenticated');
      const payload = Buffer.from(JSON.stringify({ openid, appid, expiresAt: now + USER_SESSION_DURATION_MS })).toString('base64url');
      return `${payload}.${signature(payload)}`;
    },
    verify(token, now = Date.now()) {
      if (typeof token !== 'string' || token.length > 2048) return null;
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const actual = Buffer.from(parts[1]);
      const expected = Buffer.from(signature(parts[0]));
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
      try {
        const identity = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
        if (typeof identity.openid !== 'string' || !identity.openid || !Number.isFinite(identity.expiresAt) || identity.expiresAt <= now) return null;
        return { openid: identity.openid, appid: identity.appid || '' };
      } catch { return null; }
    },
  };
}
