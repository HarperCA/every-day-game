import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ ready: false, userId: '' }));

vi.mock('../apps/miniprogram/services/cloudSession', () => ({
  isCloudSessionReady: () => session.ready,
  getCurrentUserId: () => session.ready ? session.userId : '',
}));

import { getUserProfile, saveUserProfile } from '../apps/miniprogram/services/profile';

const storage = new Map<string, unknown>();

beforeEach(() => {
  storage.clear();
  session.ready = false;
  session.userId = '';
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  };
});

describe('profile settings', () => {
  it('requires login and keeps profiles separate by WeChat account', () => {
    expect(getUserProfile().displayName).toBe('微信用户');
    expect(() => saveUserProfile({ displayName: '小明', avatarPath: 'saved-avatar' })).toThrow('请先微信登录');

    session.ready = true;
    session.userId = 'account-a';
    saveUserProfile({ displayName: '小明', avatarPath: 'saved-avatar' });
    expect(getUserProfile()).toEqual({ displayName: '小明', avatarPath: 'saved-avatar' });

    session.userId = 'account-b';
    expect(getUserProfile()).toEqual({ displayName: '微信用户', avatarPath: '' });
    session.userId = 'account-a';
    expect(getUserProfile().displayName).toBe('小明');
  });

  it('rejects an empty or overly long name', () => {
    session.ready = true;
    session.userId = 'account-a';
    expect(() => saveUserProfile({ displayName: '  ', avatarPath: '' })).toThrow();
    expect(() => saveUserProfile({ displayName: '名字'.repeat(11), avatarPath: '' })).toThrow();
  });
});
