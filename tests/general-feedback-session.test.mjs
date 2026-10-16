import { describe, expect, it } from 'vitest';
import { createUserSessions, USER_SESSION_DURATION_MS } from '../apps/server/src/userSession.mjs';

describe('general feedback trusted user session', () => {
  it('retains the identity verified by WeChat and expires', () => {
    const sessions = createUserSessions('test-secret');
    const token = sessions.issue({ openid: 'user-a', appid: 'app' }, 1000);
    expect(sessions.verify(token, 1001)).toEqual({ openid: 'user-a', appid: 'app' });
    expect(sessions.verify(token, 1000 + USER_SESSION_DURATION_MS)).toBeNull();
  });
  it('rejects forged identity and a token signed by another server', () => {
    const sessions = createUserSessions('secret-a');
    const token = sessions.issue({ openid: 'user-a' }, 1000);
    const forged = Buffer.from(JSON.stringify({ openid: 'user-b', expiresAt: 999999 })).toString('base64url') + '.' + token.split('.')[1];
    expect(sessions.verify(forged, 1001)).toBeNull();
    expect(createUserSessions('secret-b').verify(token, 1001)).toBeNull();
    expect(sessions.verify('', 1001)).toBeNull();
  });
});
