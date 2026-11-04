// 01 搜索：主运行文件按顺序调用 搜索词 → 搜索接口 和 平台（同时跑）→ 结果处理 → 最终结果 → 记录搜索词；
// 最终结果只调小数据库的接口（创建当晚、写入结果）。不连网、不调 AI。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { fakeCtx } from '../../../../test/复用/假ctx.mjs';
import * as search from '../../index.mjs';
import { 生成搜索词, 记录搜索词 } from '../../搜索词/index.mjs';
import { 读历史 } from '../../搜索词/记录表.mjs';
import { 调用搜索 } from '../../搜索接口/index.mjs';
import { 调用平台 } from '../../平台/index.mjs';
import { PLATFORMS } from '../../平台/平台清单.mjs';
import { 处理结果 } from '../../结果处理/index.mjs';
import { 写入最终结果 } from '../../最终结果/index.mjs';

// 假的小数据库：记下调用，写入时照真的一样交回统计
function 带小数据库(ctx = fakeCtx()) {
  const 记录 = { 当晚信息: null, 写入: [] };
  ctx.小数据库 = {
    创建当晚: 信息 => { 记录.当晚信息 = 信息; },
    写入结果: output => { 记录.写入.push(output); return { items: output.items.length, changes: 0, problems: output.problems || [] }; },
  };
  return { ctx, 记录 };
}
const 计划 = {
  搜索词们: [{ 路线: '新赛事', 词: '2026 大学生 竞赛 报名', 理由: '找新比赛' }, { 路线: '细分专业', 词: '护理 技能大赛 大学生', 理由: '护理类偏少' }],
  平台们: ['天池'],
};
const 结果 = (网址, 渠道, 词 = '2026 大学生 竞赛 报名', 路线 = '新赛事') => ({ 标题: `标题-${网址}`, 网址, 摘要: '', 渠道, 搜索词: 词, 路线 });

