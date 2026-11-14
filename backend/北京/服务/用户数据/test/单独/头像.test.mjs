// 上传头像（2026-11-12，小程序组队用）：wx.uploadFile 以 multipart/form-data 传一张图（字段 file），存进头像文件夹，
// 交回对外网址 = 头像地址/文件名，并顺带写进这个用户的资料（avatar_url）。
// 只收 1 MB 以内的 jpeg/png/webp，按文件头判断，不信扩展名和 Content-Type；文件名随机，不带 openid、用户编号；同一用户只留最新一张。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openUserDb, 用户 } from '../../../../副数据库/index.mjs';
import { 假JPG, 假PNG, 假WebP } from '../../../../../共用/test/复用/假图片.mjs';
import { 上传头像, 头像上限 } from '../../头像.mjs';

const NOW = new Date('2026-11-12T02:00:00Z');
const 地址 = 'https://example.cn/avatars';
const 目录们 = [];
afterEach(() => { for (const 目录 of 目录们.splice(0)) fs.rmSync(目录, { recursive: true, force: true }); });

function 环境(over = {}) {
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '北京头像-'));
  目录们.push(目录);
  const 用户库 = openUserDb({ file: ':memory:', now: () => NOW });
  const 账号 = 用户.新建或登录(用户库, { openid: 'o-1' }, { now: NOW });
  const 账号2 = 用户.新建或登录(用户库, { openid: 'o-2' }, { now: NOW });
  return { 用户库, 账号, 账号2, 目录, env: { 用户库, openid: 'o-1', now: () => NOW, 头像地址: 地址, 头像目录: 目录, 密钥: 'k'.repeat(32), ...over } };
}

// 照小程序 wx.uploadFile 的样子造 multipart 正文：字段名、文件名、Content-Type 都可以随便给
async function 表单(内容, { 字段 = 'file', 文件名 = 'a.png', 类型 = 'image/png' } = {}) {
  const fd = new FormData();
  fd.append(字段, new Blob([内容], { type: 类型 }), 文件名);
  const r = new Request('http://localhost/api/uploadAvatar', { method: 'POST', body: fd });
  return { 内容类型: r.headers.get('content-type'), 正文: Buffer.from(await r.arrayBuffer()) };
}
const 文件们 = 目录 => (fs.existsSync(目录) ? fs.readdirSync(目录).sort() : []);
const 文件名 = url => url.slice(地址.length + 1);

