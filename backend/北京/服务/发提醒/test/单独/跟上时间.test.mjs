// 报名时间变了调整已设的提醒（2026-11-02，用户定放在北京做）。规则照旧小程序：提醒页 pages/reminders/reminders.ts 读到比赛时间和提醒记的不一样，
// 就调 services/reminders.ts 的 syncReminderTarget——只动待发送的；预设提前量的跟着挪，自定义的是用户选的绝对时间，不挪；标 time_updated。
// 旧的要用户打开提醒页才会对一次；北京改成服务器自己对：每次对账（列快到期的）先全部对一遍，到点领取前再对这一条。
import { describe, expect, it } from 'vitest';
import { openMainDb, 同步 } from '../../../../主数据库/index.mjs';
import { openUserDb, 用户 } from '../../../../副数据库/index.mjs';
import { handle } from '../../index.mjs';
import { 跟上时间 } from '../../跟上时间.mjs';

const NOW = new Date('2026-11-02T02:00:00Z');
const 天 = 86400000;

function 准备({ 报名开始 = '2026-11-10', 报名截止 = '2026-11-20' } = {}) {
  const 主库 = openMainDb({ file: ':memory:', now: () => NOW });
  同步.收下(主库, {
    比赛们: [{ id: 'event-math', version: 1, name: '数学建模', level: '国家级', data: {} }],
    届次们: [{ id: 'e1', competition_id: 'event-math', version: 1, registration_start: 报名开始, registration_end: 报名截止, status: '已发布', data: { edition_name: '2026 年' } }],
  });
  const 用户库 = openUserDb({ file: ':memory:', now: () => NOW });
  const 账号 = 用户.新建或登录(用户库, { openid: 'openid-1' }, { now: NOW });
  // 小程序设提醒时，只有日期的截止时间按北京时间当天 23:59:59 算，开始时间按 00:00:00 算（services/publicRecord.ts reminderTarget）
  const 加 = (id, over = {}) => {
    const target_at = over.target_at ?? '2026-11-20T15:59:59.000Z';
    const offset_ms = over.offset_ms ?? 天;
    用户库.insert('reminder', id, { user_id: 账号.id, edition_id: 'e1', competition_name: '数学建模', task_name: '数学建模·报名截止', event_type: 'registration_end', event_label: '报名截止',
      target_at, advance_key: '1d', advance_label: '提前 1 天', offset_ms, remind_at: new Date(new Date(target_at).getTime() - offset_ms).toISOString(),
      authorization_status: 'accepted', delivery_status: 'pending', schedule_change_status: 'normal', retry_count: 0,
      created_at: '2026-10-13T01:00:00.000Z', updated_at: '2026-10-13T01:00:00.000Z', ...over });
  };
  const 读 = id => 用户库.get('reminder', id).data;
  const 改时间 = (版本, 开始, 截止) => 同步.收下(主库, { 届次们: [{ id: 'e1', competition_id: 'event-math', version: 版本, registration_start: 开始, registration_end: 截止, status: '已发布', data: { edition_name: '2026 年' } }] });
  return { 主库, 用户库, 加, 读, 改时间 };
}

