import { expect, it, vi } from 'vitest';
vi.mock('../apps/miniprogram/services/clientLog', () => ({ reportIssue:vi.fn(), SLOW_THRESHOLD_MS:3000 }));

it('a late login result cannot replace the newer account', async () => {
  vi.resetModules();
  let resolveFirst:any;
  let resolveSecond:any;
  const callFunction = vi.fn()
    .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
  vi.stubGlobal('wx', { cloud:{ init:vi.fn(), callFunction } });
  const session = await import('../apps/miniprogram/services/cloudSession');
  const first = session.loginWithWechat();
  const rejected = expect(first).rejects.toThrow('登录请求已过期');
  const second = session.loginWithWechat();
  resolveSecond({result:{ok:true,data:{userId:'b',openid:'openid-b',isNewUser:false}}});
  await second;
  resolveFirst({result:{ok:true,data:{userId:'a',openid:'openid-a',isNewUser:false}}});
  await rejected;
  expect(session.getCurrentUserId()).toBe('b');
  expect(session.isCloudSessionReady()).toBe(true);
  vi.unstubAllGlobals();
});
