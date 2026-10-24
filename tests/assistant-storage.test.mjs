import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../apps/server/src/db.mjs';
import { createCloudShim } from '../apps/server/src/cloudbase-shim.mjs';
import { RECORDS } from './assistant-fixtures.mjs';
const require = createRequire(import.meta.url);
const { saveTurnLog, loadRecentTurns, purgeExpiredLogs, COLLECTION, RETENTION_DAYS } = require('../apps/miniprogram/cloudfunctions/assistant/conversationLog.js');
const { loadPublicRecords } = require('../apps/miniprogram/cloudfunctions/assistant/publicRecords.js');

// 用自有服务器同一套 SQLite 外壳跑，和线上的读写方式一致
let dir;
let sqlite;
let db;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-'));
  sqlite = openDatabase(path.join(dir, 'test.db'));
  db = createCloudShim(sqlite).database();
});
afterEach(() => {
  sqlite.close();
  fs.rmSync(dir, { recursive:true, force:true });
});

const turn = (id, createdAt, overrides = {}) => ({ id, sessionId:'session-1', openid:'o1', createdAt, status:'answered', message:`问${id}`, reply:`答${id}`, ...overrides });

describe('赛事助手：对话记录', () => {
  it('写进 assistant_logs，一轮一条', async () => {
    await saveTurnLog(db, turn('turn-1', '2026-10-16T01:00:00Z'));
    const saved = await db.collection(COLLECTION).doc('turn-1').get();
    expect(saved.data).toMatchObject({ id:'turn-1', reply:'答turn-1' });
  });

  it('取上下文：只取这个用户这个会话、成功的轮次，按早到晚，最多 6 轮', async () => {
    for (let index = 1; index <= 8; index += 1) await saveTurnLog(db, turn(`turn-${index}`, `2026-10-16T01:0${index}:00Z`));
    await saveTurnLog(db, turn('turn-other-user', '2026-10-16T02:00:00Z', { openid:'o2' }));
    await saveTurnLog(db, turn('turn-other-session', '2026-10-16T02:00:00Z', { sessionId:'session-2' }));
    await saveTurnLog(db, turn('turn-failed', '2026-10-16T02:00:00Z', { status:'assistant_ai_failed', reply:'' }));
    await saveTurnLog(db, turn('turn-blocked', '2026-10-16T02:01:00Z', { status:'blocked' }));
    const history = await loadRecentTurns(db, 'o1', 'session-1');
    expect(history.map(item => item.id)).toEqual(['turn-3', 'turn-4', 'turn-5', 'turn-6', 'turn-7', 'turn-8']);
    expect(history[0]).toEqual({ id:'turn-3', message:'问turn-3', reply:'答turn-3' });
  });

  it('还没有任何记录：返回空', async () => {
    expect(await loadRecentTurns(db, 'o1', 'session-1')).toEqual([]);
  });
});

describe('赛事助手：读公开比赛', () => {
  it('只读审核通过的已发布、已归档比赛', async () => {
    for (const record of [...RECORDS, { ...RECORDS[0], id:'edition-archived', data_status:'archived' }, { ...RECORDS[0], id:'edition-offline', data_status:'offline' }]) {
      await db.collection('event_edition_public_cache').doc(record.id).set({ data:record });
    }
    const ids = (await loadPublicRecords(db)).map(item => item.id).sort();
    expect(ids).toEqual(['edition-a', 'edition-archived', 'edition-b', 'edition-c', 'edition-d']);
  });
});

// 问答记录保存半年，到期自动删除（2026-10-24）
describe('赛事助手：对话记录保存 180 天', () => {
  const ids = async () => (await db.collection(COLLECTION).get()).data.map(row => row.id).sort();
  it('删掉保存满 180 天的，留下没满的', async () => {
    const now = new Date('2027-05-01T00:00:00Z');
    const daysAgo = days => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    for (const [id, days] of [['old-200', 200], ['old-181', 181], ['edge-180', RETENTION_DAYS], ['new-179', 179], ['new-1', 1]]) {
      await db.collection(COLLECTION).doc(id).set({ data:turn(id, daysAgo(days)) });
    }
    expect(await purgeExpiredLogs(db, now)).toBe(3);
    expect(await ids()).toEqual(['new-1', 'new-179']);
  });
  it('集合还没建时什么都不做', async () => {
    expect(await purgeExpiredLogs(db, new Date())).toBe(0);
  });
  it('写记录时顺带清理，12 小时内只清一次', async () => {
    const now = new Date('2028-01-01T00:00:00Z');
    await db.collection(COLLECTION).doc('ancient').set({ data:turn('ancient', '2027-01-01T00:00:00Z') });
    await saveTurnLog(db, turn('fresh', now.toISOString()), now);
    expect(await ids()).toEqual(['fresh']);
    await db.collection(COLLECTION).doc('ancient-2').set({ data:turn('ancient-2', '2027-01-01T00:00:00Z') });
    await saveTurnLog(db, turn('fresh-2', now.toISOString()), new Date(now.getTime() + 60 * 60 * 1000));
    expect(await ids()).toContain('ancient-2');
    await saveTurnLog(db, turn('fresh-3', now.toISOString()), new Date(now.getTime() + 13 * 60 * 60 * 1000));
    expect(await ids()).not.toContain('ancient-2');
  });
});
