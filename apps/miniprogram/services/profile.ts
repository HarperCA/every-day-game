import { getCurrentUserId, isCloudSessionReady } from './cloudSession';

const STORAGE_KEY = 'competition-profile-v1';

export interface UserProfile {
  displayName: string;
  avatarPath: string;
}

export const DEFAULT_PROFILE: UserProfile = { displayName: '微信用户', avatarPath: '' };

function accountKey(): string {
  const userId = getCurrentUserId();
  return isCloudSessionReady() && userId ? `${STORAGE_KEY}:${userId}` : '';
}

export function getUserProfile(): UserProfile {
  const key = accountKey();
  if (!key) return { ...DEFAULT_PROFILE };
  try {
    const value = wx.getStorageSync(key);
    return {
      displayName: typeof value?.displayName === 'string' && value.displayName.trim() ? value.displayName.trim() : DEFAULT_PROFILE.displayName,
      avatarPath: typeof value?.avatarPath === 'string' ? value.avatarPath : '',
    };
  } catch (_error) {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveUserProfile(profile: UserProfile): void {
  const key = accountKey();
  if (!key) throw new Error('请先微信登录');
  const displayName = profile.displayName.trim();
  if (!displayName || Array.from(displayName).length > 20) throw new Error('名称请填写 1～20 个字');
  wx.setStorageSync(key, { displayName, avatarPath: profile.avatarPath || '' });
}
