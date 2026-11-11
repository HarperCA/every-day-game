// 访问异常：小程序在用户手机上出的问题。数据从北京的报错库经用户数据同步到美国的用户副本（2026-11-02）；
// 汇总照旧后台 adminData/clientIssues.js 的 aggregateClientIssues（成功率 = 成功加载 ÷ 总尝试），金值是旧代码在同样输入上跑出来的。
import { describe, expect, test } from 'vitest';
import { 用户副本 } from '../../../../../../db/index.mjs';
import { 取 } from '../../数据库.mjs';
import { 整理 } from '../../整理.mjs';
import 金值 from '../复用/旧代码金值.json' with { type: 'json' };

const 挑 = (对象, 键们) => Object.fromEntries(键们.map(k => [k, 对象[k]]));

describe('访问异常', () => {
  test('取：从用户副本读报错日志和加载统计；没配用户副本时说明数据从哪来', async () => {
    const 副本库 = 用户副本.open({ file: ':memory:' });
    用户副本.写(副本库, [
      ...金值.issues.map((x, i) => ({ 表: 'client_issues', 编号: String(i + 1), data: { id: i + 1, ...x } })),
      ...金值.stats.map(x => ({ 表: 'client_stats', 编号: x.date, data: x })),
    ]);
    const 原始 = await 取({}, { 用户副本库: 副本库, now: () => new Date(金值.now) });
    expect(原始).toMatchObject({ 接好了: true, 现在: 金值.now });
    expect(原始.issues).toHaveLength(金值.issues.length);
    expect(原始.stats).toHaveLength(金值.stats.length);
    expect(await 取({}, {})).toMatchObject({ 接好了: false });
  });
  test('整理：和旧代码的汇总一样（最近 3 天、今天）', () => {
    const 原始 = { issues: 金值.issues, stats: 金值.stats, 现在: 金值.now, 接好了: true };
    for (const 天数 of [3, 1]) {
      const 旧 = 金值.结果[天数];
      expect(挑(整理(原始, { 天数 }), Object.keys(旧))).toEqual(旧);
    }
    expect(整理(原始, {}).days).toBe(14);
  });
});
