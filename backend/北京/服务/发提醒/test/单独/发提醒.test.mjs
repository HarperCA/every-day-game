// 发提醒：上海 sendReminders 的领取、回写（状态机）+ 美国 reminder-dispatcher 的排计划、发送，在北京合到一处（2026-11-02）。
// 状态机的用例照旧测试 tests/reminder-worker-robustness.test.mjs 的场景重写：旧的跑在假的云开发数据库上，这里用真的用户库。
// 旧的“没有调度密钥一律拒绝”：北京不再对外开这个入口，改成“用户身份直接调用一律拒绝”（同上海 assertScheduledInvocation 的第一条）。
import { describe, expect, it, vi } from 'vitest';
import { openUserDb, 用户 } from '../../../../副数据库/index.mjs';
import { handle, 启动发提醒 } from '../../index.mjs';

const NOW = new Date('2026-10-24T02:00:00Z');
function 准备({ 提醒: over = {}, openid = 'openid-1' } = {}) {
  const 用户库 = openUserDb({ file: ':memory:', now: () => NOW });
  const 账号 = openid ? 用户.新建或登录(用户库, { openid }, { now: NOW }) : { id: 'u-没有' };
  用户库.insert('reminder', 'r1', { user_id: 账号.id, edition_id: 'e1', competition_name: '某大赛', task_name: '某大赛·报名截止', event_type: 'registration_end', event_label: '报名截止',
    target_at: '2026-10-25T02:00:00.000Z', advance_key: '1d', advance_label: '提前 1 天', offset_ms: 86400000, remind_at: new Date(NOW.getTime() - 1000).toISOString(),
    authorization_status: 'accepted', delivery_status: 'pending', schedule_change_status: 'normal', retry_count: 0, created_at: '2026-10-13T01:00:00.000Z', updated_at: '2026-10-13T01:00:00.000Z', ...over });
  const 读 = () => 用户库.get('reminder', 'r1').data;
  // 照 r1 复制一条新的：去掉编号，换上要改的
  const 复制 = (over = {}) => { const { id: _编号, ...行 } = 读(); return { ...行, ...over }; };
  const call = (action, 参数 = {}, ctx = {}) => handle({ action, ...参数 }, { 用户库, now: () => NOW, ...ctx });
  return { 用户库, 读, 复制, call };
}

describe('状态机：领取与回写（搬自上海 sendReminders）', () => {
  it('claim 校验通过后标成 queued，并交回带 openid 的发送内容', async () => {
    const t = 准备();
    const result = await t.call('claim', { key: 'r1' });
    expect(result.status).toBe('ready');
    expect(result.payload).toMatchObject({ touser: 'openid-1', template_id: 'Hdc1YLawcLjHfgiAjZYF6fJMkAMTwcPCHZYqLyvo2mY', miniprogram_state: 'formal', page: 'pages/detail/detail?id=e1' });
    expect(result.payload.data.thing1.value).toBe('某大赛·报名截止');
    expect(t.读().delivery_status).toBe('queued');
  });
  it('提醒时间被改到以后：要求重排，不领取', async () => {
    const later = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
    const t = 准备({ 提醒: { remind_at: later } });
    expect(await t.call('claim', { key: 'r1' })).toEqual({ status: 'reschedule', remindAt: later });
    expect(t.读().delivery_status).toBe('pending');
  });
  it('已发送、已取消授权时跳过；找不到的是 missing', async () => {
    expect((await 准备({ 提醒: { delivery_status: 'sent' } }).call('claim', { key: 'r1' })).status).toBe('skip');
    expect((await 准备({ 提醒: { authorization_status: 'rejected' } }).call('claim', { key: 'r1' })).status).toBe('skip');
    expect(await 准备().call('claim', { key: 'r-none' })).toEqual({ status: 'missing' });
  });
  it('过期超过 24 小时：标成 expired 不发；重试到 3 次：转人工', async () => {
    const t = 准备({ 提醒: { remind_at: new Date(NOW.getTime() - 25 * 3600e3).toISOString() } });
    expect(await t.call('claim', { key: 'r1' })).toEqual({ status: 'skip', reason: 'expired' });
    expect(t.读().delivery_status).toBe('expired');
    const u = 准备({ 提醒: { retry_count: 3, delivery_status: 'failed' } });
    expect(await u.call('claim', { key: 'r1' })).toEqual({ status: 'skip', reason: 'retries_exhausted' });
    expect(u.读().delivery_status).toBe('manual_required');
  });
  // 上海还有“找不到 openid 记失败、计重试”：北京的用户库要求提醒的用户一定存在、openid 必填，造不出这种数据；代码照旧保留这一步。
  it('report 只回写本轮领取过（queued）的提醒', async () => {
    const t = 准备({ 提醒: { delivery_status: 'queued', updated_at: NOW.toISOString() } });
    expect(await t.call('report', { key: 'r1', ok: true })).toEqual({ status: 'sent' });
    expect(t.读()).toMatchObject({ delivery_status: 'sent', sent_at: NOW.toISOString() });
    expect((await 准备().call('report', { key: 'r1', ok: true })).status).toBe('ignored');
  });
  it('发送结果不明的标成人工处理，不自动重发；普通失败计重试', async () => {
    const uncertain = 准备({ 提醒: { delivery_status: 'queued', updated_at: NOW.toISOString() } });
    expect((await uncertain.call('report', { key: 'r1', ok: false, uncertain: true, error: 'timeout' })).status).toBe('manual_required');
    const failed = 准备({ 提醒: { delivery_status: 'queued', updated_at: NOW.toISOString() } });
    expect((await failed.call('report', { key: 'r1', ok: false, error: '43101: user refuse' })).status).toBe('failed');
    expect(failed.读()).toMatchObject({ retry_count: 1, last_error: '43101: user refuse' });
  });
  it('listUpcoming：列出两小时内到期、仍可发送的；过期超过 24 小时的标 stale；领取超过 15 分钟没回写的转人工', async () => {
    const t = 准备();
    t.用户库.insert('reminder', 'r2', t.复制({ remind_at: new Date(NOW.getTime() - 30 * 3600e3).toISOString() }));
    t.用户库.insert('reminder', 'r3', t.复制({ remind_at: new Date(NOW.getTime() + 5 * 3600e3).toISOString() }));
    t.用户库.insert('reminder', 'r4', t.复制({ delivery_status: 'queued' }));
    const 以后 = new Date(NOW.getTime() + 16 * 60 * 1000);
    const r = await t.call('listUpcoming', {}, { now: () => 以后 });
    expect(r.items.map(x => [x.key, x.stale])).toEqual([['r2', true], ['r1', false]]);
    expect(t.用户库.get('reminder', 'r4').data).toMatchObject({ delivery_status: 'manual_required', last_error: 'send_claim_timeout_delivery_unknown' });
  });
  it('用户身份直接调用一律拒绝（这个服务会交出 openid，只给本机的发送调度用）；不认识的动作拒绝', async () => {
    await expect(准备().call('claim', { key: 'r1' }, { openid: 'o-1' })).rejects.toThrow('direct_user_invocation_forbidden');
    await expect(准备().call('listReminders')).rejects.toThrow('unsupported_action');
  });
});

