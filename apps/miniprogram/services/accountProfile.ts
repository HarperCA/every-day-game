// 账号的昵称头像（2026-11-12，组队里给队友、队长看）。存在北京：
//   昵称：POST /api/userData 的 getProfile {}、saveProfile { nickname?, avatarUrl? } → { nickname, avatarUrl }（只改给了的那一项；昵称最多 30 字；头像只收 https 网址）
//   头像：wx.chooseAvatar 给的是本地临时文件，先 wx.uploadFile 传 POST /api/uploadAvatar（字段 file，请求头 Authorization: Bearer 令牌）
//         换成 https 地址 { avatarUrl }（后端顺带写进资料）。上传接口还没部署时传不上去：只存昵称，头像用默认，不挡住建队、申请。
// 和 profile.ts 不同：那个是“我的”页存在这台手机上的显示名，这里是后端账号上的、别人看得到的。
import { callUserData, ensureLoggedIn, getCurrentUserId, uploadWithSession } from './cloudSession';

export interface AccountProfile { nickname: string; avatarUrl: string }
export const NICKNAME_LIMIT = 30;

// 读过的资料按账号记着，同一个账号不用每次建队、申请都问一遍
let cache: { owner: string; profile: AccountProfile } | null = null;

const normalize = (value: any): AccountProfile => ({
  nickname: typeof value?.nickname === 'string' ? value.nickname : '',
  avatarUrl: typeof value?.avatarUrl === 'string' ? value.avatarUrl : '',
});

export async function getAccountProfile(): Promise<AccountProfile> {
  await ensureLoggedIn();
  const owner = getCurrentUserId();
  if (cache && cache.owner === owner && cache.profile.nickname) return { ...cache.profile };
  const profile = normalize(await callUserData('getProfile'));
  cache = { owner, profile };
  return { ...profile };
}

// 传头像，交回 https 地址
export async function uploadAvatar(tempFilePath: string): Promise<string> {
  await ensureLoggedIn();
  const result = await uploadWithSession<{ avatarUrl?: string }>('/api/uploadAvatar', tempFilePath);
  if (!result?.avatarUrl || !/^https:\/\//.test(result.avatarUrl)) throw new Error('头像上传失败');
  return result.avatarUrl;
}

// 昵称必填；avatarPath 是 chooseAvatar 给的临时文件，没选就不改头像。头像传不上去时 avatarFailed 为真，昵称照样存
export async function saveNicknameAndAvatar(input: { nickname: string; avatarPath?: string }): Promise<AccountProfile & { avatarFailed: boolean }> {
  const nickname = (input.nickname || '').trim();
  if (!nickname) throw new Error('请填写昵称');
  if (Array.from(nickname).length > NICKNAME_LIMIT) throw new Error(`昵称最多 ${NICKNAME_LIMIT} 个字`);
  await ensureLoggedIn();
  let avatarUrl = '';
  let avatarFailed = false;
  if (input.avatarPath && !/^https:\/\//.test(input.avatarPath)) {
    try { avatarUrl = await uploadAvatar(input.avatarPath); } catch (_error) { avatarFailed = true; }
  }
  const saved = normalize(await callUserData('saveProfile', avatarUrl ? { nickname, avatarUrl } : { nickname }));
  cache = { owner: getCurrentUserId(), profile: saved };
  return { ...saved, avatarFailed };
}
