import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const delivery = require('../apps/miniprogram/cloudfunctions/sendReminders/reminderDelivery.js');
const source = fs.readFileSync(new URL('../apps/miniprogram/cloudfunctions/sendReminders/index.js', import.meta.url), 'utf8');

const SECRET = 'x'.repeat(32);

// 上海 sendReminders 只管数据：claim 领取、report 回写，发微信改由美国服务器负责
function worker({ item: overrides = {}, claimSucceeds = true, openid = 'openid-1' } = {}) {
  const updates = [];
  const item = { _id:'r1', id:'r1', user_id:'u1', edition_id:'e1', task_name:'某大赛·报名截止', event_label:'报名截止',
    remind_at:new Date(Date.now() - 1000).toISOString(), updated_at:'2026-10-13T01:00:00Z', authorization_status:'accepted',
    delivery_status:'pending', schedule_change_status:'normal', retry_count:0, ...overrides };
  const db = {
    command:{ lte:value => value, in:value => value, inc:value => value },
    collection(name) {
      return {
        doc() {
          return {
            get:async () => ({ data:name === 'user_account' ? (openid ? { openid } : null) : { ...item } }),
            set:async () => {},
            update:async ({ data }) => { updates.push(data); Object.assign(item, data); return { stats:{ updated:1 } }; },
          };
        },
        where(condition) {
          const query = { orderBy:() => query, limit:() => query, get:async () => ({ data:[item] }), update:async ({ data }) => {
            updates.push({ ...data, condition });
            const ok = !(condition._id && !claimSucceeds);
            if (ok && condition._id) Object.assign(item, data);
            return { stats:{ updated:ok ? 1 : 0 } };
          } };
          return query;
        },
      };
    },
  };
  const cloud = { init:() => {}, database:() => db, getWXContext:() => ({}) };
  const sandbox = { require:name => name === 'wx-server-sdk' ? cloud : delivery, exports:{}, process:{ env:{ DISPATCH_SECRET:SECRET } }, console:{ log:() => {}, error:() => {} }, Date, Buffer };
  vm.runInNewContext(source, sandbox);
  const call = (action, params = {}) => sandbox.exports.main({ action, dispatchSecret:SECRET, ...params });
  return { main:sandbox.exports.main, call, updates, item };
}

describe('上海 sendReminders：领取与回写', () => {
  it('claim 校验通过后标成 queued，并交回带 openid 的发送内容', async () => {
    const test = worker();
    const result = await test.call('claim', { key:'r1' });
    expect(result.status).toBe('ready');
    expect(result.payload).toMatchObject({ touser:'openid-1', template_id:'Hdc1YLawcLjHfgiAjZYF6fJMkAMTwcPCHZYqLyvo2mY', miniprogram_state:'formal' });
    expect(result.payload.data.thing1.value).toBe('某大赛·报名截止');
    expect(test.item.delivery_status).toBe('queued');
    expect(test.updates.at(-1).condition).toMatchObject({ remind_at:test.item.remind_at, updated_at:'2026-10-13T01:00:00Z', authorization_status:'accepted', schedule_change_status:'normal' });
  });
  it('提醒时间被改到以后：要求重排，不领取', async () => {
    const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const test = worker({ item:{ remind_at:later } });
    expect(await test.call('claim', { key:'r1' })).toEqual({ status:'reschedule', remindAt:later });
    expect(test.item.delivery_status).toBe('pending');
  });
  it('已发送、已取消授权或领取冲突时跳过', async () => {
    expect((await worker({ item:{ delivery_status:'sent' } }).call('claim', { key:'r1' })).status).toBe('skip');
    expect((await worker({ item:{ authorization_status:'rejected' } }).call('claim', { key:'r1' })).status).toBe('skip');
    expect((await worker({ claimSucceeds:false }).call('claim', { key:'r1' })).reason).toBe('claim_conflict');
  });
  it('找不到 openid 记为失败并计重试，不交出发送内容', async () => {
    const test = worker({ openid:null });
    const result = await test.call('claim', { key:'r1' });
    expect(result).toEqual({ status:'skip', reason:'user_openid_not_found' });
    expect(test.item).toMatchObject({ delivery_status:'failed', retry_count:1, last_error:'user_openid_not_found' });
  });
  it('report 只回写本轮领取过（queued）的提醒', async () => {
    const test = worker({ item:{ delivery_status:'queued' } });
    expect(await test.call('report', { key:'r1', ok:true })).toEqual({ status:'sent' });
    expect(test.item.delivery_status).toBe('sent');
    expect((await worker({ item:{ delivery_status:'pending' } }).call('report', { key:'r1', ok:true })).status).toBe('ignored');
  });
  it('发送结果不明的标成人工处理，不自动重发；普通失败计重试', async () => {
    const uncertain = worker({ item:{ delivery_status:'queued' } });
    expect((await uncertain.call('report', { key:'r1', ok:false, uncertain:true, error:'timeout' })).status).toBe('manual_required');
    const failed = worker({ item:{ delivery_status:'queued' } });
    expect((await failed.call('report', { key:'r1', ok:false, error:'43101: user refuse' })).status).toBe('failed');
    expect(failed.item.retry_count).toBe(1);
  });
  it('旧的 dispatch 和定时触发不再发送消息', async () => {
    const test = worker();
    expect(await test.call('dispatch')).toEqual({ delegated:true });
    expect(test.item.delivery_status).toBe('pending');
  });
  it('没有调度密钥的调用一律拒绝', async () => {
    const test = worker();
    await expect(test.main({ action:'claim', key:'r1' })).rejects.toThrow('scheduled_invocation_required');
    await expect(test.main({ action:'claim', key:'r1', dispatchSecret:'wrong' })).rejects.toThrow('scheduled_invocation_required');
  });
});
