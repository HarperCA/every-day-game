import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('../apps/miniprogram/config/cloud'); vi.resetModules(); });
function setup() {
  vi.resetModules();
  vi.doMock('../apps/miniprogram/config/cloud', () => ({ API_BASE_URL:'https://beijing.example', BEIJING_BACKEND_ENABLED:true, CLOUD_ENV_ID:'test' }));
  const storage = new Map<string, any>();
  const callFunction = vi.fn();
  const request = vi.fn();
  vi.stubGlobal('wx', { request, getStorageSync:(key:string) => storage.get(key), setStorageSync:(key:string, value:any) => storage.set(key, value), cloud:{ init:vi.fn(), callFunction } });
  vi.stubGlobal('getCurrentPages', () => []);
  return { storage, request, callFunction };
}
it('sends anonymous logs to Beijing and removes only accepted records', async () => {
  const { storage, request, callFunction } = setup();
  let respond:any;
  request.mockImplementation(options => { respond = options.success; });
  const log = await import('../apps/miniprogram/services/clientLog');
  log.reportIssue('load_failed', { action:'publicData.list', message:'test' });
  expect(request.mock.calls[0][0].url).toBe('https://beijing.example/api/clientLog');
  const sent = request.mock.calls[0][0].data.events[0];
  expect(sent.openid).toBeUndefined();
  storage.set('client_issue_pending', [...storage.get('client_issue_pending'), { id:'later-event', kind:'slow' }]);
  respond({ statusCode:200, data:{ ok:true, saved:1 } });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(storage.get('client_issue_pending').map((item:any) => item.id)).toEqual(['later-event']);
  respond({ statusCode:200, data:{ ok:true, saved:1 } });
  await vi.waitFor(() => expect(storage.get('client_issue_pending')).toEqual([]));
  expect(callFunction).not.toHaveBeenCalled();
});
it('retains failed Beijing logs for later retry and never falls back to Shanghai', async () => {
  const { storage, request, callFunction } = setup();
  request.mockImplementation(options => options.fail({ errMsg:'timeout' }));
  const log = await import('../apps/miniprogram/services/clientLog');
  log.reportIssue('js_error', { message:'test' });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(storage.get('client_issue_pending')).toHaveLength(1);
  expect(callFunction).not.toHaveBeenCalled();
});
