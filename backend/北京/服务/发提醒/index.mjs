// 发提醒：到时间的提醒发订阅消息（2026-11-02）。说明见同目录 README.md。
// 上海时期分两半：上海 sendReminders 管提醒数据（列出、领取、回写），美国 reminder-dispatcher 排计划、到点发微信。北京两半在同一台机器上：
//   状态机.mjs   上海的列出、领取、回写、回收超时，存取改成用户库
//   调度.mjs     美国的排计划、发送（原样），原来经网络调上海，现在直接调本机的状态机
//   保存提醒后：用户数据服务把两小时内到期的交给 排上（原来上海推给美国）；其余的每小时对账一次排进计划
//   跟上时间.mjs 美国推来的报名时间变了就调整待发送的提醒（对账前、领取前各对一次）
//
//   handle({ action: 'listUpcoming' | 'claim' | 'report', ... }, { 用户库, 主库, now })   本机调度用；会交出 openid，北京入口不对外开放，带用户身份调用一律拒绝
//   启动发提醒({ 用户库, 主库, sendSubscribe | 微信配置: { appid, secret }, 对账间隔, log, 关着 }) → { 关着, dispatcher, 对账, 排上(提醒们), 停 }
//     环境变量 REMINDER_DISPATCH=off 时关着：不对账、不排计划、不发微信
//   快到期的(提醒们) → [{ key, remindAt }]   两小时内到期、仍可发送的（规则同上海 userData 的 reminderPushItems）
import { createDispatcher, createWeChatSender } from './调度.mjs';
import { claim, listUpcoming, report, 回收超时 } from './状态机.mjs';
import { 跟上时间 } from './跟上时间.mjs';

const PUSH_HORIZON_MS = 2 * 60 * 60 * 1000;
const DELIVERABLE = ['normal', 'time_updated', 'postponed'];
const 动作们 = { listUpcoming, claim, report };

export async function handle(request = {}, { 用户库, 主库, openid, now = () => new Date() } = {}) {
  if (openid) throw new Error('direct_user_invocation_forbidden');
  const { action, ...event } = request;
  if (!Object.hasOwn(动作们, action)) throw new Error('unsupported_action');
  const 现在 = now();
  回收超时(用户库, 现在);
  // 报名时间变了先把提醒对上（跟上时间.mjs）：对账时全部对一遍，领取前只对这一条；没给主库就不对
  if (主库 && action === 'listUpcoming') 跟上时间(用户库, 主库, 现在);
  if (主库 && action === 'claim' && typeof event.key === 'string') 跟上时间(用户库, 主库, 现在, { 提醒id: event.key });
  return 动作们[action](用户库, 现在, event);
}

export function 快到期的(documents, now = Date.now()) {
  return (documents || []).filter(item => item && item.id
    && item.authorization_status === 'accepted'
    && ['pending', 'failed'].includes(item.delivery_status)
    && DELIVERABLE.includes(item.schedule_change_status)
    && Number.isFinite(new Date(item.remind_at).getTime())
    && new Date(item.remind_at).getTime() <= now + PUSH_HORIZON_MS)
    .map(item => ({ key: String(item.id), remindAt: new Date(item.remind_at).toISOString() }));
}

export function 启动发提醒({ 用户库, 主库, sendSubscribe, 微信配置 = {}, 对账间隔 = 60 * 60 * 1000, log = console.log, 关着 = process.env.REMINDER_DISPATCH === 'off' }) {
  // 开关（2026-11-04）：旧用户数据搬进北京后、正式切换前旧系统还在发提醒，北京也发的话用户会收到两遍、白白消耗订阅授权。切换时去掉 REMINDER_DISPATCH=off
  if (关着) {
    log('发提醒：关着（REMINDER_DISPATCH=off），不对账、不发微信');
    return { 关着: true, dispatcher: null, 对账: async () => 0, 排上: () => 0, 停: () => {} };
  }
  const dispatcher = createDispatcher({
    shanghaiCall: (action, params) => handle({ action, ...params }, { 用户库, 主库 }),
    sendSubscribe: sendSubscribe || createWeChatSender({ appid: 微信配置.appid, secret: 微信配置.secret }),
    log,
  });
  const 对账 = () => dispatcher.reconcile()
    .then(count => { log('发提醒：对账排上', count); return count; })
    .catch(error => { dispatcher.stats.lastError = String(error.message || error); log('发提醒：对账失败', error.message || error); return 0; });
  let 定时 = null;
  if (对账间隔 > 0) { 对账(); 定时 = setInterval(对账, 对账间隔); }
  return {
    关着: false,
    dispatcher,
    对账,
    排上: 提醒们 => dispatcher.acceptPush({ items: 快到期的(提醒们) }),
    停: () => { if (定时) clearInterval(定时); for (const { timer } of dispatcher.plan.values()) clearTimeout(timer); dispatcher.plan.clear(); },
  };
}
