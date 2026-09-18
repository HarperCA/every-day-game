import { describe, expect, it } from 'vitest';
import { WeChatClient, createOpenApi } from '../apps/server/src/wechat.mjs';

// CloudBase 原来帮我们管着 access_token 和身份换取，自托管后这些要自己做。
// 这里钉住几条最容易出错、出错了又不容易发现的行为。
const config = { appId: 'wx-test', appSecret: 'secret-test' };

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('用 code 换身份', () => {
  it('换到 openid', async () => {
    const client = new WeChatClient(config, async () => jsonResponse({ openid: 'o123', unionid: 'u1', session_key: 'k' }));
    expect(await client.exchangeCode('code-1')).toEqual({ openid: 'o123', unionid: 'u1', sessionKey: 'k' });
  });

  it('微信报错时抛出来，不当成没登录成功悄悄过去', async () => {
    const client = new WeChatClient(config, async () => jsonResponse({ errcode: 40029, errmsg: 'invalid code' }));
    await expect(client.exchangeCode('bad')).rejects.toThrow(/wechat_jscode2session_failed:40029/);
  });

  it('没配 AppSecret 时明确报错', async () => {
    const client = new WeChatClient({ appId: '', appSecret: '' });
    await expect(client.exchangeCode('c')).rejects.toThrow(/wechat_not_configured/);
  });
});

describe('access_token 缓存', () => {
  it('第二次调用直接用缓存，不再打微信接口', async () => {
    let calls = 0;
    const client = new WeChatClient(config, async () => {
      calls += 1;
      return jsonResponse({ access_token: 'tok-1', expires_in: 7200 });
    });
    expect(await client.accessToken()).toBe('tok-1');
    expect(await client.accessToken()).toBe('tok-1');
    expect(calls).toBe(1);
  });

  it('并发取 token 只换一次——批量发提醒时不能把频率配额打满', async () => {
    let calls = 0;
    const client = new WeChatClient(config, async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return jsonResponse({ access_token: 'tok-1', expires_in: 7200 });
    });
    const tokens = await Promise.all([client.accessToken(), client.accessToken(), client.accessToken()]);
    expect(tokens).toEqual(['tok-1', 'tok-1', 'tok-1']);
    expect(calls).toBe(1);
  });

  it('快过期时提前换新的，不卡在过期边界上', async () => {
    let calls = 0;
    const client = new WeChatClient(config, async () => {
      calls += 1;
      return jsonResponse({ access_token: `tok-${calls}`, expires_in: 7200 });
    });
    await client.accessToken();
    // 手动把到期时间挪到 1 分钟后：还没过期，但已进入 5 分钟安全区
    client.cachedToken.expiresAt = Date.now() + 60 * 1000;
    expect(await client.accessToken()).toBe('tok-2');
  });

  it('IP 不在白名单（40164）时给出可读提示，不是让人对着错误码猜', async () => {
    const client = new WeChatClient(config, async () => jsonResponse({ errcode: 40164, errmsg: 'invalid ip' }));
    await expect(client.accessToken()).rejects.toThrow(/IP 白名单/);
  });
});

describe('发订阅消息', () => {
  it('按微信要求的字段名转换（templateId → template_id）', async () => {
    let sentBody = null;
    const client = new WeChatClient(config, async (url, options) => {
      if (url.includes('cgi-bin/token')) return jsonResponse({ access_token: 'tok', expires_in: 7200 });
      sentBody = JSON.parse(options.body);
      return jsonResponse({ errcode: 0 });
    });
    await client.sendSubscribeMessage({
      touser: 'o1', templateId: 'tpl-1', page: 'pages/detail/detail?id=x',
      miniprogramState: 'developer', lang: 'zh_CN', data: { thing1: { value: '测试' } },
    });
    expect(sentBody).toMatchObject({ touser: 'o1', template_id: 'tpl-1', miniprogram_state: 'developer' });
  });

  it('发送失败要抛错——消息没发出去不能被吞掉', async () => {
    const client = new WeChatClient(config, async url => (url.includes('cgi-bin/token')
      ? jsonResponse({ access_token: 'tok', expires_in: 7200 })
      : jsonResponse({ errcode: 43101, errmsg: 'user refuse to accept the msg' })));
    await expect(client.sendSubscribeMessage({ touser: 'o1', templateId: 't', data: {} }))
      .rejects.toThrow(/wechat_subscribe_failed:43101/);
  });

  it('token 过期（42001）时清掉缓存，但这一次仍然算失败', async () => {
    const client = new WeChatClient(config, async url => (url.includes('cgi-bin/token')
      ? jsonResponse({ access_token: 'tok', expires_in: 7200 })
      : jsonResponse({ errcode: 42001, errmsg: 'access_token expired' })));
    await expect(client.sendSubscribeMessage({ touser: 'o1', templateId: 't', data: {} })).rejects.toThrow(/42001/);
    // 缓存已清空，下次会重新换；但不在这里偷偷重试——失败要让上层看见
    expect(client.cachedToken).toBeNull();
  });
});

describe('接口形状和 CloudBase 保持一致', () => {
  it('createOpenApi 暴露 subscribeMessage.send，sendReminders 不用改', async () => {
    const client = new WeChatClient(config, async url => (url.includes('cgi-bin/token')
      ? jsonResponse({ access_token: 'tok', expires_in: 7200 })
      : jsonResponse({ errcode: 0 })));
    const openapi = createOpenApi(client);
    await expect(openapi.subscribeMessage.send({ touser: 'o1', templateId: 't', data: {} })).resolves.toMatchObject({ errcode: 0 });
  });
});
