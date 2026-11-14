// 维护队列（2026-11-06 建，2026-11-12 用户定改给新维护用）：后台多选的比赛排进来，新维护的队列模式（新维护/运行.mjs --队列）逐个处理。
// 用户 11-12 定“可以选择任意数量的比赛进行手动勾选”：加入不设上限。新维护同时跑几个，所以“正在”是一组。
import { describe, expect, test } from 'vitest';
import { openDb, 维护队列 } from '../../../index.mjs';

const 起点 = new Date('2026-11-12T02:00:00.000Z');
const 第 = n => new Date(起点.getTime() + n * 1000).toISOString();   // 起点后 n 秒

function 库(个数 = 3) {
  const db = openDb({ file: ':memory:', now: () => 起点 });
  db.transaction(tx => {
    for (let i = 1; i <= 个数; i += 1) tx.insert('competition', `event-${i}`, { name: `比赛${i}`, level: '国家级' });
  });
  return db;
}

describe('加入：不设上限', () => {
  test('一次加入 150 个都排上；重复的、已经排着的不重复加；留一条后台记录（操作人）', () => {
    const db = 库(150);
    const 编号们 = Array.from({ length: 150 }, (_, i) => `event-${i + 1}`);
    expect(维护队列.加入(db, [...编号们, 'event-1'], { 操作人: '管理员甲', at: 第(0) })).toEqual({ 加入: 150 });
    expect(维护队列.读(db).排队).toEqual(编号们);
    expect(维护队列.加入(db, ['event-2', 'event-3'], { at: 第(1) })).toEqual({ 加入: 0 });
    const [记录] = db.find('audit_log', { action: '启动维护' });
    expect(记录.detail).toMatchObject({ 操作人: '管理员甲', 新排进去: 150 });
    expect(维护队列).not.toHaveProperty('一次最多');
    db.close();
  });
  test('比赛不存在就报错，一个都不加', () => {
    const db = 库();
    expect(() => 维护队列.加入(db, ['event-1', 'event-none'])).toThrow(/没有这个比赛/);
    expect(维护队列.读(db).排队).toEqual([]);
    db.close();
  });
  test('正在维护的不再排进去', () => {
    const db = 库();
    维护队列.加入(db, ['event-1']);
    维护队列.领下一个(db, { at: 第(1) });
    expect(维护队列.加入(db, ['event-1', 'event-2'])).toEqual({ 加入: 1 });
    expect(维护队列.读(db)).toMatchObject({ 排队: ['event-2'], 正在: ['event-1'] });
    db.close();
  });
});

describe('领、完成、放回、收回', () => {
  test('领下一个：排队最前的挪进“正在”（可以同时好几个）；删了的比赛顺手去掉；空了交回 null', () => {
    const db = 库();
    维护队列.加入(db, ['event-1', 'event-2', 'event-3']);
    db.标记删除('competition', 'event-1', { by: '测试', at: 第(0) });
    expect(维护队列.领下一个(db, { at: 第(1) })).toBe('event-2');
    expect(维护队列.领下一个(db, { at: 第(2) })).toBe('event-3');
    expect(维护队列.领下一个(db, { at: 第(3) })).toBeNull();
    expect(维护队列.读(db)).toMatchObject({ 排队: [], 正在: ['event-2', 'event-3'] });
    db.close();
  });
  test('完成：从“正在”去掉，记进“最近”（成功、摘要、结果、原因、时间），新的在前；同一个比赛只留最后一次', () => {
    const db = 库();
    维护队列.加入(db, ['event-1', 'event-2']);
    维护队列.领下一个(db, { at: 第(1) });
    维护队列.领下一个(db, { at: 第(2) });
    维护队列.完成(db, 'event-1', { at: 第(3), 成功: true, 摘要: '改了 2 处', 结果: '入库' });
    维护队列.完成(db, 'event-2', { at: 第(4), 成功: false, 摘要: '没找到官网', 结果: '没找到官网', 原因: 'DeepSeek 没找到' });
    const 读到 = 维护队列.读(db);
    expect(读到.排队).toEqual([]);
    expect(读到.正在).toEqual([]);
    expect(读到.最近).toEqual([
      { 比赛编号: 'event-2', 成功: false, 摘要: '没找到官网', 结果: '没找到官网', 原因: 'DeepSeek 没找到', 时间: 第(4) },
      { 比赛编号: 'event-1', 成功: true, 摘要: '改了 2 处', 结果: '入库', 原因: '', 时间: 第(3) },
    ]);
    维护队列.加入(db, ['event-1']);
    维护队列.领下一个(db, { at: 第(5) });
    维护队列.完成(db, 'event-1', { at: 第(6), 成功: true, 摘要: '没有变化' });
    expect(维护队列.读(db).最近.map(x => [x.比赛编号, x.摘要])).toEqual([['event-1', '没有变化'], ['event-2', '没找到官网']]);
    db.close();
  });
  test('最近最多留 30 个', () => {
    const db = 库(35);
    for (let i = 1; i <= 35; i += 1) {
      维护队列.加入(db, [`event-${i}`]);
      维护队列.领下一个(db, { at: 第(i) });
      维护队列.完成(db, `event-${i}`, { at: 第(i), 成功: true, 摘要: '没有变化' });
    }
    const { 最近 } = 维护队列.读(db);
    expect(最近).toHaveLength(30);
    expect(最近[0].比赛编号).toBe('event-35');
    db.close();
  });
  test('放回（额度用完）：从“正在”放回排队最前，下次接着跑', () => {
    const db = 库();
    维护队列.加入(db, ['event-1', 'event-2']);
    维护队列.领下一个(db, { at: 第(1) });
    维护队列.放回(db, 'event-1', { at: 第(2) });
    expect(维护队列.读(db)).toMatchObject({ 排队: ['event-1', 'event-2'], 正在: [] });
    db.close();
  });
  test('收回：上次异常退出留下的“正在”放回排队最前（拿到锁之后才调，所以一定是留下的）；有活 看排队和正在', () => {
    const db = 库();
    维护队列.加入(db, ['event-1', 'event-2', 'event-3']);
    维护队列.领下一个(db, { at: 第(1) });
    维护队列.领下一个(db, { at: 第(2) });
    expect(维护队列.收回(db, { at: 第(3) })).toBe(2);
    expect(维护队列.读(db)).toMatchObject({ 排队: ['event-1', 'event-2', 'event-3'], 正在: [] });
    expect(维护队列.收回(db, { at: 第(4) })).toBe(0);
    expect(维护队列.有活(db)).toBe(true);
    const 空 = 库();
    expect(维护队列.有活(空)).toBe(false);
    维护队列.加入(空, ['event-1']);
    维护队列.领下一个(空, { at: 第(1) });
    expect(维护队列.有活(空)).toBe(true);   // 只剩“正在”的也算：要收回
    db.close(); 空.close();
  });
  test('旧格式（正在 是一个编号）读出来也是一组', () => {
    const db = 库();
    db.insert('admin_state', 维护队列.DOC, { data: { 排队: ['event-1', 'event-2'], 正在: 'event-1' } });
    expect(维护队列.读(db)).toEqual({ 排队: ['event-2'], 正在: ['event-1'], 最近: [] });
    db.close();
  });
});