describe('跟上时间：报名时间变了，调整待发送的提醒', () => {
  it('截止日期推后：提醒的目标时间换新的，预设提前量的提醒时间跟着挪，标 time_updated', () => {
    const t = 准备();
    t.加('r1');
    t.改时间(2, '2026-11-10', '2026-11-25');
    expect(跟上时间(t.用户库, t.主库, NOW)).toEqual({ 改了: ['r1'] });
    expect(t.读('r1')).toMatchObject({ target_at: '2026-11-25T15:59:59.000Z', remind_at: '2026-11-24T15:59:59.000Z', schedule_change_status: 'time_updated', delivery_status: 'pending' });
  });
  it('报名开始的提醒按开始时间对；带了钟点的时间照原样用', () => {
    const t = 准备();
    t.加('r1', { event_type: 'registration_start', event_label: '报名开始', target_at: '2026-11-09T16:00:00.000Z' });
    t.改时间(2, '2026-11-12T09:30:00+08:00', '2026-11-20');
    跟上时间(t.用户库, t.主库, NOW);
    expect(t.读('r1')).toMatchObject({ target_at: '2026-11-12T01:30:00.000Z', remind_at: '2026-11-11T01:30:00.000Z', schedule_change_status: 'time_updated' });
  });
  it('自定义的提醒时间是用户自己选的绝对时间，不挪，只换目标时间', () => {
    const t = 准备();
    t.加('r1', { advance_key: 'custom', advance_label: '自定义', offset_ms: 3 * 天 });
    const 原提醒时间 = t.读('r1').remind_at;
    t.改时间(2, '2026-11-10', '2026-11-25');
    跟上时间(t.用户库, t.主库, NOW);
    expect(t.读('r1')).toMatchObject({ target_at: '2026-11-25T15:59:59.000Z', remind_at: 原提醒时间, schedule_change_status: 'time_updated' });
  });
  it('不动的：时间没变（写法不同但是同一时刻）、新时间没公布（空）、这一届不在了、不是待发送的', () => {
    const t = 准备();
    t.加('r1');
    t.加('r2', { delivery_status: 'sent' });
    t.加('r3', { delivery_status: 'queued' });
    t.加('r4', { target_at: '2026-11-21T00:00:00.000Z' });   // 记的时间和现在的不一样，但它不是待发送：下一行改成 failed
    t.用户库.update('reminder', 'r4', { delivery_status: 'failed' });
    expect(跟上时间(t.用户库, t.主库, NOW)).toEqual({ 改了: [] });
    t.改时间(2, '2026-11-10', null);
    expect(跟上时间(t.用户库, t.主库, NOW)).toEqual({ 改了: [] });
    t.加('r5', { edition_id: 'e-下架了', target_at: '2026-12-01T00:00:00.000Z' });
    expect(跟上时间(t.用户库, t.主库, NOW)).toEqual({ 改了: [] });
    expect(t.读('r1')).toMatchObject({ target_at: '2026-11-20T15:59:59.000Z', schedule_change_status: 'normal' });
  });
  it('只对一条：给了提醒编号就只看这一条', () => {
    const t = 准备();
    t.加('r1');
    t.加('r2');
    t.改时间(2, '2026-11-10', '2026-11-25');
    expect(跟上时间(t.用户库, t.主库, NOW, { 提醒id: 'r2' })).toEqual({ 改了: ['r2'] });
    expect(t.读('r1').schedule_change_status).toBe('normal');
    expect(跟上时间(t.用户库, t.主库, NOW, { 提醒id: 'r-没有' })).toEqual({ 改了: [] });
  });
});

describe('接进发提醒：对账前全部对一遍，领取前再对这一条', () => {
  const call = (t, action, 参数 = {}) => handle({ action, ...参数 }, { 用户库: t.用户库, 主库: t.主库, now: () => NOW });
  it('到点领取时发现截止推后了：按新时间要求重排，不发', async () => {
    const t = 准备({ 报名截止: '2026-11-03' });
    t.加('r1', { target_at: '2026-11-03T15:59:59.000Z' });   // 提醒时间 11-02 15:59:59Z，还没到
    t.用户库.update('reminder', 'r1', { remind_at: new Date(NOW.getTime() - 1000).toISOString() });   // 让它刚好到点
    t.改时间(2, '2026-11-10', '2026-11-25');
    expect(await call(t, 'claim', { key: 'r1' })).toEqual({ status: 'reschedule', remindAt: '2026-11-24T15:59:59.000Z' });
    expect(t.读('r1').delivery_status).toBe('pending');
  });
  it('截止提前到两小时内：对账时先跟上时间，所以能列进快到期的', async () => {
    const t = 准备();
    t.加('r1');
    expect((await call(t, 'listUpcoming')).items).toEqual([]);
    t.改时间(2, '2026-11-01', '2026-11-03T03:00:00+08:00');   // 新截止 11-02 19:00Z，提前 1 天 = 11-01 19:00Z，已过 7 小时（没超过 24 小时），马上要发
    expect((await call(t, 'listUpcoming')).items.map(x => x.key)).toEqual(['r1']);
  });
  it('没给主库（旧的调用方式）照常工作，不对时间', async () => {
    const t = 准备();
    t.加('r1');
    t.改时间(2, '2026-11-10', '2026-11-25');
    await handle({ action: 'listUpcoming' }, { 用户库: t.用户库, now: () => NOW });
    expect(t.读('r1').schedule_change_status).toBe('normal');
  });
});
