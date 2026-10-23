import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { acceptPushItem, createDispatcher, reportForSendResult, WINDOW_MS } from '../scripts/server/reminder-dispatcher.mjs';
const require = createRequire(import.meta.url);
const { buildSubscribePayload, isAuthorizedDispatch, requireReminderKey, upcomingWindowMs } = require('../apps/miniprogram/cloudfunctions/sendReminders/reminderDelivery.js');
const { pushReminders, reminderPushItems } = require('../apps/miniprogram/cloudfunctions/userData/reminderPush.js');

const SECRET = 'y'.repeat(32);
afterEach(() => { vi.useRealTimers(); });

describe('提醒发送改由美国服务器：上海侧的辅助函数', () => {
  it('调度密钥可以用于 listUpcoming / claim / report，其他动作仍然拒绝', () => {
    for (const action of ['dispatch', 'listUpcoming', 'claim', 'report']) expect(isAuthorizedDispatch({ action, dispatchSecret:SECRET }, SECRET)).toBe(true);
    expect(isAuthorizedDispatch({ action:'listReminders', dispatchSecret:SECRET }, SECRET)).toBe(false);
  });
  it('提醒编号只接受常见字符', () => {
    expect(requireReminderKey('reminder-e1-deadline-1d-1761270000000')).toBe('reminder-e1-deadline-1d-1761270000000');
    expect(() => requireReminderKey({ $ne:'' })).toThrow('invalid_reminder_key');
    expect(() => requireReminderKey('a b')).toThrow('invalid_reminder_key');
  });
  it('对账窗口默认两小时，最长六小时', () => {
    expect(upcomingWindowMs(undefined)).toBe(2 * 3600e3);
    expect(upcomingWindowMs(99 * 3600e3)).toBe(6 * 3600e3);
  });
  it('发送内容按模板字段生成，标题截到 20 字，默认打开正式版', () => {
    const payload = buildSubscribePayload({ edition_id:'e 1', task_name:'一'.repeat(30), event_label:'报名截止', remind_at:'2026-10-24T02:00:00Z' }, 'oid', { templateId:'T' });
    expect(payload).toMatchObject({ touser:'oid', template_id:'T', page:'pages/detail/detail?id=e%201', miniprogram_state:'formal' });
    expect(payload.data.thing1.value).toHaveLength(20);
    expect(payload.data.time3.value).toBe('2026年10月24日 10:00');
  });
});

describe('上海 userData 保存后推送', () => {
  const doc = (over = {}) => ({ _id:'d1', authorization_status:'accepted', delivery_status:'pending', schedule_change_status:'normal', remind_at:new Date(Date.now() + 600e3).toISOString(), ...over });
  it('只推两小时内到期、仍可发送的提醒，只带编号和时间', () => {
    const items = reminderPushItems([doc(), doc({ _id:'far', remind_at:new Date(Date.now() + 5 * 3600e3).toISOString() }), doc({ _id:'sent', delivery_status:'sent' }), doc({ _id:'no', authorization_status:'rejected' })]);
    expect(items.map(item => item.key)).toEqual(['d1']);
    expect(Object.keys(items[0])).toEqual(['key', 'remindAt']);
  });
  it('没有要推的就不发请求；推送失败不抛错', async () => {
    const post = vi.fn(async () => 0);
    expect(await pushReminders([doc({ delivery_status:'sent' })], { post })).toEqual({ pushed:0 });
    expect(post).not.toHaveBeenCalled();
    expect(await pushReminders([doc()], { post })).toEqual({ pushed:0 });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('美国服务器 reminder-dispatcher', () => {
  it('推送条目的编号和时间范围要合法', () => {
    const now = Date.parse('2026-10-24T00:00:00Z');
    expect(acceptPushItem({ key:'d1', remindAt:'2026-10-24T01:00:00Z' }, now)).toEqual({ key:'d1', at:Date.parse('2026-10-24T01:00:00Z') });
    expect(acceptPushItem({ key:'d1', remindAt:'2026-10-25T01:00:00Z' }, now)).toBeNull();
    expect(acceptPushItem({ key:'a b', remindAt:'2026-10-24T01:00:00Z' }, now)).toBeNull();
  });
  it('微信结果转成回写参数：成功、普通失败、结果不明', () => {
    expect(reportForSendResult({ errcode:0 })).toEqual({ ok:true });
    expect(reportForSendResult({ errcode:43101, errmsg:'user refuse' })).toMatchObject({ ok:false, error:'43101: user refuse' });
    expect(reportForSendResult({ uncertain:true, error:'timeout' })).toEqual({ ok:false, uncertain:true, error:'timeout' });
  });
  it('到点领取、发送、回写；同一条只排一个计划', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-24T00:00:00Z'));
    const calls = [];
    const shanghaiCall = vi.fn(async (action, params) => { calls.push([action, params]); return action === 'claim' ? { status:'ready', payload:{ touser:'oid' } } : { status:'sent' }; });
    const sendSubscribe = vi.fn(async () => ({ errcode:0 }));
    const dispatcher = createDispatcher({ shanghaiCall, sendSubscribe, log:() => {} });
    expect(dispatcher.acceptPush({ items:[{ key:'d1', remindAt:'2026-10-24T00:00:30Z' }, { key:'d1', remindAt:'2026-10-24T00:00:30Z' }] })).toBe(1);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(sendSubscribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    await dispatcher.idle();
    expect(sendSubscribe).toHaveBeenCalledWith({ touser:'oid' });
    expect(calls).toEqual([['claim', { key:'d1' }], ['report', { key:'d1', ok:true }]]);
    expect(dispatcher.stats.sent).toBe(1);
  });
  it('上海说时间改了就按新时间重排，跳过的不发送', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-24T00:00:00Z'));
    const replies = [{ status:'reschedule', remindAt:'2026-10-24T00:10:00Z' }, { status:'skip', reason:'state' }];
    const shanghaiCall = vi.fn(async () => replies.shift());
    const sendSubscribe = vi.fn();
    const dispatcher = createDispatcher({ shanghaiCall, sendSubscribe, log:() => {} });
    dispatcher.schedule('d1', Date.now());
    await vi.advanceTimersByTimeAsync(10);
    await dispatcher.idle();
    expect(dispatcher.plan.get('d1').at).toBe(Date.parse('2026-10-24T00:10:00Z'));
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await dispatcher.idle();
    expect(sendSubscribe).not.toHaveBeenCalled();
    expect(dispatcher.stats.skipped).toBe(1);
  });
  it('对账把上海列出的提醒排进计划，过期未发的立即处理', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-24T00:00:00Z'));
    const shanghaiCall = vi.fn(async action => action === 'listUpcoming'
      ? { items:[{ key:'a', remindAt:'2026-10-24T01:00:00Z' }, { key:'old', remindAt:'2026-10-22T00:00:00Z', stale:true }] }
      : { status:'skip' });
    const dispatcher = createDispatcher({ shanghaiCall, sendSubscribe:vi.fn(), log:() => {} });
    expect(await dispatcher.reconcile()).toBe(2);
    expect(shanghaiCall).toHaveBeenCalledWith('listUpcoming', { withinMs:WINDOW_MS });
    expect(dispatcher.plan.get('old').at).toBe(Date.now());
  });
});
