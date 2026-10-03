import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloud = vi.hoisted(() => ({
  ready: true,
  userId: 'wechat-a',
  callUserData: vi.fn(),
  isCloudSessionReady: vi.fn(() => cloud.ready),
  getCurrentUserId: vi.fn(() => cloud.ready ? cloud.userId : ''),
}));

vi.mock('../apps/miniprogram/services/cloudSession', () => ({
  callUserData: cloud.callUserData,
  isCloudSessionReady: cloud.isCloudSessionReady,
  getCurrentUserId: cloud.getCurrentUserId,
}));

import { getFavoriteIds, initializeFavoritesCloudSync, toggleFavorite } from '../apps/miniprogram/services/favorites';

const storage = new Map<string, unknown>();

beforeEach(() => {
  storage.clear();
  cloud.ready = true;
  cloud.userId = 'wechat-a';
  cloud.callUserData.mockReset();
  cloud.callUserData.mockImplementation(async (action: string) => action === 'listFavorites' ? [] : { ok: true });
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  };
});

describe('account-bound favorite data', () => {
  it('shows no favorites before login and does not import unscoped device data', async () => {
    storage.set('competition-favorites-v1', [{ editionId: 'old-device-record', createdAt: '2026-08-20T00:00:00.000Z' }]);
    cloud.ready = false;
    expect(getFavoriteIds()).toEqual([]);
    expect(() => toggleFavorite('edition-1')).toThrow('请先微信登录');

    cloud.ready = true;
    cloud.callUserData.mockImplementation(async (action: string) => action === 'listFavorites'
      ? [{ editionId: 'account-record', createdAt: '2026-08-20T00:00:00.000Z' }]
      : { ok: true });
    await initializeFavoritesCloudSync();

    expect(getFavoriteIds()).toEqual(['account-record']);
    expect(cloud.callUserData.mock.calls.some(([action, payload]) => action === 'mergeFavorites' && payload.records.some((item: any) => item.editionId === 'old-device-record'))).toBe(false);
  });

  it('keeps local caches separate for different WeChat accounts', () => {
    storage.set('competition-favorites-v1:wechat-a', [{ editionId: 'a', createdAt: '2026-08-20T00:00:00.000Z' }]);
    storage.set('competition-favorites-v1:wechat-b', [{ editionId: 'b', createdAt: '2026-08-20T00:00:00.000Z' }]);
    expect(getFavoriteIds()).toEqual(['a']);
    cloud.userId = 'wechat-b';
    expect(getFavoriteIds()).toEqual(['b']);
  });

  it('uploads only the signed-in account local records', async () => {
    storage.set('competition-favorites-v1:wechat-a', Array.from({ length: 55 }, (_, index) => ({ editionId: `edition-${index}`, createdAt: '2026-08-20T00:00:00.000Z' })));
    storage.set('competition-favorites-v1:wechat-b', [{ editionId: 'other-account', createdAt: '2026-08-20T00:00:00.000Z' }]);
    await initializeFavoritesCloudSync();
    const batches = cloud.callUserData.mock.calls.filter(([action]) => action === 'mergeFavorites').map(([, payload]) => payload.records.length);
    expect(batches).toEqual([50, 5]);
    expect(getFavoriteIds()).not.toContain('other-account');
  });
});
