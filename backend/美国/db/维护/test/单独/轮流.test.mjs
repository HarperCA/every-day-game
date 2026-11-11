// 轮流维护：每天 9:00–18:00 每 5 分钟维护一个比赛（定时器启动），依次进行；做完记下“上次维护时间”，7 天内维护过的跳过。
// 检查出错也照样标“维护过”，失败的检查写进操作日志，7 天后轮到再查（2026-11-01 用户定）。
// 不叠着跑：上一次还没完就跳过；每晚流程还在跑也跳过。用内存里的比赛库，不连网、不调 AI。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { tempRoot } from '../../../../../共用/test/复用/临时目录.mjs';
import { openDb } from '../../../index.mjs';
import { 挑下一个比赛, 维护一个比赛, 间隔天数 } from '../../轮流.mjs';
import { 拿锁, 流程在跑 } from '../../运行锁.mjs';

const now = new Date('2026-11-01T02:00:00.000Z');   // 北京时间 10:00
const 天前 = n => new Date(now.getTime() - n * 86400000).toISOString();
const quiet = { info() {}, warn() {}, error() {}, child() { return quiet; } };

function 库() {
  const db = openDb({ file: ':memory:', now: () => now });
  db.transaction(tx => {
    tx.insert('competition', 'event-b', { name: 'B 赛', level: '国家级', last_maintained_at: 天前(8) });
    tx.insert('competition', 'event-c', { name: 'C 赛', level: '国家级', last_maintained_at: 天前(2) });
    tx.insert('competition', 'event-a', { name: 'A 赛', level: '国家级' });
    tx.insert('competition', 'event-z', { name: 'Z 赛', level: '国家级' });
    tx.insert('competition', 'event-gone', { name: '删了', level: '国家级' });
    tx.insert('edition', 'ed-a', { competition_id: 'event-a', ordinal: 1, edition_name: 'A 2026', status: '已发布' });
  });
  db.标记删除('competition', 'event-gone', { by: '管理员' });
  return db;
}
const 检查 = (name, run) => ({ name, timeoutMs: 5000, run });

describe('挑下一个比赛', () => {
  test(`从没维护过的排最前（同样按编号），再按上次维护时间从早到晚；${间隔天数} 天内维护过的、已删除的跳过`, () => {
    const db = 库();
    expect(间隔天数).toBe(7);
    const 顺序 = [];
    for (let i = 0; i < 5; i++) {
      const id = 挑下一个比赛(db, { now });
      if (!id) break;
      顺序.push(id);
      db.update('competition', id, { last_maintained_at: now.toISOString() }, db.get('competition', id).version);
    }
    expect(顺序).toEqual(['event-a', 'event-z', 'event-b']);
  });
});

describe('维护一个比赛', () => {
  test('只维护挑中的这一个：检查项从 ctx.范围 知道是哪个比赛；做完记下上次维护时间，并留一条操作日志（含失败的检查）', async () => {
    const db = 库();
    const 看到 = [];
    const checks = [检查('状态', ctx => { 看到.push(ctx.范围); return { problems: [] }; }), 检查('链接', () => { throw new Error('还没实现'); })];
    const r = await 维护一个比赛({ db, log: quiet, now: () => now, checks, find: async () => ({}) });
    expect(r.比赛).toBe('event-a');
    expect(看到).toEqual([{ 比赛编号: 'event-a' }]);
    expect(db.get('competition', 'event-a').data.last_maintained_at).toBe(now.toISOString());
    const [日志] = db.find('audit_log', { action: '维护比赛' });
    expect(日志).toMatchObject({ table_name: 'competition', record_id: 'event-a', detail: { 检查完成: ['状态'], 检查失败: [{ name: '链接', error: '还没实现' }] } });
  });
  test('可以指定维护哪个比赛（不看 7 天）', async () => {
    const db = 库();
    const r = await 维护一个比赛({ db, log: quiet, now: () => now, checks: [], find: async () => ({}), 比赛编号: 'event-c' });
    expect(r.比赛).toBe('event-c');
    expect(db.get('competition', 'event-c').data.last_maintained_at).toBe(now.toISOString());
  });
  test('试跑：照常检查，不记维护时间、不留日志', async () => {
    const db = 库();
    await 维护一个比赛({ db, log: quiet, now: () => now, checks: [], find: async () => ({}), dryRun: true });
    expect(db.get('competition', 'event-a').data.last_maintained_at).toBeFalsy();
    expect(db.find('audit_log', { action: '维护比赛' })).toEqual([]);
  });
  test(`都在 ${间隔天数} 天内维护过：什么都不做，检查项不跑`, async () => {
    const db = openDb({ file: ':memory:', now: () => now });
    db.insert('competition', 'event-c', { name: 'C 赛', level: '国家级', last_maintained_at: 天前(1) });
    let 跑了 = false;
    const r = await 维护一个比赛({ db, log: quiet, now: () => now, checks: [检查('状态', () => { 跑了 = true; return { problems: [] }; })], find: async () => ({}) });
    expect(r).toMatchObject({ 比赛: null, 原因: expect.stringContaining('7 天内') });
    expect(跑了).toBe(false);
  });
});

describe('运行锁', () => {
  test('不叠着跑：上一次还拿着锁，这一次拿不到；放掉以后能拿；超过 1 小时没放的算上次异常退出留下的', () => {
    const file = path.join(tempRoot(), '.维护中.lock');
    const 放 = 拿锁(file, { now });
    expect(放).toBeTypeOf('function');
    expect(拿锁(file, { now })).toBeNull();
    放();
    expect(拿锁(file, { now })).toBeTypeOf('function');
    expect(拿锁(file, { now: new Date(now.getTime() + 61 * 60000) })).toBeTypeOf('function');
  });
  test('每晚流程在跑（它的锁文件在、没超过 12 小时）：维护这一轮跳过', () => {
    const dir = tempRoot();
    const file = path.join(dir, '.运行中.lock');
    expect(流程在跑(file, { now })).toBe(false);
    fs.writeFileSync(file, JSON.stringify({ pid: 1, at: new Date(now.getTime() - 3600000).toISOString() }));
    expect(流程在跑(file, { now })).toBe(true);
    fs.writeFileSync(file, JSON.stringify({ pid: 1, at: new Date(now.getTime() - 13 * 3600000).toISOString() }));
    expect(流程在跑(file, { now })).toBe(false);
  });
});
