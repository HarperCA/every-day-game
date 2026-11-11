// AI 审查批量跑：每 5 小时 20 个比赛（2026-11-05 用户定）；后台多选的排进队列，最优先（2026-11-06 用户定）；待人工审核的比赛排在其余前面。
import { describe, expect, test } from 'vitest';
import { openDb, 维护队列 } from '../../../index.mjs';
import { 批量维护, AI审查检查项 } from '../../批量.mjs';
import { 挑下一个比赛, 维护一个比赛 } from '../../轮流.mjs';
import { 读暂停, 退避中的比赛, 退避到 } from '../../额度和退避.mjs';
import { tempRoot } from '../../../../../共用/test/复用/临时目录.mjs';
import path from 'node:path';
import fs from 'node:fs';

const now = new Date('2026-11-06T02:00:00.000Z');
const 天前 = n => new Date(now.getTime() - n * 86400000).toISOString();
const quiet = { info() {}, warn() {}, error() {}, child() { return quiet; } };

function 库() {
  const db = openDb({ file: ':memory:', now: () => now });
  db.transaction(tx => {
    tx.insert('competition', 'event-a', { name: 'A 赛', level: '国家级' });
    tx.insert('competition', 'event-b', { name: 'B 赛', level: '国家级', last_maintained_at: 天前(30) });
    tx.insert('competition', 'event-c', { name: 'C 赛', level: '国家级', last_maintained_at: 天前(20) });
    tx.insert('competition', 'event-d', { name: 'D 赛', level: '国家级', last_maintained_at: 天前(2) });
    tx.insert('edition', 'ed-a', { competition_id: 'event-a', ordinal: 1, edition_name: 'A 2026', status: '已发布' });
    tx.insert('edition', 'ed-b', { competition_id: 'event-b', ordinal: 1, edition_name: 'B 2026', status: '已归档' });
    tx.insert('edition', 'ed-c', { competition_id: 'event-c', ordinal: 1, edition_name: 'C 2026', status: '待人工审核', status_reason: ['等人看'] });
    tx.insert('edition', 'ed-d', { competition_id: 'event-d', ordinal: 1, edition_name: 'D 2026', status: '待人工审核', status_reason: ['等人看'] });
  });
  return db;
}

// 记下维护了谁；可以指定某个比赛失败
const 假维护 = (失败们 = {}) => {
  const 调用们 = [];
  const 维护 = async ({ 比赛编号, only, 失败不记 }) => {
    调用们.push({ 比赛编号, only, 失败不记 });
    return { 比赛: 比赛编号, 检查: { 完成: [], 失败: 失败们[比赛编号] ? [{ name: '核对原文', error: '出错', kind: 失败们[比赛编号] }] : [] }, 处理: { 改正: 0, 人工: 0, 留着: 0 }, 问题: 0, 留着: [] };
  };
  return { 调用们, 维护 };
};

describe('挑下一个比赛：待人工审核的优先', () => {
  test('有待人工审核届次的比赛排最前，7 天内维护过的仍然跳过', () => {
    const db = 库();
    expect(挑下一个比赛(db, { now })).toBe('event-c');
    db.close();
  });
  test('没有待人工审核的了：从没维护过的，再按上次维护时间', () => {
    const db = 库();
    db.update('edition', 'ed-c', { status: '已归档' }, 1);
    expect(挑下一个比赛(db, { now })).toBe('event-a');
    expect(挑下一个比赛(db, { now, 跳过: ['event-a'] })).toBe('event-b');
    db.close();
  });
});

