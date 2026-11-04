// 发提醒的调度：搬自美国服务器的 reminder-dispatcher.mjs（2026-11-02），排计划、到点领取、发微信、回写结果的部分原样。
// 原来“领取、回写”经网络调上海 sendReminders（shanghaiCall）；北京在同一台机器上，shanghaiCall 换成本机的状态机（见 index.mjs 的 启动发提醒），
// 名字沿用旧代码。不搬的：接收上海推送的 HTTP 入口（北京保存提醒后直接调 排上）、读密钥文件和启动入口（由 启动发提醒 管）。
//
//   createDispatcher({ shanghaiCall, sendSubscribe, now, setTimer, clearTimer, log }) → { schedule, fire, acceptPush, reconcile, plan, stats, idle }
//   createWeChatSender({ appid, secret }) → 发一条订阅消息（稳定版凭证，结果不明时交回 uncertain，不自动重发）
const KEY_PATTERN = /^[\w.:-]{1,128}$/;
export const WINDOW_MS = 2 * 60 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const MAX_PUSH_ITEMS = 20;
const MAX_PUSH_BYTES = 8 * 1024;
const MAX_PUSHES_PER_MINUTE = 120;

// 推送里的一条提醒是否值得排进计划：编号合法、时间在“过期 24 小时内”到“两小时（加 5 分钟余量）内”
export function acceptPushItem(item, now) {
  if (!item || typeof item.key !== 'string' || !KEY_PATTERN.test(item.key)) return null;
  const at = new Date(item.remindAt).getTime();
  if (!Number.isFinite(at) || at < now - STALE_MS || at > now + WINDOW_MS + 5 * 60 * 1000) return null;
  return { key:item.key, at };
}

// 微信发送结果 → 回写给上海的 report 参数
export function reportForSendResult(result) {
  if (result && result.errcode === 0) return { ok:true };
  if (result && result.uncertain) return { ok:false, uncertain:true, error:result.error || 'send_result_unknown' };
  return { ok:false, error:`${result?.errcode ?? 'send_failed'}: ${result?.errmsg || result?.error || ''}`.slice(0, 500) };
}

export function createDispatcher({ shanghaiCall, sendSubscribe, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, log = console.log }) {
  const plan = new Map(); // key -> { at, timer }
  let chain = Promise.resolve();
  const stats = { pushed:0, reconciled:0, sent:0, failed:0, skipped:0, lastReconcileAt:null, lastError:null };

  function schedule(key, at) {
    const current = plan.get(key);
    if (current && current.at === at) return false;
    if (current) clearTimer(current.timer);
    const timer = setTimer(() => { plan.delete(key); chain = chain.then(() => fire(key)).catch(error => { stats.lastError = String(error.message || error); }); }, Math.max(0, at - now()));
    plan.set(key, { at, timer });
    return true;
  }

  async function fire(key) {
    const claimed = await shanghaiCall('claim', { key });
    if (claimed.status === 'reschedule') {
      const at = new Date(claimed.remindAt).getTime();
      if (Number.isFinite(at) && at <= now() + WINDOW_MS) schedule(key, at);
      return;
    }
    if (claimed.status !== 'ready') { stats.skipped += 1; log('reminder skip', key, claimed.status, claimed.reason || ''); return; }
    const result = await sendSubscribe(claimed.payload);
    const report = reportForSendResult(result);
    await shanghaiCall('report', { key, ...report });
    if (report.ok) stats.sent += 1; else stats.failed += 1;
    log('reminder', report.ok ? 'sent' : 'failed', key, report.error || '');
  }

  function acceptPush(body) {
    const items = Array.isArray(body?.items) ? body.items.slice(0, MAX_PUSH_ITEMS) : [];
    let scheduled = 0;
    for (const raw of items) {
      const item = acceptPushItem(raw, now());
      if (item && schedule(item.key, item.at)) scheduled += 1;
    }
    stats.pushed += scheduled;
    return scheduled;
  }

  async function reconcile() {
    const result = await shanghaiCall('listUpcoming', { withinMs:WINDOW_MS });
    let scheduled = 0;
    for (const raw of result.items || []) {
      const at = new Date(raw.remindAt).getTime();
      if (KEY_PATTERN.test(String(raw.key)) && Number.isFinite(at) && schedule(String(raw.key), raw.stale ? now() : at)) scheduled += 1;
    }
    stats.reconciled += scheduled;
    stats.lastReconcileAt = new Date(now()).toISOString();
    return scheduled;
  }

  return { schedule, fire, acceptPush, reconcile, plan, stats, idle:() => chain };
}

// 稳定版凭证（cgi-bin/stable_token，不强制刷新）：不会顶掉其他地方正在用的凭证
export function createWeChatSender({ appid, secret, fetchImpl = fetch, now = () => Date.now() }) {
  let cached = null;
  async function token(force = false) {
    if (!force && cached && cached.expiresAt > now()) return cached.value;
    const response = await fetchImpl('https://api.weixin.qq.com/cgi-bin/stable_token', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ grant_type:'client_credential', appid, secret, force_refresh:false }), signal:AbortSignal.timeout(15_000) });
    const data = await response.json();
    if (!data.access_token) throw new Error(`stable_token_failed_${data.errcode}`);
    cached = { value:data.access_token, expiresAt:now() + (Number(data.expires_in || 7200) - 300) * 1000 };
    return cached.value;
  }
  return async payload => {
    let accessToken;
    try { accessToken = await token(); } catch (error) { return { errcode:-1, errmsg:error.message }; }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let data;
      try {
        const response = await fetchImpl(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(accessToken)}`, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(payload), signal:AbortSignal.timeout(15_000) });
        data = await response.json();
      } catch (error) {
        // 请求已发出但没拿到结果：不知道微信有没有发，交给上海标成人工处理，不自动重发
        return { uncertain:true, error:`send_no_response: ${error.message}` };
      }
      if ((data.errcode === 40001 || data.errcode === 42001) && attempt === 0) { cached = null; accessToken = await token(); continue; }
      return data;
    }
    return { errcode:-1, errmsg:'token_retry_exhausted' };
  };
}
