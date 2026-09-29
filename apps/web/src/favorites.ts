// 收藏和纠错记录都存在当前浏览器里（没有登录，换设备或清缓存就没了）。
const FAVORITES_KEY = 'web-test-favorites-v1';
const FEEDBACK_KEY = 'web-test-feedback-v1';

export interface FavoriteRecord { editionId: string; createdAt: string }
export interface FeedbackRecord { editionId: string; competitionName: string; category: string; content: string; createdAt: string }

function read<T>(key: string): T[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown[]) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 隐私模式等情况下存不了，忽略 */ }
}

export const getFavoriteRecords = () => read<FavoriteRecord>(FAVORITES_KEY).filter(item => typeof item?.editionId === 'string');
export const getFavoriteIds = () => getFavoriteRecords().map(item => item.editionId);
export const isFavorite = (id: string) => getFavoriteIds().includes(id);

// 返回切换后的状态：true = 已收藏
export function toggleFavorite(id: string): boolean {
  const records = getFavoriteRecords();
  if (records.some(item => item.editionId === id)) {
    write(FAVORITES_KEY, records.filter(item => item.editionId !== id));
    return false;
  }
  write(FAVORITES_KEY, [{ editionId: id, createdAt: new Date().toISOString() }, ...records]);
  return true;
}

export const getFeedbackRecords = () => read<FeedbackRecord>(FEEDBACK_KEY);
export function addFeedbackRecord(record: FeedbackRecord) {
  write(FEEDBACK_KEY, [record, ...getFeedbackRecords()].slice(0, 50));
}