describe('批量维护', () => {
  test('按顺序跑到上限；只跑核对原文；失败不记维护时间', async () => {
    const db = 库(); const { 调用们, 维护 } = 假维护();
    // 假维护不记时间，靠“这一批试过的跳过”往下走
    const 回 = await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 上限: 2, 维护 });
    expect(调用们.map(c => c.比赛编号)).toEqual(['event-c', 'event-a']);
    expect(调用们[0]).toMatchObject({ only: [AI审查检查项], 失败不记: true });
    expect(回.跑了).toBe(2);
    db.close();
  });
  test('队列里的（后台多选）最先跑、不占上限、不看 7 天，跑完从队列去掉', async () => {
    const db = 库(); const { 调用们, 维护 } = 假维护();
    维护队列.加入(db, ['event-d'], { 操作人: '管理员', at: now.toISOString() });
    await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 上限: 1, 维护 });
    expect(调用们.map(c => c.比赛编号)).toEqual(['event-d', 'event-c']);
    expect(维护队列.读(db)).toMatchObject({ 排队: [], 正在: null });
    db.close();
  });
  test('只队列：队列空了就停，不自己挑', async () => {
    const db = 库(); const { 调用们, 维护 } = 假维护();
    维护队列.加入(db, ['event-d'], { 操作人: '管理员', at: now.toISOString() });
    await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 只队列: true, 维护 });
    expect(调用们.map(c => c.比赛编号)).toEqual(['event-d']);
    db.close();
  });
  test('额度用完马上停，手动排的留在队列下次接着跑', async () => {
    const db = 库(); const { 调用们, 维护 } = 假维护({ 'event-a': '额度用完' });
    维护队列.加入(db, ['event-a', 'event-b'], { 操作人: '管理员', at: now.toISOString() });
    const 回 = await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 上限: 20, 维护 });
    expect(调用们.map(c => c.比赛编号)).toEqual(['event-a']);
    expect(回.停因).toContain('额度');
    expect(维护队列.读(db).排队).toEqual(['event-a', 'event-b']);
    db.close();
  });
  test('连续 3 个失败就停，留一条后台记录', async () => {
    const db = 库(); const { 调用们, 维护 } = 假维护({ 'event-a': '超时', 'event-b': '超时', 'event-c': '超时' });
    const 回 = await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 上限: 20, 维护 });
    expect(调用们).toHaveLength(3);
    expect(回.停因).toContain('连续');
    expect(db.find('audit_log', { action: '维护失败' })).toHaveLength(3);
    db.close();
  });
  test('网页读不到不算连续失败，这一批不停，但进退避', async () => {
    const db = 库(); const { 调用们, 维护 } = 假维护({ 'event-a': '网页读不到', 'event-b': '网页读不到', 'event-c': '网页读不到' });
    const 回 = await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 上限: 20, 维护 });
    expect(调用们).toHaveLength(3);
    expect(回.停因).toBe('');
    expect(退避中的比赛(db, now).sort()).toEqual(['event-a', 'event-b', 'event-c']);
    db.close();
  });
  test('每晚流程开始了：下一个之前停下', async () => {
    const db = 库(); const { 调用们, 维护 } = 假维护(); let 次 = 0;
    const 回 = await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 上限: 20, 维护, 该停: () => ++次 > 1 });
    expect(调用们).toHaveLength(1);
    expect(回.停因).toContain('每晚流程');
    db.close();
  });
  test('每个比赛开始前续锁，长批次不会被当成异常留下的锁', async () => {
    const db = 库(); const { 维护 } = 假维护(); let 续 = 0;
    await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 上限: 2, 维护, 续锁: () => { 续 += 1; } });
    expect(续).toBe(2);
    db.close();
  });
  describe('额度暂停（2026-11-07 用户定：额度用完停 2 小时，到点还是用完再停 2 小时）', () => {
    const 小时后 = n => new Date(now.getTime() + n * 3600000);
    test('额度用完：记下暂停到什么时候', async () => {
      const db = 库(); const { 维护 } = 假维护({ 'event-c': '额度用完' });
      await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 上限: 20, 维护 });
      expect(读暂停(db)).toMatchObject({ pausedUntil: 小时后(2).toISOString(), since: now.toISOString() });
      db.close();
    });
    test('暂停期内：一个比赛都不跑，手动队列也等着；到点恢复，成功后清掉暂停', async () => {
      const db = 库(); const 第一次 = 假维护({ 'event-c': '额度用完' });
      await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 上限: 20, 维护: 第一次.维护 });
      维护队列.加入(db, ['event-d'], { 操作人: '管理员', at: now.toISOString() });
      const 暂停中 = 假维护();
      const 回 = await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => 小时后(1), 上限: 20, 维护: 暂停中.维护 });
      expect(暂停中.调用们).toEqual([]);
      expect(回.停因).toContain('暂停');
      expect(维护队列.读(db).排队).toEqual(['event-d']);
      const 到点 = 假维护();
      await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => 小时后(3), 上限: 1, 维护: 到点.维护 });
      expect(到点.调用们.length).toBeGreaterThan(0);
      expect(读暂停(db).pausedUntil ?? null).toBeNull();
      db.close();
    });
    test('到点后还是用完：再停 5 小时，开始时间不变', async () => {
      const db = 库();
      await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 上限: 20, 维护: 假维护({ 'event-c': '额度用完' }).维护 });
      await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => 小时后(3), 上限: 20, 维护: 假维护({ 'event-c': '额度用完' }).维护 });
      expect(读暂停(db)).toMatchObject({ pausedUntil: 小时后(5).toISOString(), since: now.toISOString() });
      db.close();
    });
    test('额度用完不算这个比赛失败，不进退避', async () => {
      const db = 库();
      await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 上限: 20, 维护: 假维护({ 'event-c': '额度用完' }).维护 });
      expect(退避中的比赛(db, 小时后(6))).toEqual([]);
      db.close();
    });
    test('试跑：不看暂停，也不写暂停', async () => {
      const db = 库();
      await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 上限: 20, dryRun: true, 维护: 假维护({ 'event-c': '额度用完' }).维护 });
      expect(读暂停(db)).toBeNull();
      db.close();
    });
  });
  describe('失败退避（2026-11-07 用户定，照旧系统：每失败一次多等 6 小时，最多 7 天，成功清零）', () => {
    const 小时后 = n => new Date(now.getTime() + n * 3600000);
    const 跑 = (db, 维护, at = now, 上限 = 1) => 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => at, 上限, 维护 });
    test('失败一次：6 小时内不再挑它，过了再挑', async () => {
      const db = 库();
      await 跑(db, 假维护({ 'event-c': '超时' }).维护);
      expect(退避中的比赛(db, 小时后(5))).toEqual(['event-c']);
      expect(退避中的比赛(db, 小时后(7))).toEqual([]);
      const 期内 = 假维护(); await 跑(db, 期内.维护, 小时后(5));
      expect(期内.调用们[0].比赛编号).not.toBe('event-c');
      const 期后 = 假维护(); await 跑(db, 期后.维护, 小时后(7));
      expect(期后.调用们[0].比赛编号).toBe('event-c');
      db.close();
    });
    test('连续失败等得更久，最多 7 天', () => {
      expect(退避到({ count: 2, lastAt: now.toISOString() })).toBe(小时后(12).getTime());
      expect(退避到({ count: 100, lastAt: now.toISOString() })).toBe(小时后(168).getTime());
    });
    test('成功后清零', async () => {
      const db = 库();
      await 跑(db, 假维护({ 'event-c': '超时' }).维护);
      await 跑(db, 假维护().维护, 小时后(7));
      expect(退避中的比赛(db, 小时后(7))).toEqual([]);
      expect(db.get('admin_state', 'ai_maintenance_failures').data.data['event-c']).toBeUndefined();
      db.close();
    });
    test('后台手动排的不看退避', async () => {
      const db = 库();
      await 跑(db, 假维护({ 'event-c': '超时' }).维护);
      维护队列.加入(db, ['event-c'], { 操作人: '管理员', at: now.toISOString() });
      const 手动 = 假维护(); await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => 小时后(1), 只队列: true, 维护: 手动.维护 });
      expect(手动.调用们.map(c => c.比赛编号)).toEqual(['event-c']);
      db.close();
    });
    test('试跑不记失败', async () => {
      const db = 库();
      await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 上限: 1, dryRun: true, 维护: 假维护({ 'event-c': '超时' }).维护 });
      expect(退避中的比赛(db, now)).toEqual([]);
      db.close();
    });
  });
  test('试跑：不碰队列', async () => {
    const db = 库(); const { 调用们, 维护 } = 假维护();
    维护队列.加入(db, ['event-d'], { 操作人: '管理员', at: now.toISOString() });
    await 批量维护({ db, ai: {}, web: {}, log: quiet, now: () => now, 上限: 1, 维护, dryRun: true });
    expect(调用们.map(c => c.比赛编号)).toEqual(['event-c']);
    expect(维护队列.读(db).排队).toEqual(['event-d']);
    db.close();
  });
});

