import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openDatabase } from '../apps/server/src/db.mjs';
import { createCloudShim } from '../apps/server/src/cloudbase-shim.mjs';
import { sourceStateFile, readSourceState, writeSourceState } from '../scripts/server/sync-source-state.mjs';
import { batchBySize } from '../scripts/server/sync-public-cache.mjs';
import { resumeLogCursor } from '../scripts/server/pull-client-logs.mjs';
const require = createRequire(import.meta.url);
const { pullIssuePage } = require('../apps/miniprogram/cloudfunctions/publicSync/logPagination.js');
let directory, database, db;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-pagination-'));
  database = openDatabase(path.join(directory, 'test.db'));
  db = createCloudShim(database).database();
});
afterEach(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
describe('migration sync stable pagination and source isolation', () => {
  it('reads all records when more than a page share the same timestamp', async () => {
    for (let n = 0; n < 450; n++) await db.collection('client_issues').doc(`issue-${String(n).padStart(4, '0')}`).set({ data: { received_at: '2026-10-13T01:00:00.000Z', kind: 'slow' } });
    await db.collection('client_issues').doc('later').set({ data: { received_at: '2026-10-13T01:01:00.000Z' } });
    let cursor;
    const ids = [];
    for (let n = 0; n < 10; n++) {
      const page = await pullIssuePage(db, { cursor, limit: 200 }, () => false);
      ids.push(...page.issues.map(row => row._id)); cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    expect(ids).toHaveLength(451);
    expect(new Set(ids).size).toBe(451);
    expect(ids.at(-1)).toBe('later');
  });
  it('resumes strictly after acknowledged cursor without replaying equal timestamps', async () => {
    for (const id of ['a', 'b', 'c']) await db.collection('client_issues').doc(id).set({ data: { received_at: '2026-10-13T01:00:00.000Z' } });
    const page = await pullIssuePage(db, { cursor: { at: '2026-10-13T01:00:00.000Z', id: 'b' }, limit: 2 }, () => false);
    expect(page.issues.map(row => row._id)).toEqual(['c']);
    expect(page.hasMore).toBe(false);
  });
  it('uses independent files for Shanghai and Beijing; target change starts full sync', () => {
    const shanghai = 'https://shanghai.example/public-sync';
    const beijing = 'https://beijing.example/api/publicSync';
    const oldFile = sourceStateFile(directory, 'client-logs', shanghai);
    const newFile = sourceStateFile(directory, 'client-logs', beijing);
    writeSourceState(oldFile, shanghai, { cursor: { at: '2026-10-13T01:00:00.000Z', id: 'last' } });
    expect(newFile).not.toBe(oldFile);
    expect(readSourceState(newFile, beijing)).toEqual({});
    expect(() => readSourceState(oldFile, beijing)).toThrow('sync_state_source_mismatch');
  });
  it('caps each public batch at API record limit even for tiny documents', () => {
    const records = Array.from({ length: 201 }, (_, n) => ({ id: `tiny-${n}` }));
    const batches = batchBySize(records);
    expect(batches.map(batch => batch.length)).toEqual([100, 100, 1]);
    expect(batches.flat()).toEqual(records);
  });
  it('supports projection used by publicSync preference stats and IDs', async () => {
    await db.collection('user_preference').doc('u1').set({ data: { province: '安徽省', categories: ['设计与艺术'], secret: 'must-not-project' } });
    const result = await db.collection('user_preference').field({ province: true, categories: true }).get();
    expect(result.data).toEqual([{ _id: 'u1', province: '安徽省', categories: ['设计与艺术'] }]);
  });
  it('rejects malformed cursors rather than skipping or restarting silently', async () => {
    await expect(pullIssuePage(db, { cursor: { at: 'bad', id: 'a' } }, () => false)).rejects.toThrow('invalid_log_cursor');
  });
  it('rechecks completed boundaries but continues a large unfinished scan strictly', () => {
    const cursor = { at: '2026-10-13T01:00:00.000Z', id: 'b' };
    expect(resumeLogCursor({ cursor, hasMore: true })).toEqual(cursor);
    expect(resumeLogCursor({ cursor, hasMore: false })).toEqual({ at: '2026-10-13T00:55:00.000Z', id: '' });
  });
});