describe('额度暂停', () => {
  test('暂停 2 小时；到点前生效、到点后不生效；清暂停', () => {
    const db = 库();
    expect(维护队列.生效暂停(db, 起点)).toBeNull();
    维护队列.暂停(db, 'DeepSeek 余额不足', { now: 起点 });
    expect(维护队列.读暂停(db)).toMatchObject({ pausedUntil: new Date(起点.getTime() + 2 * 3600 * 1000).toISOString(), reason: 'DeepSeek 余额不足' });
    expect(维护队列.生效暂停(db, new Date(起点.getTime() + 3600 * 1000))).not.toBeNull();
    expect(维护队列.生效暂停(db, new Date(起点.getTime() + 3 * 3600 * 1000))).toBeNull();
    维护队列.清暂停(db, { now: 起点 });
    expect(维护队列.生效暂停(db, 起点)).toBeNull();
    db.close();
  });
});

describe('读进度（后台总览）', () => {
  test('正在维护哪几个（名称、开始时间）、排队几个、最近完成的（成功、摘要）、暂停到', () => {
    const db = 库(5);
    维护队列.加入(db, ['event-1', 'event-2', 'event-3', 'event-4', 'event-5']);
    维护队列.领下一个(db, { at: 第(1) });
    维护队列.完成(db, 'event-1', { at: 第(2), 成功: false, 摘要: '官网打不开', 原因: '超时' });
    维护队列.领下一个(db, { at: 第(3) });
    const 进度 = 维护队列.读进度(db, { now: 起点 });
    expect(进度.正在).toEqual([{ 比赛编号: 'event-2', 名称: '比赛2', 开始时间: 第(3) }]);
    expect(进度.排队数).toBe(3);
    expect(进度.排队).toEqual([{ 比赛编号: 'event-3', 名称: '比赛3' }, { 比赛编号: 'event-4', 名称: '比赛4' }, { 比赛编号: 'event-5', 名称: '比赛5' }]);
    expect(进度.最近).toEqual([{ 比赛编号: 'event-1', 名称: '比赛1', 成功: false, 摘要: '官网打不开', 结果: '', 原因: '超时', 时间: 第(2) }]);
    expect(进度.暂停到).toBeNull();
    维护队列.暂停(db, '额度用完', { now: 起点 });
    expect(维护队列.读进度(db, { now: 起点 }).暂停到).toBe(new Date(起点.getTime() + 2 * 3600 * 1000).toISOString());
    db.close();
  });
  test('排队名单最多列 50 个，排队数照实际', () => {
    const db = 库(80);
    维护队列.加入(db, Array.from({ length: 80 }, (_, i) => `event-${i + 1}`));
    const 进度 = 维护队列.读进度(db, { now: 起点 });
    expect(进度.排队数).toBe(80);
    expect(进度.排队).toHaveLength(50);
    db.close();
  });
});
