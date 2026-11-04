// 搜索词：返回搜索词的程序（从旧的 search-plan.mjs 搬来的细分专业轮换）和它自己的记录表。不连网、不调 AI。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { fakeCtx } from '../../../../test/复用/假ctx.mjs';
import { 生成搜索词, 记录搜索词 } from '../../搜索词/index.mjs';
import { 默认额度, 不重复天数, 字节数, 专业搜索词, 排专业顺序, 挑专业, 载入专业目录 } from '../../搜索词/专业轮换.mjs';
import { 打开记录表, 读历史, 更新冷却, 默认文件 } from '../../搜索词/记录表.mjs';

const 专业们 = 载入专业目录();
const now = new Date('2026-10-11T00:30:00+08:00');
const 天 = 86400000;

const 临时 = [];
function 临时文件() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '搜索词-'));
  临时.push(dir);
  return path.join(dir, '数据', '搜索词记录.db');
}
afterEach(() => { while (临时.length) fs.rmSync(临时.pop(), { recursive: true, force: true }); });

describe('专业目录', () => {
  test('是教育部 2026 年目录的 883 个专业，其中今年新增 38 个', () => {
    expect(专业们).toHaveLength(883);
    expect(专业们.filter(m => m.new2026)).toHaveLength(38);
    expect(专业们.find(m => m.code === '0502106TK')).toMatchObject({ name: '计算语言学', new2026: true });
  });
});

describe('专业轮换', () => {
  test('门类在校生人数从少到多：交叉学科（无统计）→ 哲学 → 历史学 …… 工学最后', () => {
    const 门类们 = [...new Set(排专业顺序(专业们).map(m => m.gate))];
    expect(门类们.slice(0, 4)).toEqual(['交叉学科', '哲学', '历史学', '农学']);
    expect(门类们.at(-1)).toBe('工学');
  });
  test('同一门类里先今年新增，再特设（T），最后基本专业', () => {
    const 法学 = 排专业顺序(专业们).filter(m => m.gate === '法学');
    const 档 = m => m.new2026 ? 0 : /T/.test(m.code) ? 1 : 2;
    expect(法学.map(档)).toEqual([...法学.map(档)].sort((a, b) => a - b));
    expect(档(法学[0])).toBe(0);
    expect(档(法学.at(-1))).toBe(2);
  });
  test('每晚 30 个，每个专业一次，搜索词不超过 72 字节（汉字算 2）', () => {
    const 第一晚 = 挑专业(专业们, 默认额度, {}, now, 2026);
    expect(默认额度).toBe(30);
    expect(第一晚).toHaveLength(30);
    expect(new Set(第一晚.map(x => x.词)).size).toBe(30);
    expect(第一晚[0]).toMatchObject({ 路线: '细分专业', 词: '具身智能 大学生 竞赛 2026 报名', 专业: '具身智能' });
    expect(第一晚[0].理由).toContain('从未搜过');
    for (const x of 第一晚) expect(字节数(x.词)).toBeLessThanOrEqual(72);
  });
  test(`搜过的 ${不重复天数} 天内不再搜，过了就重新排进来`, () => {
    const 第一晚 = 挑专业(专业们, 30, {}, now, 2026);
    const 历史 = Object.fromEntries(第一晚.map(x => [x.词, { 上次搜索: '2026-10-10T17:00:00Z' }]));
    const 第二晚 = 挑专业(专业们, 30, 历史, now, 2026);
    expect(第二晚.some(x => 第一晚.some(f => f.词 === x.词))).toBe(false);
    const 很久以前 = { [专业搜索词('具身智能', 2026)]: { 上次搜索: '2026-09-01T00:00:00Z' } };
    expect(挑专业(专业们, 1, 很久以前, now, 2026)[0].专业).toBe('具身智能');
  });
  test('冷却中的词跳过', () => {
    const 历史 = { [专业搜索词('具身智能', 2026)]: { 暂停到: new Date(now.getTime() + 天).toISOString() } };
    expect(挑专业(专业们, 1, 历史, now, 2026)[0].专业).not.toBe('具身智能');
  });
  test('专业名太长时截短名字，后缀保留', () => {
    const 词 = 专业搜索词('很长很长很长很长很长很长很长很长很长很长很长很长的专业名', 2026);
    expect(字节数(词)).toBeLessThanOrEqual(72);
    expect(词.endsWith('2026 报名')).toBe(true);
  });
});