describe('启动发提醒：本机排计划、到点领取、发微信、回写', () => {
  it('启动时对账，到点的发出去并标成 sent；保存提醒后排上的两小时内到期的也会发', async () => {
    vi.useFakeTimers({ now: NOW });
    try {
      const t = 准备();
      const 发了 = [];
      const 发提醒 = 启动发提醒({ 用户库: t.用户库, sendSubscribe: async payload => { 发了.push(payload.touser); return { errcode: 0 }; }, log: () => {}, 对账间隔: 0 });
      await 发提醒.对账();
      await vi.advanceTimersByTimeAsync(10);
      await 发提醒.dispatcher.idle();
      expect(发了).toEqual(['openid-1']);
      expect(t.读().delivery_status).toBe('sent');

      t.用户库.insert('reminder', 'r5', t.复制({ delivery_status: 'pending', sent_at: null, remind_at: new Date(Date.now() + 60 * 1000).toISOString() }));
      expect(发提醒.排上([t.用户库.get('reminder', 'r5').data])).toBe(1);
      await vi.advanceTimersByTimeAsync(61 * 1000);
      await 发提醒.dispatcher.idle();
      expect(发了).toEqual(['openid-1', 'openid-1']);
      expect(t.用户库.get('reminder', 'r5').data.delivery_status).toBe('sent');
      发提醒.停();
    } finally {
      vi.useRealTimers();
    }
  });
});

// 2026-11-04：搬旧用户数据进北京后、正式切换前，旧系统还在发提醒。北京要是也发，用户会收到两遍、还白白消耗订阅授权，所以有开关。
describe('发提醒的开关（REMINDER_DISPATCH=off）', () => {
  it('关着：不对账、不排计划、不发微信；保存提醒时的 排上 什么都不做', async () => {
    const t = 准备();
    const 发了 = [];
    const 发提醒 = 启动发提醒({ 用户库: t.用户库, 关着: true, sendSubscribe: async p => { 发了.push(p); return { errcode: 0 }; }, log: () => {}, 对账间隔: 60000 });
    expect(发提醒.关着).toBe(true);
    expect(发提醒.排上([t.读()])).toBe(0);
    expect(await 发提醒.对账()).toBe(0);
    await new Promise(r => setTimeout(r, 20));
    expect(发了).toEqual([]);
    expect(t.读().delivery_status).toBe('pending');
    发提醒.停();
  });
  it('默认看环境变量：REMINDER_DISPATCH=off 才关，没设照常开', () => {
    const 原来 = process.env.REMINDER_DISPATCH;
    try {
      process.env.REMINDER_DISPATCH = 'off';
      expect(启动发提醒({ 用户库: 准备().用户库, sendSubscribe: async () => ({}), log: () => {}, 对账间隔: 0 }).关着).toBe(true);
      delete process.env.REMINDER_DISPATCH;
      const 开 = 启动发提醒({ 用户库: 准备().用户库, sendSubscribe: async () => ({}), log: () => {}, 对账间隔: 0 });
      expect(开.关着).toBe(false);
      开.停();
    } finally {
      if (原来 === undefined) delete process.env.REMINDER_DISPATCH; else process.env.REMINDER_DISPATCH = 原来;
    }
  });
});