describe('主运行文件', () => {
  test('按顺序调用：搜索词 → 搜索接口和平台（同一份计划，同时跑）→ 结果处理 → 最终结果 → 记录搜索词（只记搜成功的词）', async () => {
    const 顺序 = [];
    let 搜索中 = false;
    let 平台看到搜索中 = false;
    let 记下 = null;
    const { ctx } = 带小数据库();
    const out = await search.createRun({
      生成搜索词: async () => { 顺序.push('搜索词'); return 计划; },
      调用搜索: async p => { 顺序.push('搜索'); 搜索中 = true; await new Promise(r => setTimeout(r, 10)); 搜索中 = false; expect(p).toBe(计划);
        return { 结果们: [结果('https://a.cn', '百度')], 问题们: ['搜索“护理”失败'], 每个词: [{ 词: 'a', 路线: '新赛事', 候选数: 1, 成功: true }, { 词: '护理', 路线: '细分专业', 候选数: 0, 成功: false }] }; },
      调用平台: async p => { 顺序.push('平台'); 平台看到搜索中 = 搜索中; expect(p).toBe(计划); return { 结果们: [结果('https://t.cn', '天池')], 问题们: ['辽宁：网站打不开'] }; },
      处理结果: ({ 结果们, 问题们 }) => { 顺序.push('处理'); return { 候选们: 结果们.map(r => ({ key: r.网址, data: r })), 问题们 }; },
      写入最终结果: async ({ 候选们, 问题们 }) => { 顺序.push('最终'); return { 候选: 候选们.length, 问题们 }; },
      记录搜索词: async 每个词 => { 顺序.push('记录'); 记下 = 每个词; return { 记录: 每个词.length }; },
    })({ runId: '2026-10-31' }, ctx);
    expect(顺序).toEqual(['搜索词', '搜索', '平台', '处理', '最终', '记录']);
    expect(平台看到搜索中).toBe(true);
    expect(记下).toEqual([{ 词: 'a', 路线: '新赛事', 候选数: 1 }]);
    expect(out).toEqual({ 候选: 2, 问题们: ['搜索“护理”失败', '辽宁：网站打不开'] });
  });
  test('记录搜索词出错只记警告，不让整个模块失败（结果已经写进小数据库）', async () => {
    const { ctx } = 带小数据库();
    const 警告 = [];
    ctx.log = { ...ctx.log, warn: m => 警告.push(m) };
    const out = await search.createRun({
      ...search.DEFAULT_PARTS,
      生成搜索词: async () => ({ 搜索词们: [], 平台们: [], 问题们: [] }),
      记录搜索词: async () => { throw new Error('磁盘满了'); },
    })({ runId: '2026-10-31' }, ctx);
    expect(out.items).toBe(0);
    expect(警告.join()).toContain('磁盘满了');
  });
  test('用真的搜索词跑一遍：30 个细分专业搜索词都去搜，搜到的写成候选，每个词搜到几条记进记录表', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '搜索-'));
    const 文件 = path.join(dir, '搜索词记录.db');
    try {
      const { ctx, 记录 } = 带小数据库();
      const 搜过 = [];
      ctx.ai = { search: async ({ query }) => { 搜过.push(query); return { provider: 'baidu', references: [{ title: query, url: `https://x.cn/${搜过.length}` }] }; } };
      await search.createRun({
        ...search.DEFAULT_PARTS,
        生成搜索词: c => 生成搜索词(c, { 文件 }),
        记录搜索词: (每个词, c) => 记录搜索词(每个词, c, { 文件 }),
      })({ runId: '2026-10-31' }, ctx);
      expect(搜过).toHaveLength(30);
      expect(记录.当晚信息.搜索词).toBe(30);
      expect(记录.写入[0].items).toHaveLength(30);
      const 历史 = 读历史(文件);
      expect(Object.keys(历史)).toHaveLength(30);
      expect(历史[搜过[0]]).toMatchObject({ 上次候选数: 1, 搜过次数: 1 });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('搜索接口', () => {
  test('每个搜索词经 AI 总管搜一次，结果标上渠道、搜索词、路线；一个词失败只记问题，别的照常', async () => {
    const ctx = fakeCtx();
    ctx.ai = { search: async ({ purpose, query }) => {
      expect(purpose).toBe('search');
      if (query.startsWith('护理')) throw new Error('百度今天的 30 次用完了');
      return { provider: 'baidu', references: [{ title: '第十届大赛通知', url: 'https://a.cn/n', content: '报名截止 11 月', date: '2026-10-20' }] };
    } };
    const { 结果们, 问题们, 每个词 } = await 调用搜索(计划, ctx);
    expect(结果们).toEqual([{ 标题: '第十届大赛通知', 网址: 'https://a.cn/n', 摘要: '报名截止 11 月', 日期: '2026-10-20', 渠道: 'baidu', 搜索词: '2026 大学生 竞赛 报名', 路线: '新赛事' }]);
    expect(问题们).toEqual(['搜索“护理 技能大赛 大学生”失败：百度今天的 30 次用完了']);
    expect(每个词).toEqual([
      { 词: '2026 大学生 竞赛 报名', 路线: '新赛事', 候选数: 1, 成功: true },
      { 词: '护理 技能大赛 大学生', 路线: '细分专业', 候选数: 0, 成功: false },
    ]);
  });
  test('每次搜索都带上屏蔽名单（ctx.屏蔽网站：内置 + 后台确认的；2026-11-02 照旧代码补上）；ctx 没给就不带', async () => {
    const 收到 = [];
    const ctx = fakeCtx();
    ctx.屏蔽网站 = () => ['zhihu.com', 'eol.cn'];
    ctx.ai = { search: async req => { 收到.push(req); return { provider: 'baidu', references: [] }; } };
    await 调用搜索(计划, ctx);
    expect(收到.map(r => r.blocked)).toEqual([['zhihu.com', 'eol.cn'], ['zhihu.com', 'eol.cn']]);
    const 没给 = fakeCtx();
    没给.ai = ctx.ai;
    收到.length = 0;
    await 调用搜索(计划, 没给);
    expect(收到[0].blocked).toEqual([]);
  });
  test('计划里没有搜索词：不调接口', async () => {
    const ctx = fakeCtx();
    ctx.ai = { search: async () => { throw new Error('不该调'); } };
    expect(await 调用搜索({ 搜索词们: [], 平台们: [] }, ctx)).toEqual({ 结果们: [], 问题们: [], 每个词: [] });
  });
});

describe('平台', () => {
  test('计划里列的平台同时跑；一个平台失败只记问题，别的平台的结果照收', async () => {
    const ctx = fakeCtx();
    const 平台们 = {
      天池: async () => [{ 标题: '天池大赛', 网址: 'https://tianchi.cn/1', 摘要: '' }],
      辽宁: async () => { throw new Error('网站打不开'); },
      不在计划里: async () => { throw new Error('不该跑'); },
    };
    const { 结果们, 问题们 } = await 调用平台({ 搜索词们: [], 平台们: ['天池', '辽宁'] }, ctx, 平台们);
    expect(结果们).toEqual([{ 标题: '天池大赛', 网址: 'https://tianchi.cn/1', 摘要: '', 渠道: '天池', 搜索词: '', 路线: '平台' }]);
    expect(问题们).toEqual(['平台“辽宁”失败：网站打不开']);
  });
  test('计划里写了没登记的平台：记问题；平台清单里现有天池、辽宁，都还是占位', async () => {
    expect((await 调用平台({ 平台们: ['不存在'] }, fakeCtx(), {})).问题们).toEqual(['没有这个平台：不存在']);
    expect(Object.keys(PLATFORMS).sort()).toEqual(['天池', '辽宁'].sort());
    const { 问题们 } = await 调用平台({ 平台们: ['天池', '辽宁'] }, fakeCtx());
    expect(问题们.every(p => p.includes('还没实现'))).toBe(true);
  });
});

describe('结果处理', () => {
  test('同一网址（去掉跟踪参数后）合成一条候选，记下所有渠道、搜索词、路线；网址不对的去掉并记问题', () => {
    const { 候选们, 问题们 } = 处理结果({ 结果们: [
      结果('https://a.cn/n?utm_source=x', 'baidu'),
      结果('https://a.cn/n', 'kimi', '护理 技能大赛 大学生', '细分专业'),
      结果('https://b.cn/m', '天池', '', '平台'),
      结果('javascript:alert(1)', 'baidu'),
    ], 问题们: ['辽宁：网站打不开'] });
    expect(候选们).toEqual([
      { key: 'https://a.cn/n', data: { name: '标题-https://a.cn/n?utm_source=x', url: 'https://a.cn/n', snippet: '', 渠道们: ['baidu', 'kimi'], 搜索词们: ['2026 大学生 竞赛 报名', '护理 技能大赛 大学生'], 路线们: ['新赛事', '细分专业'] } },
      { key: 'https://b.cn/m', data: { name: '标题-https://b.cn/m', url: 'https://b.cn/m', snippet: '', 渠道们: ['天池'], 搜索词们: [], 路线们: ['平台'] } },
    ]);
    expect(问题们).toEqual(['辽宁：网站打不开', '1 条结果的网址不对，去掉了']);
  });
});

describe('最终结果', () => {
  test('调小数据库：先创建当晚（记下计划和数量），再写入候选（kind 为 candidate、进行中），交回统计', async () => {
    const { ctx, 记录 } = 带小数据库();
    const 候选们 = [{ key: 'https://a.cn/n', data: { name: 'A', url: 'https://a.cn/n' } }];
    const stats = await 写入最终结果({ 计划, 候选们, 问题们: ['x'] }, ctx);
    expect(记录.当晚信息).toEqual({ 计划, 搜索词: 2, 平台: 1, 候选: 1 });
    expect(记录.写入).toEqual([{ items: [{ key: 'https://a.cn/n', kind: 'candidate', status: '进行中', data: { name: 'A', url: 'https://a.cn/n' }, result: '搜到', reason: '' }], changes: [], problems: ['x'] }]);
    expect(stats).toEqual({ items: 1, changes: 0, problems: ['x'] });
  });
});