describe('上传头像', () => {
  test('合法 PNG：存进头像文件夹，交回 头像地址/随机文件名，网址写进这个用户的资料', async () => {
    const { 用户库, 账号, 目录, env } = 环境();
    const 图 = 假PNG(200, 200);
    const 回 = await 上传头像(await 表单(图), env);
    expect(回.ok).toBe(true);
    const { avatarUrl } = 回.data;
    expect(avatarUrl).toMatch(/^https:\/\/example\.cn\/avatars\/[0-9a-f]{16}-[0-9a-f]{32}\.png$/);
    expect(avatarUrl).not.toContain('o-1');
    expect(avatarUrl).not.toContain(账号.id);
    expect(文件们(目录)).toEqual([文件名(avatarUrl)]);
    expect(fs.readFileSync(path.join(目录, 文件名(avatarUrl)))).toEqual(图);
    expect(用户.读取(用户库, 账号.id).avatar_url).toBe(avatarUrl);
  });
  test('JPEG 存成 .jpg、WebP 存成 .webp（扩展名按文件头定，不按上传的文件名）；头像地址末尾带 / 也行', async () => {
    const { env } = 环境({ 头像地址: `${地址}/` });
    const jpg = await 上传头像(await 表单(假JPG(300, 300), { 文件名: 'x.png', 类型: 'image/png' }), env);
    expect(jpg.data.avatarUrl).toMatch(/^https:\/\/example\.cn\/avatars\/[0-9a-f-]+\.jpg$/);
    const webp = await 上传头像(await 表单(假WebP(300, 300), { 文件名: 'x.jpg', 类型: 'image/jpeg' }), env);
    expect(webp.data.avatarUrl).toMatch(/^https:\/\/example\.cn\/avatars\/[0-9a-f-]+\.webp$/);
  });
  test('同一用户第二次上传：删掉旧文件，只留最新一张；别人的头像不动', async () => {
    const { 用户库, 账号, 目录, env } = 环境();
    const 别人的 = (await 上传头像(await 表单(假PNG(10, 10)), { ...env, openid: 'o-2' })).data.avatarUrl;
    const 第一张 = (await 上传头像(await 表单(假PNG(100, 100)), env)).data.avatarUrl;
    const 第二张 = (await 上传头像(await 表单(假JPG(100, 100)), env)).data.avatarUrl;
    expect(第二张).not.toBe(第一张);
    expect(文件们(目录)).toEqual([文件名(别人的), 文件名(第二张)].sort());
    expect(用户.读取(用户库, 账号.id).avatar_url).toBe(第二张);
  });
  test('资料里的头像网址被改成别人的头像文件，再上传也不会删掉别人的（旧文件按用户认，不按资料里的网址）', async () => {
    const { 用户库, 账号, 目录, env } = 环境();
    const 别人的 = (await 上传头像(await 表单(假PNG(10, 10)), { ...env, openid: 'o-2' })).data.avatarUrl;
    用户.改资料(用户库, 账号.id, { avatar_url: 别人的 }, { now: NOW });
    const 我的 = (await 上传头像(await 表单(假PNG(20, 20)), env)).data.avatarUrl;
    expect(文件们(目录)).toEqual([文件名(别人的), 文件名(我的)].sort());
  });
  test('超过 1 MB：avatar_too_large，不存文件、不改资料', async () => {
    const { 用户库, 账号, 目录, env } = 环境();
    const 回 = await 上传头像(await 表单(假JPG(300, 300, 头像上限 + 1), { 文件名: 'a.jpg', 类型: 'image/jpeg' }), env);
    expect(回).toEqual({ ok: false, message: 'avatar_too_large' });
    expect(文件们(目录)).toEqual([]);
    expect(用户.读取(用户库, 账号.id).avatar_url ?? null).toBe(null);
    expect((await 上传头像(await 表单(假JPG(300, 300, 头像上限), { 文件名: 'a.jpg', 类型: 'image/jpeg' }), env)).ok).toBe(true);
  });
  test('不是图片（扩展名、Content-Type 伪造成 png）、GIF、宽高读不出：unsupported_image_type，不存文件', async () => {
    const { 用户库, 账号, 目录, env } = 环境();
    for (const 内容 of [Buffer.from('<?php echo 1; ?>'.repeat(10)), Buffer.from('GIF89a' + 'x'.repeat(40), 'latin1'), 假PNG(0, 0), Buffer.from([0xff, 0xd8, 0xff])]) {
      expect(await 上传头像(await 表单(内容, { 文件名: 'a.png', 类型: 'image/png' }), env)).toEqual({ ok: false, message: 'unsupported_image_type' });
    }
    expect(文件们(目录)).toEqual([]);
    expect(用户.读取(用户库, 账号.id).avatar_url ?? null).toBe(null);
  });
  test('不是 multipart、没有 file 字段、file 是普通文字字段：invalid_upload', async () => {
    const { env } = 环境();
    expect(await 上传头像({ 内容类型: 'application/json', 正文: Buffer.from('{"a":1}') }, env)).toEqual({ ok: false, message: 'invalid_upload' });
    expect(await 上传头像({ 内容类型: 'multipart/form-data; boundary=xyz', 正文: Buffer.from('乱七八糟') }, env)).toEqual({ ok: false, message: 'invalid_upload' });
    expect(await 上传头像(await 表单(假PNG(10, 10), { 字段: 'avatar' }), env)).toEqual({ ok: false, message: 'invalid_upload' });
    const fd = new FormData();
    fd.append('file', 'not-a-file');
    const r = new Request('http://localhost/', { method: 'POST', body: fd });
    expect(await 上传头像({ 内容类型: r.headers.get('content-type'), 正文: Buffer.from(await r.arrayBuffer()) }, env)).toEqual({ ok: false, message: 'invalid_upload' });
  });
  test('身份：没有、账号不存在 unauthenticated；停用 user_account_disabled；都不存文件', async () => {
    const { 用户库, 账号, 目录, env } = 环境();
    const 图 = await 表单(假PNG(10, 10));
    expect(await 上传头像(图, { ...env, openid: '' })).toEqual({ ok: false, message: 'unauthenticated' });
    expect(await 上传头像(图, { ...env, openid: 'o-陌生' })).toEqual({ ok: false, message: 'unauthenticated' });
    用户.停用(用户库, 账号.id, { now: NOW });
    expect(await 上传头像(图, env)).toEqual({ ok: false, message: 'user_account_disabled' });
    expect(文件们(目录)).toEqual([]);
  });
  test('没配头像地址（部署时没配 AVATAR_BASE_URL）：avatar_upload_unavailable，不存文件', async () => {
    const { 目录, env } = 环境({ 头像地址: '' });
    expect(await 上传头像(await 表单(假PNG(10, 10)), env)).toEqual({ ok: false, message: 'avatar_upload_unavailable' });
    expect(文件们(目录)).toEqual([]);
  });
});
