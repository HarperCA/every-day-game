// 后台 · 总览：顶上的“维护进度”（2026-11-12 用户定：旧 AI 审查删掉，改显示新维护队列的进度：正在维护哪个、排队几个、最近完成几个），数据从维护队列读。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../../../db/test/复用/样例数据.mjs';
import { 维护队列 } from '../../../../../db/index.mjs';
import { 处理后台请求 } from '../../../../接口.mjs';
import { 进度摘要 } from '../../维护进度.mjs';

const 现在 = new Date('2026-11-12T02:00:00.000Z');
const 总览 = (db, 参数 = {}) => 处理后台请求('总览', 参数, { db, now: () => 现在 });

describe('维护进度（数据库.mjs 的 动作 维护进度）', () => {
  test('从维护队列读：正在维护哪个、排队几个、最近完成的成功失败', async () => {
    const db = open(); seed(db);
    维护队列.加入(db, ['event-math', 'event-art']);
    维护队列.领下一个(db, { at: '2026-11-12T01:00:00.000Z' });
    维护队列.完成(db, 'event-math', { at: '2026-11-12T01:05:00.000Z', 成功: true, 摘要: '改了 2 处' });
    维护队列.领下一个(db, { at: '2026-11-12T01:06:00.000Z' });
    const 回 = await 总览(db, { 动作: '维护进度' });
    expect(回.正在).toEqual([{ 比赛编号: 'event-art', 名称: '省大学生艺术展演', 开始时间: '2026-11-12T01:06:00.000Z' }]);
    expect(回.排队数).toBe(0);
    expect(回.最近).toEqual([expect.objectContaining({ 比赛编号: 'event-math', 名称: '全国大学生数学建模竞赛', 成功: true, 摘要: '改了 2 处' })]);
    expect(回.暂停到).toBeNull();
  });
  test('旧的“审核进度”动作不再有（AI 审查删了），不带动作照旧交回环形图的数据', async () => {
    const db = open(); seed(db);
    const 回 = await 总览(db, { 动作: '审核进度' });
    expect(回).not.toHaveProperty('正在');
    expect(回).toHaveProperty('届次们');
  });
});

describe('进度摘要（折叠时显示的一行）', () => {
  test('正在维护、暂停、排队、空闲各一种说法；带最近完成的个数', () => {
    const 最近 = [{ 成功: true }, { 成功: false }, { 成功: true }];
    expect(进度摘要({ 正在: [{ 名称: '甲' }, { 名称: '乙' }], 排队数: 5, 最近, 暂停到: null })).toBe('维护中 · 甲、乙 · 还有 5 个排队 · 最近完成 3 个（成功 2，失败 1）');
    expect(进度摘要({ 正在: [], 排队数: 4, 最近: [], 暂停到: '2026-11-12T04:00:00.000Z' })).toBe('维护暂停 · 4 个等额度恢复');
    expect(进度摘要({ 正在: [], 排队数: 3, 最近: [], 暂停到: null })).toBe('排队中 · 3 个');
    expect(进度摘要({ 正在: [], 排队数: 0, 最近, 暂停到: null })).toBe('维护进度 · 最近完成 3 个（成功 2，失败 1）');
    expect(进度摘要({ 正在: [], 排队数: 0, 最近: [], 暂停到: null })).toBe('维护进度');
  });
});
