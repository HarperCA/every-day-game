import { afterEach, expect, it, vi } from 'vitest';

// 会话安全：2026-11-12 起前端只认最终架构——登录、用户数据、公开数据都发北京，赛事助手带北京令牌直连美国。
// 上海云函数、桥接令牌、美国反馈独立域名这些过渡形态已经删掉，这里钉住的是最终形态下的等价保证：
// 令牌复用、请求体改不了 action 和令牌、换账号后旧响应作废、令牌只去该去的域名、会话来源不符拒用。
vi.mock('../apps/miniprogram/services/clientLog', () => ({ reportIssue:vi.fn(), SLOW_THRESHOLD_MS:3000 }));
afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('../apps/miniprogram/config/cloud'); vi.resetModules(); });

function useBeijingMode() {
  vi.doMock('../apps/miniprogram/config/cloud', () => ({
    API_BASE_URL: 'https://beijing.example',
    ASSISTANT_API_BASE_URL: 'https://us.example',
    ASSISTANT_API_PATH: '/new-api/assistant',
  }));
}

const loginOk = { userId:'u1', openid:'trusted-user', isNewUser:false, userSessionToken:'beijing-token' };

it('登录后的请求复用同一张令牌，请求体里的假 action 和假令牌不会生效', async () => {
  vi.resetModules();
  useBeijingMode();
  const login = vi.fn(options => options.success({ code:'wechat-code' }));
  const request = vi.fn(options => options.success({ statusCode:200, data:{ ok:true, data:options.url.endsWith('/api/login') ? loginOk : [] } }));
  vi.stubGlobal('wx', { login, request });
  const session = await import('../apps/miniprogram/services/cloudSession');
  await session.loginWithWechat();
  await session.callUserData('listGeneralFeedback', { action:'adminAction', userSessionToken:'forged', __openid:'victim' });
  expect(login).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[1][0].data).toMatchObject({ action:'listGeneralFeedback', userSessionToken:'beijing-token' });
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

it('换账号后，上一个账号没回来的响应不能被收下', async () => {
  vi.resetModules();
  useBeijingMode();
  const login = vi.fn(options => options.success({ code:'wechat-code' }));
  let complete:any;
  const request = vi.fn()
    .mockImplementationOnce(options => options.success({ statusCode:200, data:{ ok:true, data:{ userId:'a', openid:'a', isNewUser:false, userSessionToken:'token-a' } } }))
    .mockImplementationOnce(options => { complete = options.success; })
    .mockImplementationOnce(options => options.success({ statusCode:200, data:{ ok:true, data:{ userId:'b', openid:'b', isNewUser:false, userSessionToken:'token-b' } } }));
  vi.stubGlobal('wx', { login, request });
  const session = await import('../apps/miniprogram/services/cloudSession');
  await session.loginWithWechat();
  const pending = session.callUserData('listFavorites');
  const rejected = expect(pending).rejects.toThrow('账号已变化');
  await new Promise(resolve => setTimeout(resolve, 0));   // 让 listFavorites 的请求先发出去（挂在第 2 个 mock 上），再换账号
  await session.loginWithWechat();
  complete({ statusCode:200, data:{ ok:true, data:[{ editionId:'account-a-private-favorite' }] } });
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

it('赛事助手直连美国并带北京令牌；用户数据不会发到助手域名', async () => {
  vi.resetModules();
  useBeijingMode();
  const login = vi.fn(options => options.success({ code:'wechat-code' }));
  const request = vi.fn(options => options.success({ statusCode:200, data:{ ok:true, data:options.url.endsWith('/api/login') ? loginOk : options.url.includes('/new-api/assistant') ? { answer:'ok' } : [] } }));
  vi.stubGlobal('wx', { login, request });
  const session = await import('../apps/miniprogram/services/cloudSession');
  await session.loginWithWechat();
  await session.callUserData('listFeedback');
  await session.callAssistant({ question:'你好' });
  const [userCall, assistantCall] = request.mock.calls.slice(1).map(([options]) => options);
  expect(userCall.url).toBe('https://beijing.example/api/userData');
  expect(userCall.data.userSessionToken).toBe('beijing-token');
  expect(assistantCall.url).toBe('https://us.example/new-api/assistant');
  expect(assistantCall.data).toMatchObject({ action:'ask', userSessionToken:'beijing-token' });
});

it('换令牌时返回的会话来源和北京不一致，这张令牌拒用', async () => {
  vi.resetModules();
  useBeijingMode();
  const login = vi.fn(options => options.success({ code:'wechat-code' }));
  const request = vi.fn()
    .mockImplementationOnce(options => options.success({ statusCode:200, data:{ ok:true, data:loginOk } }))
    .mockImplementationOnce(options => options.success({ statusCode:200, data:{ ok:false, message:'user_session_expired' } }))
    .mockImplementationOnce(options => options.success({ statusCode:200, data:{ ok:true, data:{ openid:'trusted-user', userSessionToken:'alien-token', userSessionOrigin:'https://elsewhere.example' } } }));
  vi.stubGlobal('wx', { login, request });
  const session = await import('../apps/miniprogram/services/cloudSession');
  await session.loginWithWechat();
  await expect(session.callUserData('listFavorites')).rejects.toThrow('用户服务来源不匹配');
});
