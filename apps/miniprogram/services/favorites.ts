import { callUserData, getCurrentUserId, isCloudSessionReady } from './cloudSession';

const STORAGE_KEY = 'competition-favorites-v1';
const DELETED_KEY = 'competition-favorite-deletions-v1';
let favoriteCloudQueue: Promise<unknown> = Promise.resolve();

function accountKey(base: string): string {
  const userId = getCurrentUserId();
  return isCloudSessionReady() && userId ? `${base}:${userId}` : '';
}

function assertAccount(owner: string) {
  if (!owner || !isCloudSessionReady() || getCurrentUserId() !== owner) throw new Error('账号已变更，请重新操作');
}

function requireAccountKey(base: string): string {
  const key = accountKey(base);
  if (!key) throw new Error('请先微信登录');
  return key;
}

export interface FavoriteRecord {
  editionId: string;
  createdAt: string;
}

function readFavorites(): FavoriteRecord[] {
  const key = accountKey(STORAGE_KEY);
  if (!key) return [];
  try {
    const value = wx.getStorageSync(key);
    if (!Array.isArray(value)) return [];
    return value.filter((item: any) => typeof item?.editionId === 'string' && typeof item?.createdAt === 'string');
  } catch (_error) {
    return [];
  }
}

function writeFavorites(records: FavoriteRecord[]) {
  wx.setStorageSync(requireAccountKey(STORAGE_KEY), records);
}

function readDeletedIds(): string[] {
  const key = accountKey(DELETED_KEY);
  if (!key) return [];
  try {
    const value = wx.getStorageSync(key);
    return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : [];
  } catch (_error) { return []; }
}

function writeDeletedIds(ids: string[]) {
  wx.setStorageSync(requireAccountKey(DELETED_KEY), Array.from(new Set(ids)));
}

function markDeleted(editionId: string) {
  writeDeletedIds([...readDeletedIds(), editionId]);
}

function clearDeleted(editionId: string) {
  writeDeletedIds(readDeletedIds().filter(id => id !== editionId));
}

function runFavoriteCloud<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const owner = getCurrentUserId();
  const task = favoriteCloudQueue.catch(() => undefined).then(async () => {
    assertAccount(owner);
    const result = await callUserData<T>(action, payload);
    assertAccount(owner);
    return result;
  });
  favoriteCloudQueue = task.catch(() => undefined);
  return task;
}

function syncFavorite(editionId: string, favorited: boolean, createdAt?: string) {
  if (!isCloudSessionReady()) return;
  runFavoriteCloud('setFavorite', { editionId, favorited, createdAt })
    .then(() => { if (!favorited) clearDeleted(editionId); })
    .catch((error: unknown) => console.error('收藏云同步失败', error));
}

export async function initializeFavoritesCloudSync(): Promise<void> {
  requireAccountKey(STORAGE_KEY);
  const owner = getCurrentUserId();
  const remote = await runFavoriteCloud<FavoriteRecord[]>('listFavorites');
  const local = readFavorites();
  const deletedIds = new Set(readDeletedIds());
  const merged = new Map<string, FavoriteRecord>();
  for (const item of [...remote, ...local].filter(item => !deletedIds.has(item.editionId))) {
    const previous = merged.get(item.editionId);
    if (!previous || item.createdAt < previous.createdAt) merged.set(item.editionId, item);
  }
  const records = [...merged.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  writeFavorites(records);
  for (const editionId of deletedIds) await runFavoriteCloud('setFavorite', { editionId, favorited:false });
  for (let index = 0; index < records.length; index += 50) {
    await runFavoriteCloud('mergeFavorites', { records:records.slice(index, index + 50) });
  }
  assertAccount(owner);
  writeDeletedIds(readDeletedIds().filter(id => !deletedIds.has(id)));
}

export function getFavoriteRecords(): FavoriteRecord[] {
  return readFavorites();
}

export function getFavoriteIds(): string[] {
  return readFavorites().map((item) => item.editionId);
}

export function isFavorite(editionId: string): boolean {
  return readFavorites().some((item) => item.editionId === editionId);
}

export function toggleFavorite(editionId: string): boolean {
  requireAccountKey(STORAGE_KEY);
  const records = readFavorites();
  const index = records.findIndex((item) => item.editionId === editionId);
  if (index >= 0) {
    records.splice(index, 1);
    writeFavorites(records);
    markDeleted(editionId);
    syncFavorite(editionId, false);
    return false;
  }
  const createdAt = new Date().toISOString();
  clearDeleted(editionId);
  records.unshift({ editionId, createdAt });
  writeFavorites(records);
  syncFavorite(editionId, true, createdAt);
  return true;
}

export function removeFavorite(editionId: string) {
  requireAccountKey(STORAGE_KEY);
  writeFavorites(readFavorites().filter((item) => item.editionId !== editionId));
  markDeleted(editionId);
  syncFavorite(editionId, false);
}
