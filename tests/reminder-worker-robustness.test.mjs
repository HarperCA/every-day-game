import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const delivery = require('../apps/miniprogram/cloudfunctions/sendReminders/reminderDelivery.js');
const source = fs.readFileSync(new URL('../apps/miniprogram/cloudfunctions/sendReminders/index.js', import.meta.url), 'utf8');

function worker({ ackFailure = false, claimSucceeds = true } = {}) {
  const updates = [];
  const item = { _id:'r1', id:'r1', user_id:'u1', edition_id:'e1', remind_at:new Date().toISOString(), updated_at:'2026-10-13T01:00:00Z', delivery_status:'pending', schedule_change_status:'normal' };
  const send = vi.fn(async () => ({}));
  const db = {
    command:{ lte:value => value, in:value => value, inc:value => value },
    collection(name) {
      return {
        doc() { return { get:async () => ({ data:{ openid:'openid' } }), set:async () => {}, update:async ({ data }) => {
          updates.push(data);
          if (ackFailure && data.delivery_status === 'sent') throw new Error('database unavailable');
          return { stats:{ updated:1 } };
        } }; },
        where(condition) {
          const query = { orderBy:() => query, limit:() => query, get:async () => ({ data:[item] }), update:async ({ data }) => {
            updates.push({ ...data, condition });
            return { stats:{ updated:condition._id && !claimSucceeds ? 0 : 1 } };
          } };
          return query;
        },
      };
    },
  };
  const cloud = { init:() => {}, database:() => db, getWXContext:() => ({}), openapi:{ subscribeMessage:{ send } } };
  const sandbox = { require:name => name === 'wx-server-sdk' ? cloud : delivery, exports:{}, process:{ env:{} }, console:{ log:() => {}, error:() => {} }, Date, Buffer };
  vm.runInNewContext(source, sandbox);
  return { main:sandbox.exports.main, updates, send, item };
}
const timer = { Type:'Timer', TriggerName:'send-reminders-every-5-minutes', Time:'2026-10-13T01:00:00Z' };
describe('reminder delivery ambiguity and concurrent edits', () => {
  it('does not automatically resend a message already accepted by WeChat when sent status cannot be persisted', async () => {
    const test = worker({ ackFailure:true });
    const result = await test.main(timer);
    expect(test.send).toHaveBeenCalledTimes(1);
    expect(result.manualRequired).toBe(1);
    expect(test.updates.at(-1).delivery_status).toBe('manual_required');
    expect(test.updates.at(-1).last_error).toContain('sent_but_state_update_failed');
    expect(test.updates[0].delivery_status).toBe('manual_required');
  });
  it('checks reminder time and authorization as part of the atomic claim and skips stale records', async () => {
    const test = worker({ claimSucceeds:false });
    const result = await test.main(timer);
    expect(test.send).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(test.updates[1].condition).toMatchObject({ remind_at:test.item.remind_at, updated_at:test.item.updated_at, authorization_status:'accepted', schedule_change_status:'normal' });
  });
});