describe('维护一个比赛：失败不记', () => {
  const 坏检查 = [{ name: '核对原文', timeoutMs: 1000, run: async () => { throw Object.assign(new Error('Codex 超时'), { kind: '超时' }); } }];
  test('失败不记：检查出错不写维护时间', async () => {
    const db = 库();
    const 回 = await 维护一个比赛({ db, log: quiet, now: () => now, checks: 坏检查, 比赛编号: 'event-a', 失败不记: true, ai: {}, web: {} });
    expect(回.检查.失败[0].kind).toBe('超时');
    expect(db.get('competition', 'event-a').data.last_maintained_at ?? null).toBeNull();
    db.close();
  });
  test('成功时把留着的说明写进后台记录，后台能查到 AI 看过什么', async () => {
    const db = 库();
    const 检查 = [{ name: '核对原文', timeoutMs: 1000, run: async () => ({ problems: [{ table: 'edition', key: 'ed-a', 字段: '资料', 类型: '错误', 处置: '只记下', 说明: '官网打不开', 把握: '不确定' }] }) }];
    await 维护一个比赛({ db, log: quiet, now: () => now, checks: 检查, 比赛编号: 'event-a', 失败不记: true, ai: {}, web: {} });
    expect(db.get('competition', 'event-a').data.last_maintained_at).toBe(now.toISOString());
    const [记录] = db.find('audit_log', { action: '维护比赛' });
    expect(记录.detail.留着说明[0].说明).toBe('官网打不开');
    db.close();
  });
});

