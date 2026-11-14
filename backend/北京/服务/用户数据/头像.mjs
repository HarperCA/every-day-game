// 上传头像（2026-11-12，小程序组队用）：小程序 wx.uploadFile 以 multipart/form-data 传一张图（字段名 file），入口 POST /api/uploadAvatar 交进来。
// 照海报的做法：图片存在硬盘文件夹里（AVATAR_DIR，默认 DB_DIR/头像/），由网站（nginx）直接对外提供；对外网址 = 头像地址（AVATAR_BASE_URL）/文件名。
// 存好后顺带把网址写进这个用户的资料（user_account.avatar_url，同 saveProfile），小程序不用再单独调 saveProfile 改头像。
//   只收 1 MB 以内的 jpeg/png/webp：看文件头（共用/工具/图片.mjs 的 图片大小，读得出格式和宽高才算），不信上传的文件名和 Content-Type；扩展名按文件头定。
//   文件名：<用户标记>-<随机 32 位>.<扩展名>。用户标记 = HMAC(令牌密钥, 用户编号) 的前 16 位，不带 openid、用户编号（用户编号组队里队友看得到）；
//     同一用户的旧头像按这个标记找出来删掉，只留最新一张。不按资料里的网址删：资料里的网址用户能经 saveProfile 改成别人的头像文件。
//   multipart 用 Node 自带的 Response.formData() 解析，不装第三方库。
//
//   上传头像({ 内容类型, 正文 }, { 用户库, openid, now, 头像地址, 头像目录, 密钥 })
//     → { ok: true, data: { avatarUrl } } 或 { ok: false, message }
//     message：unauthenticated、user_account_disabled、avatar_upload_unavailable（没配头像地址）、invalid_upload（不是 multipart、没有 file 文件字段）、
//              avatar_too_large（超过 1 MB）、unsupported_image_type（不是 jpeg/png/webp）。写文件等意外的错往外抛，入口回 500。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 图片大小 } from '../../../共用/工具/图片.mjs';
import { 用户 } from '../../副数据库/index.mjs';

export const 头像上限 = 1024 * 1024;
const 扩展名 = { jpg: 'jpg', png: 'png', webp: 'webp' };
const MAX_AVATAR_URL = 500;   // 同 saveProfile
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const 默认目录 = () => process.env.AVATAR_DIR || path.join(process.env.DB_DIR || path.join(HERE, '..', '..', '副数据库', '数据'), '头像');

class 不收 extends Error {}
const 不收了 = message => { throw new 不收(message); };

function 当前用户(用户库, openid) {
  const 账号 = openid ? 用户.按openid(用户库, openid) : null;
  if (!账号) 不收了('unauthenticated');
  if (账号.status !== 'active') 不收了('user_account_disabled');
  return 账号.id;
}

// 头像地址要是 https，拼上文件名不超过 saveProfile 的长度上限；不合格当没配
function 拼网址(头像地址, 文件名) {
  const url = `${String(头像地址 || '').replace(/\/+$/, '')}/${文件名}`;
  let https = false;
  try { https = new URL(url).protocol === 'https:'; } catch { https = false; }
  return https && url.length <= MAX_AVATAR_URL ? url : null;
}

async function 取文件(内容类型, 正文) {
  if (!/^multipart\/form-data\s*;/i.test(String(内容类型 || ''))) 不收了('invalid_upload');
  let 表;
  try { 表 = await new Response(正文, { headers: { 'content-type': 内容类型 } }).formData(); } catch { 不收了('invalid_upload'); }
  const 文件 = 表.get('file');
  if (!文件 || typeof 文件 === 'string') 不收了('invalid_upload');
  if (文件.size > 头像上限) 不收了('avatar_too_large');
  return Buffer.from(await 文件.arrayBuffer());
}

export async function 上传头像({ 内容类型, 正文 } = {}, { 用户库, openid, now = () => new Date(), 头像地址 = '', 头像目录 = 默认目录(), 密钥 } = {}) {
  try {
    const userId = 当前用户(用户库, openid);
    if (!密钥 || !拼网址(头像地址, 'x.png')) 不收了('avatar_upload_unavailable');
    const 图 = await 取文件(内容类型, 正文);
    const 大小 = 图片大小(图);
    const 扩展 = 扩展名[大小?.格式];
    if (!扩展 || !(大小.宽 > 0) || !(大小.高 > 0)) 不收了('unsupported_image_type');

    const 标记 = crypto.createHmac('sha256', 密钥).update(`avatar:${userId}`).digest('hex').slice(0, 16);
    const 文件名 = `${标记}-${crypto.randomBytes(16).toString('hex')}.${扩展}`;
    const avatarUrl = 拼网址(头像地址, 文件名);
    // 入口服务的 systemd 是 UMask=0077（库文件只给自己读），nginx 要读头像：文件夹和文件显式改成 755、644
    if (fs.mkdirSync(头像目录, { recursive: true })) fs.chmodSync(头像目录, 0o755);
    const 目标 = path.join(头像目录, 文件名);
    fs.writeFileSync(目标, 图, { flag: 'wx' });
    fs.chmodSync(目标, 0o644);
    try {
      用户.改资料(用户库, userId, { avatar_url: avatarUrl }, { now: now() });
    } catch (error) {
      fs.rmSync(目标, { force: true });
      throw error;
    }
    // 资料已经指向新图，旧的删掉；删不掉只记日志，不影响这次上传
    for (const 旧 of fs.readdirSync(头像目录)) {
      if (旧 === 文件名 || !旧.startsWith(`${标记}-`)) continue;
      try { fs.rmSync(path.join(头像目录, 旧), { force: true }); } catch (error) { console.error('[上传头像] 删旧头像失败', error?.message); }
    }
    return { ok: true, data: { avatarUrl } };
  } catch (error) {
    if (error instanceof 不收) return { ok: false, message: error.message };
    throw error;
  }
}
