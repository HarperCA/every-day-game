import { expect, it, vi } from 'vitest';
vi.mock('../apps/miniprogram/services/clientLog', () => ({ reportIssue:vi.fn(), SLOW_THRESHOLD_MS:3000 }));

it('a late login result cannot replace the newer account', async () => {
  vi.resetModules();
  const login = vi.fn(options => options.success({ code:'wechat-code' }));
  const request = vi.fn();
  vi.stubGlobal('wx', { login, request });
  const session = await import('../apps/miniprogram/services/cloudSession');
  const first = session.loginWithWechat();
  const rejected = expect(first).rejects.toThrow('登录请求已过期');
  const second = session.loginWithWechat();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(request.mock.calls.map(([options]) => options.url)).toEqual([
    'https://xiaohuiworks.cn/api/login',
    'https://xiaohuiworks.cn/api/login',
  ]);
  const respond = (index:number, id:string) => request.mock.calls[index][0].success({
    statusCode:200,
    data:{ ok:true, data:{ userId:id, openid:`openid-${id}`, isNewUser:false, userSessionToken:`token-${id}` } },
  });
  respond(1, 'b');
  await second;
  respond(0, 'a');
  await rejected;
  expect(session.getCurrentUserId()).toBe('b');
  expect(session.isCloudSessionReady()).toBe(true);
  vi.unstubAllGlobals();
});
