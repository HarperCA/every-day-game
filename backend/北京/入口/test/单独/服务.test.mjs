// 服务.mjs：把小程序的请求接到 接口.mjs 的小服务器。起在随机端口上，库用内存里的，不连微信。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { 签发令牌 } from '../../../../共用/工具/令牌.mjs';
import { 假JPG } from '../../../../共用/test/复用/假图片.mjs';
import { openMainDb } from '../../../主数据库/index.mjs';
import { openUserDb, 用户 } from '../../../副数据库/index.mjs';
import { 打开报错库 } from '../../../服务/收集报错/报错库.mjs';
import { 头像上限 } from '../../../服务/用户数据/头像.mjs';
import { 请求上限, 上传请求上限 } from '../../接口.mjs';
import { 建服务 } from '../../服务.mjs';

let 服务;
const 目录们 = [];
afterEach(() => new Promise(r => (服务 ? 服务.close(r) : r())));
afterEach(() => { for (const 目录 of 目录们.splice(0)) fs.rmSync(目录, { recursive: true, force: true }); });

async function 起(over = {}) {
  服务 = 建服务({ 主库: openMainDb({ file: ':memory:' }), 用户库: openUserDb({ file: ':memory:' }), 报错库: 打开报错库(':memory:'), 密钥: 'k'.repeat(32), ...over });
  await new Promise(r => 服务.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${服务.address().port}`;
}

describe('服务', () => {
  test('POST /api/clientLog：按 JSON 回，不缓存', async () => {
    const 地址 = await 起();
    const r = await fetch(`${地址}/api/clientLog`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [{ kind: 'slow' }] }) });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/application\/json/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ ok: true, saved: 1 });
  });
  test('正文超过上限 413（读到超限就停）；没令牌调用户数据 401；不认识的路径 404', async () => {
    const 地址 = await 起();
    expect((await fetch(`${地址}/api/clientLog`, { method: 'POST', body: 'x'.repeat(请求上限 + 10) })).status).toBe(413);
    expect((await fetch(`${地址}/api/userData`, { method: 'POST', body: '{"action":"listFavorites"}' })).status).toBe(401);
    expect((await fetch(`${地址}/api/sendReminders`, { method: 'POST', body: '{}' })).status).toBe(404);
  });
  // 上传头像（2026-11-12）：照小程序 wx.uploadFile 真发 multipart，二进制原样收到；1 MB 的图能过，超过上传上限 413
  test('POST /api/uploadAvatar：Bearer 令牌 + multipart，1 MB 的图收下，文件内容原样；正文超过上传上限 413', async () => {
    const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '北京服务头像-'));
    目录们.push(目录);
    const 用户库 = openUserDb({ file: ':memory:' });
    用户.新建或登录(用户库, { openid: 'o-1' });
    const 地址 = await 起({ 用户库, 头像地址: 'https://example.cn/avatars', 头像目录: 目录 });
    const 令牌 = 签发令牌('o-1', 'k'.repeat(32));
    const 图 = 假JPG(300, 300, 头像上限);
    for (let i = 20; i < 图.length; i += 1) 图[i] = i % 256;   // 各种字节都有（含 0x0d 0x0a、非 UTF-8 的），确认没被当文字转坏
    const fd = new FormData();
    fd.append('file', new Blob([图], { type: 'image/jpeg' }), 'wxfile://tmp_1.jpg');
    const r = await fetch(`${地址}/api/uploadAvatar`, { method: 'POST', headers: { Authorization: `Bearer ${令牌}` }, body: fd });
    expect(r.status).toBe(200);
    const { ok, data } = await r.json();
    expect(ok).toBe(true);
    expect(fs.readFileSync(path.join(目录, data.avatarUrl.split('/').pop()))).toEqual(图);
    const 太大 = new FormData();
    太大.append('file', new Blob([Buffer.alloc(上传请求上限 + 1)]), 'a.jpg');
    expect((await fetch(`${地址}/api/uploadAvatar`, { method: 'POST', headers: { Authorization: `Bearer ${令牌}` }, body: 太大 })).status).toBe(413);
  });
});