describe('更新冷却', () => {
  test('连续两次零候选开始暂停，冷却期 2、4……天逐次加倍，有产出就恢复；搜过次数累计', () => {
    let 历史 = {};
    历史 = 更新冷却(历史, [{ 词: 'q', 候选数: 0 }], now);
    expect(历史.q).toMatchObject({ 连续零候选: 1, 暂停到: null, 上次搜索: now.toISOString(), 搜过次数: 1 });
    历史 = 更新冷却(历史, [{ 词: 'q', 候选数: 0 }], now);
    expect(Date.parse(历史.q.暂停到) - now.getTime()).toBe(2 * 天);
    历史 = 更新冷却(历史, [{ 词: 'q', 候选数: 0 }], now);
    expect(Date.parse(历史.q.暂停到) - now.getTime()).toBe(4 * 天);
    历史 = 更新冷却(历史, [{ 词: 'q', 候选数: 3 }], now);
    expect(历史.q).toMatchObject({ 连续零候选: 0, 暂停到: null, 上次候选数: 3, 搜过次数: 4 });
  });
  test('最长暂停 32 天；不改传进来的历史', () => {
    const 原来 = { q: { 连续零候选: 9 } };
    const 历史 = 更新冷却(原来, [{ 词: 'q', 候选数: 0 }], now);
    expect(Date.parse(历史.q.暂停到) - now.getTime()).toBe(32 * 天);
    expect(原来.q.连续零候选).toBe(9);
  });
});

describe('记录表', () => {
  test('默认放在 搜索词/数据/搜索词记录.db', () => {
    expect(默认文件.replaceAll('\\', '/')).toMatch(/01-search\/搜索词\/数据\/搜索词记录\.db$/);
  });
  test('还没有库文件时读出空历史，也不建文件', () => {
    const file = 临时文件();
    expect(读历史(file)).toEqual({});
    expect(fs.existsSync(file)).toBe(false);
  });
  test('写入一晚的结果（自动建文件夹和表），读回来和更新冷却算的一样；第二晚累加', () => {
    const file = 临时文件();
    const 表 = 打开记录表(file);
    表.写入([{ 词: 'a', 路线: '细分专业', 候选数: 0 }, { 词: 'b', 路线: '细分专业', 候选数: 5 }], now);
    表.写入([{ 词: 'a', 路线: '细分专业', 候选数: 0 }], new Date(now.getTime() + 天));
    表.close();
    const 历史 = 读历史(file);
    expect(历史.b).toEqual({ 路线: '细分专业', 上次搜索: now.toISOString(), 上次候选数: 5, 连续零候选: 0, 暂停到: null, 搜过次数: 1 });
    expect(历史.a).toMatchObject({ 连续零候选: 2, 搜过次数: 2, 暂停到: new Date(now.getTime() + 3 * 天).toISOString() });
  });
});

describe('生成搜索词（接口）', () => {
  test('交回 { 搜索词们, 平台们, 问题们 }：按北京时间的年份生成 30 个细分专业搜索词', async () => {
    const ctx = fakeCtx({ now: '2026-12-31T17:00:00.000Z' }); // 北京时间已经是 2027 年
    const 计划 = await 生成搜索词(ctx, { 文件: 临时文件() });
    expect(计划.搜索词们).toHaveLength(30);
    expect(计划.搜索词们[0].词).toBe('具身智能 大学生 竞赛 2027 报名');
    expect(计划.平台们).toEqual([]);
    expect(计划.问题们).toEqual([]);
  });
  test('从记录表读历史：昨晚搜过的今晚不再排；额度可以改', async () => {
    const file = 临时文件();
    const ctx = fakeCtx({ now: '2026-10-10T16:30:00.000Z' });
    await 记录搜索词([{ 词: 专业搜索词('具身智能', 2026), 路线: '细分专业', 候选数: 2 }], fakeCtx({ now: '2026-10-09T16:30:00.000Z' }), { 文件: file });
    const 计划 = await 生成搜索词(ctx, { 额度: 2, 文件: file });
    expect(计划.搜索词们).toHaveLength(2);
    expect(计划.搜索词们.map(x => x.专业)).not.toContain('具身智能');
  });
});

describe('记录搜索词（接口）', () => {
  test('把这一晚每个词搜到几条写进记录表', async () => {
    const file = 临时文件();
    const out = await 记录搜索词([{ 词: 'a', 路线: '细分专业', 候选数: 1 }, { 词: 'b', 路线: '细分专业', 候选数: 0 }], fakeCtx(), { 文件: file });
    expect(out).toEqual({ 记录: 2 });
    expect(Object.keys(读历史(file)).sort()).toEqual(['a', 'b']);
  });
  test('没有要记的词（例如全部搜失败）：不打开记录表，也不建文件', async () => {
    const file = 临时文件();
    expect(await 记录搜索词([], fakeCtx(), { 文件: file })).toEqual({ 记录: 0 });
    expect(fs.existsSync(file)).toBe(false);
  });
  test('试跑不写记录表', async () => {
    const file = 临时文件();
    const ctx = { ...fakeCtx(), dryRun: true };
    expect(await 记录搜索词([{ 词: 'a', 路线: '细分专业', 候选数: 1 }], ctx, { 文件: file })).toEqual({ 记录: 0, 试跑: true });
    expect(fs.existsSync(file)).toBe(false);
  });
});
