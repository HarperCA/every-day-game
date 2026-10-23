// 提醒发送服务（美国服务器常驻，systemd：daily-contest-reminder-dispatcher）。
//
// 2026-10-24 起提醒由这里发：上海云函数经 HTTP 触发时用不了云调用（subscribeMessage.send 报 -501001），
// 而本机用小程序 AppID/AppSecret 换的稳定版凭证可以直接调微信“发送订阅消息”接口。
//   ① 上海 userData 保存提醒后，把两小时内到期的提醒（只有文档编号和时间）推到 POST /reminder-push；
//   ② 每小时（以及启动时）向上海 sendReminders 的 listUpcoming 对账一次，补上漏推、改时间、取消的；
//   ③ 到点向上海 claim 领取：上海重新校验后交回发送内容（含 openid），这里调微信发送，再 report 回写结果。
// 推送内容不受信任：到点一律以上海 claim 的校验为准，所以伪造推送发不出消息。
import fs from 'node:fs';
import http from 'node:http';

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

function readSecretFile(file) {
  return fs.readFileSync(file, 'utf8').trim();
}

function createShanghaiCall({ endpoint, secret, fetchImpl = fetch }) {
  return async (action, params) => {
    const response = await fetchImpl(endpoint, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ action, dispatchSecret:secret, ...params }), signal:AbortSignal.timeout(30_000) });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`shanghai_${action}_bad_response_${response.status}`); }
    if (!response.ok || data?.errorCode || data?.errorMessage) throw new Error(`shanghai_${action}_failed_${response.status}_${String(data?.errorMessage || '').slice(0, 120)}`);
    return data;
  };
}

// 稳定版凭证（cgi-bin/stable_token，不强制刷新）：不会顶掉其他地方正在用的凭证
function createWeChatSender({ appid, secret, fetchImpl = fetch, now = () => Date.now() }) {
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

function main() {
  const port = Number(process.env.PORT || 8790);
  const host = process.env.HOST || '127.0.0.1';
  const dispatcher = createDispatcher({
    shanghaiCall:createShanghaiCall({ endpoint:process.env.SHANGHAI_ENDPOINT, secret:readSecretFile(process.env.DISPATCH_SECRET_FILE) }),
    sendSubscribe:createWeChatSender({ appid:process.env.WECHAT_APPID, secret:readSecretFile(process.env.WECHAT_APPSECRET_FILE) }),
  });
  let windowStart = Date.now();
  let windowCount = 0;
  const server = http.createServer((request, response) => {
    const reply = (status, body) => { response.writeHead(status, { 'content-type':'application/json' }); response.end(JSON.stringify(body)); };
    if (request.method === 'GET' && request.url === '/reminder-push/health') {
      return reply(200, { ok:true, planned:dispatcher.plan.size, stats:dispatcher.stats });
    }
    if (request.method !== 'POST' || request.url !== '/reminder-push') return reply(404, { ok:false });
    if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); windowCount = 0; }
    if (++windowCount > MAX_PUSHES_PER_MINUTE) return reply(429, { ok:false });
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { raw += chunk; if (raw.length > MAX_PUSH_BYTES) request.destroy(); });
    request.on('end', () => {
      try { reply(200, { ok:true, scheduled:dispatcher.acceptPush(JSON.parse(raw || '{}')) }); } catch { reply(400, { ok:false }); }
    });
  });
  server.listen(port, host, () => console.log(`reminder dispatcher listening on ${host}:${port}`));
  const reconcile = () => dispatcher.reconcile()
    .then(count => console.log('reconcile scheduled', count))
    .catch(error => { dispatcher.stats.lastError = String(error.message || error); console.error('reconcile failed', error.message || error); });
  reconcile();
  setInterval(reconcile, Number(process.env.RECONCILE_MS || 60 * 60 * 1000));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
