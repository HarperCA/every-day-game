import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { requireActiveAccount } = require('../apps/miniprogram/cloudfunctions/login/loginPolicy.js');

describe('login account policy', () => {
  it('allows an active account', () => {
    expect(requireActiveAccount({ _id:'user-1', status:'active' })._id).toBe('user-1');
  });

  it('rejects a disabled account during login', () => {
    expect(() => requireActiveAccount({ _id:'user-1', status:'disabled' })).toThrow('user_account_disabled');
  });
});
