import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloud = vi.hoisted(() => ({
  ready: false,
  callUserData: vi.fn(),
  isCloudSessionReady: vi.fn(() => cloud.ready),
}));

vi.mock('../apps/miniprogram/services/cloudSession', () => ({
  callUserData: cloud.callUserData,
  isCloudSessionReady: cloud.isCloudSessionReady,
}));

import { getFavoriteIds, initializeFavoritesCloudSync, removeFavorite, toggleFavorite } from '../apps/miniprogram/services/favorites';

const storage = new Map<string, unknown>();

beforeEach(() => {
  storage.clear();
  cloud.ready = false;
  cloud.callUserData.mockReset();
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  };
});

describe('favorite cloud synchronization', () => {
  it('keeps an offline deletion and removes the stale cloud favorite after login', async () => {
    storage.set('competition-favorites-v1', [{ editionId:'edition-1', createdAt:'2026-08-20T00:00:00.000Z' }]);
    removeFavorite('edition-1');
    expect(getFavoriteIds()).toEqual([]);

    cloud.callUserData.mockImplementation(async (action: string) => action === 'listFavorites'
      ? [{ editionId:'edition-1', createdAt:'2026-08-20T00:00:00.000Z' }]
      : { ok:true });
    await initializeFavoritesCloudSync();

    expect(getFavoriteIds()).toEqual([]);
    expect(cloud.callUserData).toHaveBeenCalledWith('setFavorite', { editionId:'edition-1', favorited:false });
    expect(storage.get('competition-favorite-deletions-v1')).toEqual([]);
  });

  it('retains the deletion marker when cloud deletion fails', async () => {
    storage.set('competition-favorites-v1', [{ editionId:'edition-2', createdAt:'2026-08-20T00:00:00.000Z' }]);
    removeFavorite('edition-2');
    cloud.callUserData.mockImplementation(async (action: string) => {
      if (action === 'listFavorites') return [{ editionId:'edition-2', createdAt:'2026-08-20T00:00:00.000Z' }];
      throw new Error('network unavailable');
    });

    await expect(initializeFavoritesCloudSync()).rejects.toThrow('network unavailable');
    expect(getFavoriteIds()).toEqual([]);
    expect(storage.get('competition-favorite-deletions-v1')).toEqual(['edition-2']);
  });

  it('uploads a large local favorite set in bounded batches', async () => {
    const records = Array.from({ length:55 }, (_, index) => ({ editionId:`edition-${index}`, createdAt:'2026-08-20T00:00:00.000Z' }));
    storage.set('competition-favorites-v1', records);
    cloud.callUserData.mockImplementation(async (action: string) => action === 'listFavorites' ? [] : { ok:true });

    await initializeFavoritesCloudSync();

    const batches = cloud.callUserData.mock.calls.filter(([action]) => action === 'mergeFavorites').map(([, payload]) => payload.records.length);
    expect(batches).toEqual([50, 5]);
  });

  it('preserves a favorite added while the initial cloud list is in flight', async () => {
    let releaseList!: (records: unknown[]) => void;
    const list = new Promise<unknown[]>(resolve => { releaseList = resolve; });
    cloud.ready = true;
    cloud.callUserData.mockImplementation(async (action: string) => action === 'listFavorites' ? list : { ok:true });

    const syncing = initializeFavoritesCloudSync();
    await Promise.resolve();
    toggleFavorite('edition-new');
    releaseList([]);
    await syncing;

    expect(getFavoriteIds()).toEqual(['edition-new']);
    expect(cloud.callUserData.mock.calls.map(([action]) => action)).toEqual(['listFavorites', 'setFavorite', 'mergeFavorites']);
  });
});
