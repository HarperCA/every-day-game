// 后台 · 接口用量：最近几天各家接口调了多少次、成功失败、token、费用；按天、按接口、按来源汇总；月费单列（2026-11-02）。
// 用量库由环境给读取函数（AI 总管的 usage.report、usage.fixedFees），这里用假的。
import { describe, expect, test } from 'vitest';
import { 处理后台请求 } from '../../../../../接口.mjs';
import { 整理 } from '../../整理.mjs';

const NOW = new Date('2026-11-01T10:00:00Z');   // 北京时间 11-01 18:00
const 行 = (day, source, provider, calls, failed, tokensIn, tokensOut, cost) => ({ day, source, provider, calls, ok: calls - failed, failed, tokensIn, tokensOut, cost, ms: 0 });
const 行们 = [
  行('2026-10-31', '每晚自动化', 'deepseek', 10, 1, 20000, 3000, 0.5),
  行('2026-10-31', '每晚自动化', 'kimi', 4, 0, 8000, 1000, 0),
  行('2026-11-01', '每晚自动化', 'deepseek', 6, 0, 12000, 2000, 0.3),
  行('2026-11-01', '实时', 'deepseek', 3, 0, 3000, 600, null),
  行('2026-11-01', '每晚自动化', 'baidu', 30, 2, null, null, null),
];

function 环境() {
  const 收到 = [];
  return { 收到, env: { now: () => NOW, AI用量: { report: (从, 到) => { 收到.push(['report', 从, 到]); return 行们; }, fixedFees: 月 => { 收到.push(['fixedFees', 月]); return [{ provider: 'codex', amount: 140, note: 'ChatGPT Plus' }]; } } } };
}

describe('取数据', () => {
  test('最近 7 天（北京时间，含今天）；月费取这个月的', async () => {
    const { env, 收到 } = 环境();
    const r = await 处理后台请求('接口用量', {}, env);
    expect(收到).toEqual([['report', '2026-10-26', '2026-11-01'], ['fixedFees', '2026-11']]);
    expect(r).toMatchObject({ 天数: 7, 从: '2026-10-26', 到: '2026-11-01', 月份: '2026-11', 没接上: false });
    expect(r.行们).toHaveLength(5);
    expect((await 处理后台请求('接口用量', { 天数: 1 }, env)).从).toBe('2026-11-01');
    await expect(处理后台请求('接口用量', { 天数: 3 }, env)).rejects.toThrow(/天数/);
  });
  test('环境没给用量库：写明没接上', async () => {
    expect(await 处理后台请求('接口用量', {}, { now: () => NOW })).toMatchObject({ 没接上: true, 行们: [] });
  });
});

describe('整理', () => {
  const 原始 = { 天数: 7, 从: '2026-10-26', 到: '2026-11-01', 月份: '2026-11', 行们, 固定费用: [{ provider: 'codex', amount: 140, note: 'ChatGPT Plus' }], 没接上: false };
  test('合计：次数、失败、token；费用只加有价格的，有没算价的写明', () => {
    expect(整理(原始).合计).toEqual({ 次数: 53, 失败: 3, 输入token: 43000, 输出token: 6600, 费用: 0.8, 有没算价的: true });
  });
  test('按天（新的在前）、按接口（中文名，次数多的在前）、按来源', () => {
    const r = 整理(原始);
    expect(r.按天.map(x => [x.名称, x.次数, x.失败])).toEqual([['2026-11-01', 39, 2], ['2026-10-31', 14, 1]]);
    expect(r.按接口.map(x => [x.名称, x.次数])).toEqual([['百度', 30], ['DeepSeek', 19], ['Kimi', 4]]);
    expect(r.按来源.map(x => [x.名称, x.次数])).toEqual([['每晚自动化', 50], ['实时', 3]]);
    expect(r.按接口.find(x => x.名称 === '百度')).toMatchObject({ 费用: null, 有没算价的: true });
  });
  test('月费单列；没有调用时各项为空', () => {
    expect(整理(原始).月费).toEqual([{ 接口: 'Codex', 金额: 140, 说明: 'ChatGPT Plus' }]);
    expect(整理({ ...原始, 行们: [], 固定费用: [] })).toMatchObject({ 合计: { 次数: 0, 费用: null, 有没算价的: false }, 按天: [], 月费: [] });
  });
});
