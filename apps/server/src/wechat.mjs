// 直接对接微信接口——CloudBase 原来帮我们包着的那两件事，现在自己做。
//
// 一、用户身份：小程序 wx.login() 拿到临时 code，服务器拿 AppSecret 去
//     jscode2session 换 openid。原来 cloud.getWXContext() 一行就有，
//     是因为微信和腾讯云之间有内建信任通道；自托管没有这条通道，得自己换。
//
// 二、订阅消息：要先拿 access_token（2 小时有效），再调发送接口。
//     access_token 有调用频率限制，必须缓存复用，不能每次发消息都换一次。
//
// 两个前提需要你在微信公众平台配置（代码解决不了）：
//   - 服务器 IP 加进「IP 白名单」，否则换不到 access_token
//   - 订阅消息模板要先申请审核
//
// 密钥（AppSecret）和其它密钥同一套约定：单行文件、chmod 600、
// 从环境变量读，不写进代码、不进日志。
import fs from 'node:fs';

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session';
const SUBSCRIBE_URL = 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send';
const MSG_SEC_CHECK_URL = 'https://api.weixin.qq.com/wxa/msg_sec_check';

// 微信给的 access_token 有效期 7200 秒。提前 5 分钟换，避免卡在过期边界上
// 出现「刚判断还没过期、请求到微信那边已经过期」。
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000;

function readSecretFile(file) {
  if (!file || !fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8').trim();
}

export function readWeChatConfig(env = process.env) {
  return {
    appId: String(env.WECHAT_APPID || '').trim(),
    appSecret: String(env.WECHAT_APPSECRET || readSecretFile(env.WECHAT_APPSECRET_FILE) || '').trim(),
  };
}

export class WeChatClient {
  constructor(config, request = globalThis.fetch) {
    this.config = config;
    this.request = request;
    this.cachedToken = null;      // { value, expiresAt }
    this.pendingToken = null;     // 并发时共用同一次换取，不重复打微信接口
  }

  get configured() {
    return Boolean(this.config.appId && this.config.appSecret);
  }

  #requireConfig() {
    if (!this.configured) {
      throw new Error('wechat_not_configured:缺少 WECHAT_APPID / WECHAT_APPSECRET');
    }
  }

  async #fetchJson(url) {
    const response = await this.request(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`wechat_http_error:${response.status}`);
    return response.json();
  }

  // 小程序的 code 换 openid。code 是一次性的，换过就作废。
  async exchangeCode(code) {
    this.#requireConfig();
    if (!code) throw new Error('wechat_missing_code');
    const url = `${SESSION_URL}?appid=${encodeURIComponent(this.config.appId)}`
      + `&secret=${encodeURIComponent(this.config.appSecret)}`
      + `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    const payload = await this.#fetchJson(url);
    if (payload.errcode) throw new Error(`wechat_jscode2session_failed:${payload.errcode}:${payload.errmsg || ''}`);
    if (!payload.openid) throw new Error('wechat_jscode2session_no_openid');
    return { openid: payload.openid, unionid: payload.unionid || '', sessionKey: payload.session_key || '' };
  }

  async accessToken() {
    this.#requireConfig();
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - TOKEN_SAFETY_MARGIN_MS > now) {
      return this.cachedToken.value;
    }
    // 并发发送多条提醒时，只让第一个请求去换 token，其余等它。
    if (!this.pendingToken) {
      this.pendingToken = (async () => {
        const url = `${TOKEN_URL}?grant_type=client_credential`
          + `&appid=${encodeURIComponent(this.config.appId)}&secret=${encodeURIComponent(this.config.appSecret)}`;
        const payload = await this.#fetchJson(url);
        if (payload.errcode || !payload.access_token) {
          // 40164 = 调用方 IP 不在白名单里，这是自托管最容易踩的一个坑，
          // 单独把提示写出来，免得对着一串错误码猜。
          const hint = payload.errcode === 40164 ? '（服务器 IP 未加入微信公众平台的 IP 白名单）' : '';
          throw new Error(`wechat_token_failed:${payload.errcode}:${payload.errmsg || ''}${hint}`);
        }
        this.cachedToken = { value: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in || 7200) * 1000 };
        return this.cachedToken.value;
      })().finally(() => { this.pendingToken = null; });
    }
    return this.pendingToken;
  }

  // 形状和 cloud.openapi.subscribeMessage.send 一致，sendReminders 不用改。
  async sendSubscribeMessage({ touser, templateId, page, miniprogramState, lang, data }) {
    const token = await this.accessToken();
    const response = await this.request(`${SUBSCRIBE_URL}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser,
        template_id: templateId,
        page,
        miniprogram_state: miniprogramState,
        lang,
        data,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`wechat_http_error:${response.status}`);
    const payload = await response.json();
    // 42001 = token 过期。清掉缓存让下次重新换，但这一次仍然算失败——
    // 不在这里偷偷重试，失败要让上层看见并按它自己的重试策略处理。
    if (payload.errcode === 42001) this.cachedToken = null;
    if (payload.errcode) throw new Error(`wechat_subscribe_failed:${payload.errcode}:${payload.errmsg || ''}`);
    return payload;
  }

  // 文本内容安全 2.0（官方文档：小程序安全 / 内容安全 / 文本内容安全识别）。
  // 返回微信的原始结果 { errcode, errmsg, result:{ suggest, label }, detail, trace_id }。
  async msgSecCheck({ openid, scene, version = 2, content }) {
    const token = await this.accessToken();
    const response = await this.request(`${MSG_SEC_CHECK_URL}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openid, scene, version, content }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`wechat_http_error:${response.status}`);
    const payload = await response.json();
    // 40001 / 42001 = token 无效或过期：清掉缓存，下次重新换；这一次照样算失败
    if (payload.errcode === 40001 || payload.errcode === 42001) this.cachedToken = null;
    if (payload.errcode) throw new Error(`wechat_msg_sec_check_failed:${payload.errcode}:${payload.errmsg || ''}`);
    return payload;
  }
}

// 装进 CloudBase 外壳的 openapi 位置，让 sendReminders 里
// cloud.openapi.subscribeMessage.send(...) 原样可用。
export function createOpenApi(client) {
  return {
    subscribeMessage: {
      send: options => client.sendSubscribeMessage(options),
    },
    // 赛事助手（assistant 云函数）检测用户提问和 AI 回答；写法和云开发的 cloud.openapi.security.msgSecCheck 一致
    security: {
      msgSecCheck: options => client.msgSecCheck(options),
    },
  };
}
