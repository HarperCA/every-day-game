// 新后台的登录（2026-11-03，挂到 https://107-175-111-18.sslip.io/new-admin/ 之前加）：
//   配了口令（ADMIN_TOKEN_FILE，和旧后台同一个口令）时，取数据（/api/后台/…）和看海报（/海报/…）要先登录；界面文件不用（里面没有数据）。
//   登录成功发一个 12 小时有效的会话 cookie（HttpOnly、Secure、SameSite=Strict）；口令连错 5 次，10 分钟内不让再试。
//   没配口令（本机预览）照旧不用登录。网页里的地址都写相对的，挂在 /new-admin/ 下面也能用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { open, seed } from '../../../db/test/复用/样例数据.mjs';
import { 建服务 } from '../../建服务.mjs';
import { 签会话, 验会话 } from '../../登录.mjs';

const 口令 = 'k'.repeat(40);
const T0 = Date.parse('2026-11-03T10:00:00Z');
let 服务们 = [];
afterEach(async () => { await Promise.all(服务们.map(s => new Promise(r => s.close(r)))); 服务们 = []; });

async function 起(选项 = {}) {
  const db = open(); seed(db);
  let 现在 = T0;
  const 服务 = 建服务({ 口令, 环境: () => ({ db }), now: () => 现在, ...选项 });
  await new Promise(r => 服务.listen(0, '127.0.0.1', r));
  服务们.push(服务);
  const 根 = `http://127.0.0.1:${服务.address().port}`;
  const 发 = (路径, { 正文, cookie, method = 'POST' } = {}) => fetch(根 + encodeURI(路径), { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(正文 ?? {}) });
  return { 发, 拨到: t => { 现在 = t; } };
}
const 登录 = async 发 => {
  const 回 = await 发('/api/登录', { 正文: { 口令 } });
  return 回.headers.get('set-cookie').split(';')[0];
};

describe('会话', () => {
  test('签出来的 12 小时内有效；过期、被改过、换了秘钥都不认', () => {
    const 值 = 签会话('秘钥'.repeat(10), T0);
    expect(验会话('秘钥'.repeat(10), 值, T0 + 11 * 3600e3)).toBe(true);
    expect(验会话('秘钥'.repeat(10), 值, T0 + 13 * 3600e3)).toBe(false);
    expect(验会话('秘钥'.repeat(10), 值.replace(/.$/, c => (c === 'a' ? 'b' : 'a')), T0)).toBe(false);
    expect(验会话('别的'.repeat(10), 值, T0)).toBe(false);
    expect(验会话('秘钥'.repeat(10), '', T0)).toBe(false);
  });
});

describe('配了口令', () => {
  test('没登录：取数据、看海报都 401（告诉网页要登录）；界面文件照常给', async () => {
    const { 发 } = await 起();
    const 回 = await 发('/api/后台/回收站');
    expect(回.status).toBe(401);
    expect(await 回.json()).toMatchObject({ ok: false, 要登录: true });
    expect((await 发(`/海报/${'a'.repeat(64)}.jpg`, { method: 'GET' })).status).toBe(401);
    expect((await 发('/', { method: 'GET' })).status).toBe(200);
  });
  test('口令对：发会话 cookie（HttpOnly、Secure、SameSite=Strict），带着它就能取数据；口令错 401', async () => {
    const { 发 } = await 起();
    expect((await 发('/api/登录', { 正文: { 口令: '错的' } })).status).toBe(401);
    const 回 = await 发('/api/登录', { 正文: { 口令 } });
    expect(回.status).toBe(200);
    const 头 = 回.headers.get('set-cookie');
    for (const 词 of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=43200']) expect(头).toContain(词);
    const cookie = 头.split(';')[0];
    const 数据 = await 发('/api/后台/回收站', { cookie });
    expect(数据.status).toBe(200);
    expect((await 数据.json()).ok).toBe(true);
  });
  test('会话 12 小时后过期，要重新登录；退出后 cookie 清掉', async () => {
    const t = await 起();
    const cookie = await 登录(t.发);
    t.拨到(T0 + 13 * 3600e3);
    expect((await t.发('/api/后台/回收站', { cookie })).status).toBe(401);
    const 退 = await t.发('/api/退出', { cookie });
    expect(退.headers.get('set-cookie')).toContain('Max-Age=0');
  });
  test('口令连错 5 次：10 分钟内连对的也不让试（429）；过了 10 分钟可以再试', async () => {
    const t = await 起();
    for (let i = 0; i < 5; i++) expect((await t.发('/api/登录', { 正文: { 口令: `错${i}` } })).status).toBe(401);
    expect((await t.发('/api/登录', { 正文: { 口令 } })).status).toBe(429);
    t.拨到(T0 + 11 * 60e3);
    expect((await t.发('/api/登录', { 正文: { 口令 } })).status).toBe(200);
  });
});

describe('没配口令（本机预览）', () => {
  test('不用登录，照旧能取数据', async () => {
    const { 发 } = await 起({ 口令: '' });
    expect((await 发('/api/后台/回收站')).status).toBe(200);
  });
});

describe('网页里的地址', () => {
  test('都写相对的（./api/…、./海报/…），挂在 /new-admin/ 下面也能用', () => {
    const 后台 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const 绝对 = [];
    const 看 = 目录 => {
      for (const 项 of fs.readdirSync(目录, { withFileTypes: true })) {
        const 全 = path.join(目录, 项.name);
        if (项.isDirectory()) { if (项.name !== 'test') 看(全); continue; }
        if (!/\.(mjs|html)$/.test(项.name) || ['服务.mjs', '建服务.mjs', '接口.mjs', '登录.mjs', '每日清理.mjs', '数据库.mjs'].includes(项.name)) continue;
        if (/[`'"]\/(api|海报)\//.test(fs.readFileSync(全, 'utf8'))) 绝对.push(path.relative(后台, 全));
      }
    };
    看(后台);
    expect(绝对).toEqual([]);
  });
});
