import { describe, expect, it } from 'vitest';
import { WeChatClient, createOpenApi } from '../apps/server/src/wechat.mjs';

// 文本内容安全 2.0：赛事助手检测用户提问和 AI 回答用（apps/miniprogram/cloudfunctions/assistant/secCheck.js）
const config = { appId:'wx-test', appSecret:'secret-test' };
const jsonResponse = (body, status = 200) => ({ ok:status >= 200 && status < 300, status, json:async () => body });

function client(checkResponse) {
  const requests = [];
  const wechat = new WeChatClient(config, async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes('/cgi-bin/token')) return jsonResponse({ access_token:'tok-1', expires_in:7200 });
    return typeof checkResponse === 'function' ? checkResponse() : checkResponse;
  });
  return { wechat, requests };
}

describe('文本内容安全 msgSecCheck', () => {
  it('请求地址带 access_token，请求体是 openid、scene、version、content', async () => {
    const { wechat, requests } = client(jsonResponse({ errcode:0, errmsg:'ok', result:{ suggest:'pass', label:100 }, trace_id:'t-1' }));
    const result = await wechat.msgSecCheck({ openid:'o1', scene:2, content:'找比赛' });
    expect(result.result.suggest).toBe('pass');
    const check = requests.find(request => request.url.includes('/wxa/msg_sec_check'));
    expect(check.url).toBe('https://api.weixin.qq.com/wxa/msg_sec_check?access_token=tok-1');
    expect(check.options.method).toBe('POST');
    expect(JSON.parse(check.options.body)).toEqual({ openid:'o1', scene:2, version:2, content:'找比赛' });
  });

  it('token 无效或过期（40001 / 42001）：清掉缓存并报错', async () => {
    for (const errcode of [40001, 42001]) {
      const { wechat } = client(jsonResponse({ errcode, errmsg:'invalid credential' }));
      await expect(wechat.msgSecCheck({ openid:'o1', scene:2, content:'x' })).rejects.toThrow(`wechat_msg_sec_check_failed:${errcode}`);
      expect(wechat.cachedToken).toBeNull();
    }
  });

  it('其他错误码照样报错', async () => {
    const { wechat } = client(jsonResponse({ errcode:61010, errmsg:'code is expired' }));
    await expect(wechat.msgSecCheck({ openid:'o1', scene:2, content:'x' })).rejects.toThrow('wechat_msg_sec_check_failed:61010');
  });

  it('HTTP 非 2xx：报 wechat_http_error', async () => {
    const { wechat } = client(jsonResponse({}, 502));
    await expect(wechat.msgSecCheck({ openid:'o1', scene:2, content:'x' })).rejects.toThrow('wechat_http_error:502');
  });

  it('createOpenApi 提供和云开发同名的 security.msgSecCheck', async () => {
    const { wechat } = client(jsonResponse({ errcode:0, result:{ suggest:'risky', label:20001 } }));
    const openapi = createOpenApi(wechat);
    expect((await openapi.security.msgSecCheck({ openid:'o1', scene:2, version:2, content:'x' })).result.suggest).toBe('risky');
  });
});
