// 搬旧数据：上海云开发导出的用户数据（scripts/server/export-shanghai-users.py 导出的文件夹，每个集合一个 .json）搬进北京副数据库和报错库（2026-11-02）。
// 用的全是编出来的数据，不碰真实导出。规则见 ../../转换.mjs 开头。
import { describe, expect, test } from 'vitest';
import { openUserDb } from '../../../副数据库/index.mjs';
import { 打开报错库 } from '../../../服务/收集报错/报错库.mjs';
import { 转换 } from '../../转换.mjs';
import { 搬 } from '../../搬.mjs';

const 时 = '2026-10-01T00:00:00.000Z';
const 旧 = () => ({
  user_account: [
    { _id: 'user-a', openid: 'o-a', appid: 'wx', unionid: null, status: 'active', created_at: 时, updated_at: 时, last_login_at: 时 },
    { _id: 'user-b', openid: 'o-b', status: 'active', created_at: { $date: '2026-10-02T00:00:00.000Z' }, updated_at: '2026-10-02T00:00:00.000Z' },
    { _id: 'user-坏', status: 'active', created_at: 时 },   // 没有 openid
  ],
  favorite: [
    { _id: 'fav-1', user_id: 'user-a', edition_id: 'ed-math-2025', created_at: '2026-10-03T00:00:00.000Z', updated_at: 时 },
    { _id: 'fav-2', user_id: 'user-a', edition_id: 'ed-math-2026', created_at: '2026-10-01T00:00:00.000Z', updated_at: 时 },   // 同一个比赛的另一届：合成一条，留最早的
    { _id: 'fav-3', user_id: 'user-a', edition_id: 'ed-找不到', created_at: 时, updated_at: 时 },
    { _id: 'fav-4', user_id: 'user-没有', edition_id: 'ed-math-2026', created_at: 时, updated_at: 时 },
  ],
  reminder: [
    { _id: 'r1', id: 'r1', user_id: 'user-a', edition_id: 'ed-math-2026', competition_name: '数学建模', task_name: '数学建模·报名截止', event_type: 'registration_end', event_label: '报名截止',
      target_at: '2026-11-20T15:59:59.000Z', advance_key: '1d', advance_label: '提前 1 天', offset_ms: 86400000, remind_at: '2026-11-19T15:59:59.000Z',
      authorization_status: 'accepted', delivery_status: 'pending', schedule_change_status: 'normal', subscription_template_id: 'tpl', retry_count: 0, last_error: null,
      created_at: 时, updated_at: 时, data_version: 3 },
    { _id: 'r2', id: 'r2', user_id: 'user-a', edition_id: 'ed-math-2026', event_type: 'registration_end' },   // 缺字段
  ],
  user_preference: [
    { _id: 'user-a', user_id: 'user-a', profession: '计算机与AI', categories: ['计算机与AI'], province: '福建省', survey_status: 'completed', dont_show_again: true, created_at: 时, updated_at: 时, data_version: 2 },
  ],
  feedback: [],
  general_feedback: [
    { _id: 'gf-1', user_id: 'user-b', type: 'bug', content: '首页打不开', contact: '', app_version: '1.0.0', status: 'resolved', public_reply: '修好了', internal_note: '', created_at: 时, updated_at: 时, resolved_at: 时, data_version: 1 },
  ],
  client_issues: [
    { _id: 'ci-2', kind: 'slow', at: '2026-10-02T00:00:00.000Z', page: 'p', elapsed_ms: 4000 },
    { _id: 'ci-1', kind: 'load_failed', at: '2026-10-01T00:00:00.000Z', message: '超时' },
  ],
  client_stats: [{ _id: '2026-10-01', date: '2026-10-01', list: 7, get: 2 }],
});
const 届次对照 = { 'ed-math-2025': 'event-math', 'ed-math-2026': 'event-math' };

