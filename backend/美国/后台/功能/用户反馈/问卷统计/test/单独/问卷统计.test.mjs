// 问卷统计：小程序首次打开的偏好问卷。数据从北京副数据库的偏好表经用户数据同步到美国的用户副本（2026-11-02）；
// 汇总照旧 publicSync/preferenceValidation.js 的 aggregatePreferences（不在选项名单里的值丢掉），金值是旧代码在同样输入上跑出来的。只有计数，不带账号。
import { describe, expect, test } from 'vitest';
import { 用户副本 } from '../../../../../../db/index.mjs';
import { 取 } from '../../数据库.mjs';
import { 整理 } from '../../整理.mjs';
import 金值 from '../复用/旧代码金值.json' with { type: 'json' };

describe('问卷统计', () => {
  test('取：从用户副本读偏好；没配用户副本时说明数据从哪来', async () => {
    const 副本库 = 用户副本.open({ file: ':memory:' });
    用户副本.写(副本库, 金值.prefs.map((x, i) => ({ 表: 'user_preference', 编号: `u${i}`, data: { user_id: `u${i}`, ...x } })));
    const 原始 = await 取({}, { 用户副本库: 副本库, now: () => new Date('2026-11-02T04:00:00.000Z') });
    expect(原始).toMatchObject({ 接好了: true, 现在: '2026-11-02T04:00:00.000Z' });
    expect(原始.偏好们).toHaveLength(金值.prefs.length);
    expect(await 取({}, {})).toMatchObject({ 接好了: false });
  });
  test('整理：和旧代码的计数一样；结果里没有账号编号', () => {
    const 数据 = 整理({ 偏好们: 金值.prefs.map((x, i) => ({ user_id: `u${i}`, ...x })), 现在: '2026-11-02T04:00:00.000Z', 接好了: true });
    expect(数据.统计).toEqual(金值.结果);
    expect(JSON.stringify(数据)).not.toContain('u0');
  });
});
