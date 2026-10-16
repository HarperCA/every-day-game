import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../apps/miniprogram/services/clientLog', () => ({ reportIssue:vi.fn(), SLOW_THRESHOLD_MS:3000 }));
afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('../apps/miniprogram/config/cloud'); vi.resetModules(); });

it('reuses the bridge-issued session and prevents a payload overriding the action', async () => {
  vi.resetModules();
  const login = vi.fn();
  const request = vi.fn(options => options.success({ statusCode:200, data:{ ok:true, data:[] } }));
  vi.stubGlobal('wx', { login, request, cloud:{ init:vi.fn(), callFunction:vi.fn().mockResolvedValue({ result:{ ok:true, data:{ userId:'shanghai-id', openid:'trusted-user', isNewUser:false, userSessionToken:'bridge-token', userSessionOrigin:'https://107-175-111-18.sslip.io' } } }) } });
  const session = await import('../apps/miniprogram/services/cloudSession');
  await session.loginWithWechat();
  await session.callUserData('listGeneralFeedback', { action:'adminAction', __openid:'victim' });
  expect(login).not.toHaveBeenCalled();
  expect(request.mock.calls[0][0].data).toMatchObject({ action:'listGeneralFeedback', userSessionToken:'bridge-token' });
});

it('direct login returns a session used for subsequent requests without a second wx.login', async () => {
  vi.resetModules();
  vi.doMock('../apps/miniprogram/config/cloud', () => ({ API_BASE_URL:'https://beijing.example', CLOUD_ENV_ID:'test', USE_SELF_HOSTED_BACKEND:true, USER_DATA_ON_CLOUD:false }));
  const login = vi.fn(options => options.success({ code:'wechat-code' }));
  const request = vi.fn(options => options.success({ statusCode:200, data:{ ok:true, data:options.url.endsWith('/api/login') ? { userId:'shanghai-id', openid:'trusted-user', isNewUser:false, userSessionToken:'direct-token' } : [] } }));
  vi.stubGlobal('wx', { login, request });
  const session = await import('../apps/miniprogram/services/cloudSession');
  await session.loginWithWechat();
  await session.callUserData('listFavorites');
  expect(login).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[1][0].data).toEqual({ action:'listFavorites', userSessionToken:'direct-token' });
});

it('a cloud user response from the previous account cannot be consumed after another login', async () => {
  vi.resetModules();
  let complete:any;
  const callFunction = vi.fn()
    .mockResolvedValueOnce({ result:{ ok:true, data:{ userId:'a', openid:'a', isNewUser:false } } })
    .mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }))
    .mockResolvedValueOnce({ result:{ ok:true, data:{ userId:'b', openid:'b', isNewUser:false } } });
  vi.stubGlobal('wx', { cloud:{ init:vi.fn(), callFunction } });
  const session = await import('../apps/miniprogram/services/cloudSession');
  await session.loginWithWechat();
  const pending = session.callUserData('listFavorites');
  const rejected = expect(pending).rejects.toThrow('账号已变化');
  await session.loginWithWechat();
  complete({ result:{ ok:true, data:[{ editionId:'account-a-private-favorite' }] } });
  await rejected;
  expect(session.getCurrentUserId()).toBe('b');
});

it('final Beijing mode reads public data directly and never uses Shanghai as fallback', async () => {
  vi.resetModules();
  vi.doMock('../apps/miniprogram/config/cloud', () => ({ API_BASE_URL:'https://beijing.example', BEIJING_BACKEND_ENABLED:true, CLOUD_ENV_ID:'test', USE_SELF_HOSTED_BACKEND:true, USER_DATA_ON_CLOUD:false }));
  const callFunction = vi.fn();
  const request = vi.fn(options => options.success({ statusCode:200, data:{ ok:true, data:{ items:[{ id:'public-id' }], total:1 } } }));
  vi.stubGlobal('wx', { request, cloud:{ init:vi.fn(), callFunction } });
  const session = await import('../apps/miniprogram/services/cloudSession');
  expect(await session.callPublicData('list')).toMatchObject({ total:1 });
  expect(request.mock.calls[0][0].url).toBe('https://beijing.example/api/publicData');
  expect(callFunction).not.toHaveBeenCalled();
  request.mockImplementationOnce(options => options.fail({ errMsg:'request:fail timeout' }));
  await expect(session.callPublicData('list')).rejects.toThrow('网络不太稳定');
  expect(callFunction).not.toHaveBeenCalled();
});

it('keeps American feedback history on its own origin and never sends a Beijing token there', async () => {
  vi.resetModules();
  vi.doMock('../apps/miniprogram/config/cloud', () => ({ API_BASE_URL:'https://beijing.example', FEEDBACK_API_BASE_URL:'https://us.example', BEIJING_BACKEND_ENABLED:true, CLOUD_ENV_ID:'test', USE_SELF_HOSTED_BACKEND:true, USER_DATA_ON_CLOUD:false }));
  const login = vi.fn(options => options.success({ code:'wechat-code' }));
  const request = vi.fn(options => {
    const us = options.url.startsWith('https://us.example');
    options.success({ statusCode:200, data:{ ok:true, data:options.url.endsWith('/api/login') ? { userId:us ? 'us-account-id' : 'shanghai-id', openid:'trusted-user', isNewUser:false, userSessionToken:us ? 'us-token' : 'beijing-token' } : us ? [{ id:'old-feedback' }] : [] } });
  });
  vi.stubGlobal('wx', { login, request });
  const session = await import('../apps/miniprogram/services/cloudSession');
  await session.loginWithWechat();
  expect(await session.callUserData('listGeneralFeedback')).toEqual([{ id:'old-feedback' }]);
  await session.callUserData('listFeedback');
  await session.callUserData('listFavorites');
  expect(login).toHaveBeenCalledTimes(2);
  const userCalls = request.mock.calls.map(([options]) => options).filter(options => options.url.endsWith('/api/userData'));
  expect(userCalls.map(options => [options.url, options.data.userSessionToken])).toEqual([
    ['https://us.example/api/userData', 'us-token'],
    ['https://us.example/api/userData', 'us-token'],
    ['https://beijing.example/api/userData', 'beijing-token'],
  ]);
  expect(session.getCurrentUserId()).toBe('shanghai-id');
});

it('does not assign a Beijing cloud bridge token to the legacy American feedback origin', async () => {
  vi.resetModules();
  const login = vi.fn(options => options.success({ code:'us-code' }));
  const request = vi.fn(options => options.success({ statusCode:200, data:{ ok:true, data:options.url.endsWith('/api/login') ? { openid:'trusted-user', userSessionToken:'us-token' } : [] } }));
  vi.stubGlobal('wx', { login, request, cloud:{ init:vi.fn(), callFunction:vi.fn().mockResolvedValue({ result:{ ok:true, data:{ userId:'shanghai-id', openid:'trusted-user', isNewUser:false, userSessionToken:'beijing-token', userSessionOrigin:'https://beijing.example' } } }) } });
  const session = await import('../apps/miniprogram/services/cloudSession');
  await session.loginWithWechat();
  await session.callUserData('listFeedback');
  expect(login).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[1][0].data.userSessionToken).toBe('us-token');
});
