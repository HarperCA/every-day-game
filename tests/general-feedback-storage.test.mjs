import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../apps/server/src/db.mjs';
import { createCloudShim } from '../apps/server/src/cloudbase-shim.mjs';

const require = createRequire(import.meta.url);
const feedback = require('../apps/miniprogram/cloudfunctions/userData/generalFeedback.js');

describe('general feedback with actual server storage', () => {
  it('serializes overlapping transactions and recovers after failure', async () => {
    const sqlite = openDatabase(':memory:');
    try {
      const db = createCloudShim(sqlite).database();
      const order = [];
      await Promise.all([
        db.runTransaction(async () => { order.push('a-start'); await new Promise(resolve => setTimeout(resolve, 10)); order.push('a-end'); }),
        db.runTransaction(async () => { order.push('b'); }),
      ]);
      expect(order).toEqual(['a-start','a-end','b']);
      await expect(db.runTransaction(async () => { throw new Error('fault'); })).rejects.toThrow('fault');
      await expect(db.runTransaction(async () => 'recovered')).resolves.toBe('recovered');
    } finally { sqlite.close(); }
  });
  it('persists submission, administrator resolution and private notes separately', async () => {
    const sqlite = openDatabase(':memory:');
    try {
      const db = createCloudShim(sqlite).database();
      expect(await feedback.list(db, {}, 'me')).toMatchObject({ total: 0, items: [] });
      const submitted = await feedback.submit(db, 'me', { type: 'bug', content: '地区筛选错误', contact: 'wechat-test' });
      await feedback.submit(db, 'other', { content: '别人的反馈' });
      const adminList = await feedback.list(db, { type: 'bug', status: 'pending' });
      expect(adminList.total).toBe(1);
      await feedback.update(db, { id: submitted.feedback.id, status: 'resolved', publicReply: '已修复地区筛选', internalNote: '内部排查细节', expectedUpdatedAt: submitted.feedback.updatedAt });
      const mine = await feedback.list(db, {}, 'me');
      expect(mine.total).toBe(1);
      expect(mine.items[0]).toMatchObject({ status: 'resolved', publicReply: '已修复地区筛选' });
      expect(mine.items[0]).not.toHaveProperty('internalNote');
      expect((await feedback.list(db, { status: 'resolved' })).items[0].internalNote).toBe('内部排查细节');
    } finally { sqlite.close(); }
  });
});
