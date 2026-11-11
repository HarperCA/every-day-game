// 美国这边的入口 POST /api/assistant（2026-11-01 用户定）：小程序带北京签的令牌来，美国用共用密钥验，openid 只认令牌里的。
// 这里只测入口的检查和转交；回答本身见 对接.test.mjs。
import { describe, expect, test, vi } from 'vitest';
import { 签发令牌 } from '../../../../共用/工具/令牌.mjs';
import { 处理助手请求, 请求上限 } from '../../接口.mjs';

const 密钥 = 'k'.repeat(32);
const T0 = Date.parse('2026-11-01T08:00:00Z');
const 带令牌 = (令牌, 正文 = JSON.stringify({ action: 'ask', message: '找比赛' })) => ({ 方法: 'POST', 头: { authorization: `Bearer ${令牌}` }, 正文 });

function 环境(结果 = { ok: true, data: { reply: '好' } }) {
  const 回答 = vi.fn(async () => 结果);
  return { 回答, 密钥, now: () => T0 };
}

describe('入口 POST /api/assistant', () => {
  test('令牌对：openid 取令牌里的（正文里自己写的 openid 不认），把正文交给回答，原样回 200', async () => {
    const env = 环境();
    const r = await 处理助手请求(带令牌(签发令牌('o-1', 密钥, { now: T0 }), JSON.stringify({ action: 'ask', message: '找比赛', openid: 'o-冒充' })), env);
    expect(r).toEqual({ 状态: 200, 内容: { ok: true, data: { reply: '好' } } });
    expect(env.回答).toHaveBeenCalledWith({ action: 'ask', message: '找比赛', openid: 'o-冒充' }, 'o-1');
  });
  test('没带令牌、签名不对、格式不对：401 unauthenticated，不调回答', async () => {
    const env = 环境();
    const 别的密钥签的 = 签发令牌('o-1', 'z'.repeat(32), { now: T0 });
    for (const 请求 of [{ 方法: 'POST', 头: {}, 正文: '{}' }, 带令牌(别的密钥签的), 带令牌('abc'), { 方法: 'POST', 头: { authorization: 签发令牌('o-1', 密钥, { now: T0 }) }, 正文: '{}' }]) {
      expect(await 处理助手请求(请求, env)).toEqual({ 状态: 401, 内容: { ok: false, message: 'unauthenticated' } });
    }
    expect(env.回答).not.toHaveBeenCalled();
  });
  test('令牌也认正文里的 userSessionToken（小程序这样发，见 apps/miniprogram/services/cloudSession.ts）；它不交给回答', async () => {
    const env = 环境();
    const 正文 = JSON.stringify({ action: 'ask', message: '找比赛', userSessionToken: 签发令牌('o-1', 密钥, { now: T0 }) });
    expect((await 处理助手请求({ 方法: 'POST', 头: {}, 正文 }, env)).状态).toBe(200);
    expect(env.回答).toHaveBeenCalledWith({ action: 'ask', message: '找比赛' }, 'o-1');
  });
  test('令牌过期：401 user_session_expired（小程序已经写好的约定：收到它就重新登录再试一次）', async () => {
    const env = 环境();
    const 旧令牌 = 签发令牌('o-1', 密钥, { now: T0 - 7200 * 1000 });
    expect(await 处理助手请求(带令牌(旧令牌), env)).toEqual({ 状态: 401, 内容: { ok: false, message: 'user_session_expired' } });
    expect(env.回答).not.toHaveBeenCalled();
  });
  test('服务器没配密钥：500，谁都不放行', async () => {
    const env = { ...环境(), 密钥: '' };
    expect(await 处理助手请求(带令牌('a.b'), env)).toEqual({ 状态: 500, 内容: { ok: false, message: 'server_misconfigured' } });
    expect(env.回答).not.toHaveBeenCalled();
  });
  test('不是 POST：405；正文不是 JSON 对象：400；正文太大：413', async () => {
    const env = 环境();
    const 令牌 = 签发令牌('o-1', 密钥, { now: T0 });
    expect((await 处理助手请求({ ...带令牌(令牌), 方法: 'GET' }, env)).状态).toBe(405);
    for (const 正文 of ['不是json', '[1,2]', 'null']) {
      expect(await 处理助手请求(带令牌(令牌, 正文), env)).toEqual({ 状态: 400, 内容: { ok: false, message: 'bad_request' } });
    }
    expect((await 处理助手请求(带令牌(令牌, 'x'.repeat(请求上限 + 1)), env)).状态).toBe(413);
    expect(env.回答).not.toHaveBeenCalled();
  });
  test('回答里抛错：500 assistant_failed，不把错误细节回给小程序', async () => {
    const env = { ...环境(), 回答: async () => { throw new Error('数据库路径 /opt/xxx 打不开'); } };
    const r = await 处理助手请求(带令牌(签发令牌('o-1', 密钥, { now: T0 })), env);
    expect(r).toEqual({ 状态: 500, 内容: { ok: false, message: 'assistant_failed' } });
  });
});