describe('转换（纯计算）', () => {
  test('账号原样带编号；没有 openid 的不搬；时间统一成 ISO 文字', () => {
    const { 新, 问题们 } = 转换(旧(), { 届次对照 });
    expect(新.user_account.map(x => x.id)).toEqual(['user-a', 'user-b']);
    expect(新.user_account[1]).toMatchObject({ openid: 'o-b', created_at: '2026-10-02T00:00:00.000Z' });
    expect(问题们).toContainEqual(expect.objectContaining({ 表: 'user_account', 编号: 'user-坏', 原因: '没有 openid' }));
  });
  test('收藏改挂比赛：同一人同一比赛的几届合成一条，留最早的；对不上比赛、账号不在的不搬并记下', () => {
    const { 新, 问题们 } = 转换(旧(), { 届次对照 });
    expect(新.favorite).toEqual([{ id: 'fav-2', user_id: 'user-a', competition_id: 'event-math', created_at: '2026-10-01T00:00:00.000Z' }]);
    expect(问题们.map(x => [x.表, x.编号, x.原因])).toEqual(expect.arrayContaining([
      ['favorite', 'fav-1', '同一个比赛已有更早的收藏，合并'],
      ['favorite', 'fav-3', '届次 ed-找不到 对不上比赛'],
      ['favorite', 'fav-4', '账号 user-没有 不在'],
    ]));
  });
  test('提醒、偏好、意见反馈照旧字段搬，去掉 _id、data_version；缺字段的不搬', () => {
    const { 新, 问题们 } = 转换(旧(), { 届次对照 });
    expect(新.reminder).toHaveLength(1);
    expect(新.reminder[0]).toMatchObject({ id: 'r1', user_id: 'user-a', delivery_status: 'pending', subscription_template_id: 'tpl', created_at: 时 });
    expect(新.reminder[0]).not.toHaveProperty('data_version');
    expect(新.reminder[0]).not.toHaveProperty('_id');
    expect(问题们).toContainEqual(expect.objectContaining({ 表: 'reminder', 编号: 'r2' }));
    expect(新.user_preference[0]).toEqual({ user_id: 'user-a', profession: '计算机与AI', categories: ['计算机与AI'], province: '福建省', survey_status: 'completed', dont_show_again: true, created_at: 时, updated_at: 时 });
    expect(新.general_feedback[0]).toMatchObject({ id: 'gf-1', status: 'resolved', public_reply: '修好了', contact: null, internal_note: null });
  });
  test('报错日志按时间先后，去掉 _id；加载统计照搬', () => {
    const { 报错 } = 转换(旧(), { 届次对照 });
    expect(报错.issues.map(x => x.kind)).toEqual(['load_failed', 'slow']);
    expect(报错.issues[0]).not.toHaveProperty('_id');
    expect(报错.stats).toEqual([{ date: '2026-10-01', list: 7, get: 2 }]);
  });
});

describe('搬（写进库并核对）', () => {
  test('写进副数据库和报错库，逐表核对条数；保留原来的时间', () => {
    const 用户库 = openUserDb({ file: ':memory:', now: () => new Date('2026-11-02T00:00:00Z') });
    const 报错库 = 打开报错库(':memory:');
    const 报告 = 搬(旧(), { 用户库, 报错库, 届次对照 });
    expect(报告.写了).toEqual({ user_account: 2, favorite: 1, reminder: 1, user_preference: 1, feedback: 0, general_feedback: 1, client_issues: 2, client_stats: 1 });
    expect(报告.核对通过).toBe(true);
    expect(用户库.get('reminder', 'r1').data).toMatchObject({ created_at: 时, updated_at: 时 });
    expect(报错库.全部统计()).toEqual([{ date: '2026-10-01', list: 7, get: 2 }]);
    expect(报告.问题们.length).toBeGreaterThan(0);
    // 报告里不出现 openid
    expect(JSON.stringify(报告)).not.toMatch(/o-a|o-b/);
  });
  test('目标库里已经有数据：不搬（不和已有的混在一起），整体不动', () => {
    const 用户库 = openUserDb({ file: ':memory:' });
    const 报错库 = 打开报错库(':memory:');
    搬(旧(), { 用户库, 报错库, 届次对照 });
    expect(() => 搬(旧(), { 用户库, 报错库, 届次对照 })).toThrow('不是空的');
  });
});