describe('维护队列', () => {
  test('加入：去重、只收存在的比赛、留后台记录；每次最多 50 个', () => {
    const db = 库();
    expect(维护队列.加入(db, ['event-a', 'event-a', 'event-b'], { 操作人: '管理员甲', at: now.toISOString() })).toEqual({ 加入: 2 });
    expect(维护队列.读(db).排队).toEqual(['event-a', 'event-b']);
    expect(维护队列.加入(db, ['event-a'], { 操作人: '管理员甲', at: now.toISOString() })).toEqual({ 加入: 0 });
    expect(() => 维护队列.加入(db, ['event-none'], { 操作人: '管理员甲', at: now.toISOString() })).toThrow(/没有这个比赛/);
    expect(() => 维护队列.加入(db, Array.from({ length: 51 }, (_, i) => `e${i}`), { 操作人: '管理员甲', at: now.toISOString() })).toThrow(/50/);
    expect(db.find('audit_log', { action: '启动AI维护' })).toHaveLength(2);
    db.close();
  });
  test('开始、完成：正在跑的不重复领；开始了的比赛再加入会排到后面', () => {
    const db = 库();
    维护队列.加入(db, ['event-a', 'event-b'], { 操作人: '管理员甲', at: now.toISOString() });
    expect(维护队列.领下一个(db, { at: now.toISOString() })).toBe('event-a');
    expect(维护队列.读(db)).toMatchObject({ 排队: ['event-a', 'event-b'], 正在: 'event-a' });
    维护队列.完成(db, 'event-a', { at: now.toISOString() });
    expect(维护队列.读(db)).toMatchObject({ 排队: ['event-b'], 正在: null });
    db.close();
  });
  test('比赛删了：领的时候跳过并去掉', () => {
    const db = 库();
    维护队列.加入(db, ['event-a', 'event-b'], { 操作人: '管理员甲', at: now.toISOString() });
    db.update('competition', 'event-a', { deleted_at: now.toISOString() }, 1);
    expect(维护队列.领下一个(db, { at: now.toISOString() })).toBe('event-b');
    expect(维护队列.读(db).排队).toEqual(['event-b']);
    db.close();
  });
});
