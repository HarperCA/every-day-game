import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const feedback = require('../apps/miniprogram/cloudfunctions/userData/generalFeedback.js');
function database(initial = []) {
  const data = new Map(initial.map(item => [item.id, item]));
  const db = { collection() {
    const query = (filter = {}, offset = 0, size = 50) => ({
      where(next) { return query(next); }, orderBy() { return this; },
      skip(next) { return query(filter, next, size); }, limit(next) { return query(filter, offset, next); },
      async get() { return { data:[...data.values()].filter(item => Object.entries(filter).every(([key,value]) => item[key] === value)).sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(offset, offset + size) }; },
      async count() { return { total:[...data.values()].filter(item => Object.entries(filter).every(([key,value]) => item[key] === value)).length }; },
      doc(id) { return { async get() { return { data:data.get(id) }; }, async set({data:record}) { data.set(id,record); }, async update({data:change}) { data.set(id,{ ...data.get(id), ...change }); } }; }
    });
    return query();
  }, async runTransaction(fn) { return fn(db); } };
  return db;
}
const record = (id,user,created) => ({ id,user_id:user,type:'bug',content:'错',contact:'',status:'pending',internal_note:'内部原因',public_reply:'公开答复',created_at:created,updated_at:created });
describe('general feedback permissions and workflow', () => {
  it('accepts one character, rejects blank/oversized content and unknown types', () => {
    expect(feedback.validateSubmission({content:' 错 '}).content).toBe('错');
    expect(() => feedback.validateSubmission({content:' '})).toThrow('invalid_content');
    expect(() => feedback.validateSubmission({content:'a'.repeat(2001)})).toThrow('invalid_content');
    expect(() => feedback.validateSubmission({content:'错',type:'admin'})).toThrow('invalid_feedback_type');
  });
  it('forces submissions pending and does not accept user supplied replies/identity', async () => {
    const db = database();
    const result = await feedback.submit(db,'real-user',{content:'错',status:'resolved',publicReply:'假答复',user_id:'victim'});
    expect(result.feedback.status).toBe('pending');
    expect(result.feedback.publicReply).toBe('');
    expect((await feedback.list(db,{},'victim')).total).toBe(0);
  });
  it('lists only own feedback, newest first, paginated, with no internal notes', async () => {
    const db = database([record('old','me','2026-01-01'),record('new','me','2026-02-01'),record('private','other','2026-03-01')]);
    const result = await feedback.list(db,{pageSize:1,user_id:'other'},'me');
    expect(result).toMatchObject({total:2,hasMore:true,items:[{id:'new',publicReply:'公开答复'}]});
    expect(result.items[0]).not.toHaveProperty('internalNote');
    expect(result.items[0]).not.toHaveProperty('userId');
  });
  it('requires public resolution reply and rejects stale administrator updates', async () => {
    const db = database([record('f','me','2026-01-01')]);
    await expect(feedback.update(db,{id:'f',status:'resolved',expectedUpdatedAt:'2026-01-01'})).rejects.toThrow('resolved_feedback_requires_reply');
    await expect(feedback.update(db,{id:'f',status:'processing',expectedUpdatedAt:'stale'})).rejects.toThrow('feedback_conflict');
    const updated = await feedback.update(db,{id:'f',status:'resolved',publicReply:'已修复',internalNote:'内部分析',expectedUpdatedAt:'2026-01-01'});
    expect(updated.feedback.resolvedAt).toBeTruthy();
    expect((await feedback.list(db,{},'me')).items[0]).toMatchObject({status:'resolved',publicReply:'已修复'});
  });
  it('advances the administrator lock even for updates in the same millisecond', async () => {
    const adminFeedback = require('../apps/miniprogram/cloudfunctions/adminData/generalFeedback.js');
    const now = '2026-10-13T00:00:00.000Z';
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(now));
    try {
      const db = database([record('f', 'me', now)]);
      const updated = await adminFeedback.update(db, {id:'f',status:'processing',expectedUpdatedAt:now});
      expect(updated.feedback.updatedAt).toBe('2026-10-13T00:00:00.001Z');
      await expect(adminFeedback.update(db, {id:'f',status:'processing',expectedUpdatedAt:now})).rejects.toThrow('feedback_conflict');
    } finally { clock.mockRestore(); }
  });
  it('admin actions remain behind mandatory authentication and both cloud packages match', () => {
    const source = readFileSync(new URL('../apps/miniprogram/cloudfunctions/adminData/index.js',import.meta.url),'utf8');
    expect(source).toContain('requireAdmin(event || {});');
    expect(source.indexOf('requireAdmin(event || {});')).toBeLessThan(source.indexOf('data: await handle(event || {})'));
    expect(readFileSync(new URL('../apps/miniprogram/cloudfunctions/adminData/generalFeedback.js',import.meta.url),'utf8')).toBe(readFileSync(new URL('../apps/miniprogram/cloudfunctions/userData/generalFeedback.js',import.meta.url),'utf8'));
  });
});
