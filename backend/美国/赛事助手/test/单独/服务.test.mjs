// 服务.mjs：把 POST /api/assistant 接到 接口.mjs 的小服务器。这里起在随机端口上，用假的回答测转交和限制。
import { afterEach, describe, expect, test } from 'vitest';
import { 签发令牌 } from '../../../../共用/工具/令牌.mjs';
import { 建服务 } from '../../服务.mjs';
import { 请求上限 } from '../../接口.mjs';

const 密钥 = 'k'.repeat(32);
let 服务;
afterEach(() => new Promise(r => (服务 ? 服务.close(r) : r())));

async function 起(回答 = async (event, openid) => ({ ok: true, data: { openid, message: event.message } })) {
  服务 = 建服务({ 密钥, 回答 });
  await new Promise(r => 服务.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${服务.address().port}`;
}

describe('服务', () => {
  test('POST /api/assistant 带令牌：回答的结果按 JSON 回，不缓存', async () => {
    const 地址 = await 起();
    const r = await fetch(`${地址}/api/assistant`, { method: 'POST', headers: { Authorization: `Bearer ${签发令牌('o-1', 密钥)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ask', message: '找比赛' }) });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/application\/json/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ ok: true, data: { openid: 'o-1', message: '找比赛' } });
  });
  test('没令牌 401；正文超过上限 413（读到超限就停，不等读完）；别的路径 404', async () => {
    const 地址 = await 起();
    expect((await fetch(`${地址}/api/assistant`, { method: 'POST', body: '{}' })).status).toBe(401);
    const 大 = await fetch(`${地址}/api/assistant`, { method: 'POST', headers: { Authorization: `Bearer ${签发令牌('o-1', 密钥)}` }, body: 'x'.repeat(请求上限 + 10) });
    expect(大.status).toBe(413);
    expect((await fetch(`${地址}/api/别的`, { method: 'POST', body: '{}' })).status).toBe(404);
  });
});
