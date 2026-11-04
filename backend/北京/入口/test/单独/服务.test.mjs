// 服务.mjs：把小程序的请求接到 接口.mjs 的小服务器。起在随机端口上，库用内存里的，不连微信。
import { afterEach, describe, expect, test } from 'vitest';
import { openMainDb } from '../../../主数据库/index.mjs';
import { openUserDb } from '../../../副数据库/index.mjs';
import { 打开报错库 } from '../../../服务/收集报错/报错库.mjs';
import { 请求上限 } from '../../接口.mjs';
import { 建服务 } from '../../服务.mjs';

let 服务;
afterEach(() => new Promise(r => (服务 ? 服务.close(r) : r())));

async function 起() {
  服务 = 建服务({ 主库: openMainDb({ file: ':memory:' }), 用户库: openUserDb({ file: ':memory:' }), 报错库: 打开报错库(':memory:'), 密钥: 'k'.repeat(32) });
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
});
