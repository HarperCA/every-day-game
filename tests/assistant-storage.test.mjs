import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../apps/server/src/db.mjs';
import { createCloudShim } from '../apps/server/src/cloudbase-shim.mjs';
import { RECORDS } from './assistant-fixtures.mjs';
const require = createRequire(import.meta.url);
const { saveTurnLog, loadRecentTurns, COLLECTION } = require('../apps/miniprogram/cloudfunctions/assistant/conversationLog.js');
const { loadPublicRecords } = require('../apps/miniprogram/cloudfunctions/assistant/publicRecords.js');
const { isTester, readTesters, CACHE_MS } = require('../apps/miniprogram/cloudfunctions/assistant/testers.js');

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

describe('赛事助手：测试名单', () => {
  it('一行一个 openid，忽略空行和 # 注释', () => {
    const file = path.join(dir, 'testers.txt');
    fs.writeFileSync(file, '# 测试成员\no-a\n\n  o-b  \n#o-c\n');
    expect([...readTesters(file)]).toEqual(['o-a', 'o-b']);
    expect(isTester('o-a', { file, now:1 })).toBe(true);
    expect(isTester('o-c', { file, now:1 })).toBe(false);
    expect(isTester('', { file, now:1 })).toBe(false);
  });

  it('文件不存在：谁都不放行', () => {
    expect(isTester('o-a', { file:path.join(dir, 'missing.txt'), now:1 })).toBe(false);
  });

  it('改了名单，缓存过期后生效', () => {
    const file = path.join(dir, 'testers.txt');
    fs.writeFileSync(file, 'o-a\n');
    expect(isTester('o-new', { file, now:10 })).toBe(false);
    fs.writeFileSync(file, 'o-a\no-new\n');
    expect(isTester('o-new', { file, now:10 + CACHE_MS - 1 })).toBe(false);
    expect(isTester('o-new', { file, now:10 + CACHE_MS + 1 })).toBe(true);
  });
});
