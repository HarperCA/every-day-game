// 补差量：第一次搬完之后上海又有新数据，北京也可能被开发版写过。只动上海真正变过的，北京自己改过的不盖掉（2026-11-05）。
// 全部是编出来的数据，不碰真实导出。
import { beforeEach, describe, expect, test } from 'vitest';
import { openUserDb } from '../../../副数据库/index.mjs';
import { 打开报错库 } from '../../../服务/收集报错/报错库.mjs';
import { 搬 } from '../../搬.mjs';
import { 补差量 } from '../../补差量.mjs';

const 时 = '2026-11-01T00:00:00.000Z';
const 晚 = '2026-11-05T00:00:00.000Z';
const 账号 = (id, over = {}) => ({ _id: id, openid: `o-${id}`, status: 'active', created_at: 时, updated_at: 时, last_login_at: 时, ...over });
const 收藏 = (id, user_id, edition_id) => ({ _id: id, user_id, edition_id, created_at: 时, updated_at: 时 });
const 提醒 = (id, user_id, over = {}) => ({ _id: id, id, user_id, edition_id: 'ed-1', competition_name: '甲赛', task_name: '甲赛·报名截止', event_type: 'registration_end', event_label: '报名截止',
  target_at: '2026-12-20T15:59:59.000Z', advance_key: '1d', advance_label: '提前 1 天', offset_ms: 86400000, remind_at: '2026-12-19T15:59:59.000Z',
  authorization_status: 'accepted', delivery_status: 'pending', schedule_change_status: 'normal', subscription_template_id: 'tpl', retry_count: 0, last_error: null, created_at: 时, updated_at: 时, ...over });
const 偏好 = (user_id, over = {}) => ({ _id: user_id, user_id, profession: '计算机', categories: ['计算机'], province: '福建省', survey_status: 'completed', dont_show_again: true, created_at: 时, updated_at: 时, ...over });
const 对照 = { 'ed-1': 'c-1', 'ed-2': 'c-2', 'ed-3': 'c-3' };

const 基线 = () => ({
  user_account: [账号('u1'), 账号('u2'), 账号('u3')],
  favorite: [收藏('f1', 'u1', 'ed-1'), 收藏('f2', 'u2', 'ed-1')],
  reminder: [提醒('r1', 'u1'), 提醒('r2', 'u2')],
  user_preference: [偏好('u1')],
  client_issues: [{ _id: 'ci-1', kind: 'slow', at: 时, message: '慢' }],
  client_stats: [{ _id: '2026-11-01', date: '2026-11-01', list: 10, get: 2 }],
});

let 用户库, 报错库, 钟;
beforeEach(() => {
  钟 = new Date('2026-11-03T00:00:00.000Z');
  用户库 = openUserDb({ file: ':memory:', now: () => 钟 });
  报错库 = 打开报错库(':memory:');
  搬(基线(), { 用户库, 报错库, 届次对照: 对照 });
});
const 补 = (现在, 选项 = {}) => 补差量(基线(), 现在, { 用户库, 报错库, 届次对照: 对照, ...选项 });

describe('补差量', () => {
  test('上海新增的账号、收藏、提醒、偏好、报错都补进来，统计按增量加', () => {
    const 现在 = 基线();
    现在.user_account.push(账号('u4'));
    现在.favorite.push(收藏('f3', 'u4', 'ed-2'));
    现在.reminder.push(提醒('r3', 'u4'));
    现在.user_preference.push(偏好('u4'));
    现在.client_issues.push({ _id: 'ci-2', kind: 'slow', at: 晚, message: '又慢' });
    现在.client_stats = [{ _id: '2026-11-01', date: '2026-11-01', list: 13, get: 2 }, { _id: '2026-11-02', date: '2026-11-02', list: 1, get: 1 }];
    报错库.写统计('2026-11-01', 15, 2);   // 北京自己又多了 5 次
    const 结果 = 补(现在);
    expect(结果.核对通过).toBe(true);
    expect(结果.统计).toMatchObject({ 新增: 4, 修改: 0, 删除: 0, 报错: 1 });
    expect(用户库.get('user_account', 'u4').data.openid).toBe('o-u4');
    expect(用户库.get('favorite', 'f3').data.competition_id).toBe('c-2');
    expect(用户库.get('reminder', 'r3').data.user_id).toBe('u4');
    expect(用户库.get('user_preference', 'u4').data.province).toBe('福建省');
    expect(报错库.全部().map(x => x.message)).toEqual(['慢', '又慢']);
    expect(报错库.全部统计()).toEqual([{ date: '2026-11-01', list: 18, get: 2 }, { date: '2026-11-02', list: 1, get: 1 }]);
  });

  test('上海改过、北京没动：更新成上海的', () => {
    const 现在 = 基线();
    现在.reminder[0] = 提醒('r1', 'u1', { delivery_status: 'sent', sent_at: 晚, updated_at: 晚 });
    const 结果 = 补(现在);
    expect(结果.统计.修改).toBe(1);
    expect(用户库.get('reminder', 'r1').data).toMatchObject({ delivery_status: 'sent', sent_at: 晚 });
  });

  test('北京改过、上海没动：留北京的，不算冲突', () => {
    用户库.update('user_preference', 'u1', { province: '北京市' });
    const 结果 = 补(基线());
    expect(结果.统计).toMatchObject({ 新增: 0, 修改: 0, 删除: 0 });
    expect(结果.冲突们).toEqual([]);
    expect(用户库.get('user_preference', 'u1').data.province).toBe('北京市');
  });

  test('两边都改过：更新时间晚的赢，并记下来', () => {
    用户库.update('user_preference', 'u1', { province: '北京市' });
    const 现在 = 基线();
    现在.user_preference[0] = 偏好('u1', { province: '上海市', updated_at: 晚 });
    const 结果 = 补(现在);
    expect(用户库.get('user_preference', 'u1').data.province).toBe('上海市');
    expect(用户库.get('user_preference', 'u1').data.updated_at).toBe(晚);   // 上海的时间留着，不变成写入时间
    expect(结果.冲突们).toEqual([expect.objectContaining({ 表: 'user_preference', 编号: 'u1' })]);
    expect(结果.核对通过).toBe(true);

    钟 = new Date('2026-11-06T00:00:00.000Z');
    用户库.update('user_preference', 'u1', { province: '广东省' });
    const 再现在 = 基线();
    再现在.user_preference[0] = 偏好('u1', { province: '浙江省', updated_at: 晚 });
    补(再现在);
    expect(用户库.get('user_preference', 'u1').data.province).toBe('广东省');
  });

  test('上海改了账号：更新，时间由数据库记，核对照样通过', () => {
    const 现在 = 基线();
    现在.user_account[0] = 账号('u1', { last_login_at: 晚, updated_at: 晚 });
    const 结果 = 补(现在);
    expect(结果.核对通过).toBe(true);
    expect(用户库.get('user_account', 'u1').data.last_login_at).toBe(晚);
  });

  test('上海删了、北京没动：跟着删；北京已经删了的不复活', () => {
    用户库.remove('favorite', 'f2');
    const 现在 = 基线();
    现在.favorite = 现在.favorite.filter(x => x._id !== 'f1');   // f1 上海删了；f2 北京删了、上海还在
    const 结果 = 补(现在);
    expect(用户库.get('favorite', 'f1')).toBeNull();
    expect(用户库.get('favorite', 'f2')).toBeNull();
    expect(结果.统计).toMatchObject({ 新增: 0, 删除: 1 });
  });

  test('上海注销了账号：连带删掉；北京这边登录过的留下并记下', () => {
    用户库.update('user_account', 'u3', { last_login_at: 晚 });
    const 现在 = 基线();
    现在.user_account = 现在.user_account.filter(x => !['u2', 'u3'].includes(x._id));
    现在.favorite = 现在.favorite.filter(x => x.user_id !== 'u2');
    现在.reminder = 现在.reminder.filter(x => x.user_id !== 'u2');
    const 结果 = 补(现在);
    expect(用户库.get('user_account', 'u2')).toBeNull();
    expect(用户库.get('favorite', 'f2')).toBeNull();
    expect(用户库.get('reminder', 'r2')).toBeNull();
    expect(用户库.get('user_account', 'u3').data.last_login_at).toBe(晚);
    expect(结果.冲突们).toContainEqual(expect.objectContaining({ 表: 'user_account', 编号: 'u3' }));
    expect(结果.核对通过).toBe(true);
  });

  test('新账号的 openid 北京已有，或收藏已有同一比赛：不写、记下，其余照常', () => {
    用户库.insert('user_account', 'u-北京', { openid: 'o-u9', status: 'active', created_at: 时, updated_at: 时 });
    用户库.insert('favorite', 'f-北京', { user_id: 'u1', competition_id: 'c-2', created_at: 时 });
    const 现在 = 基线();
    现在.user_account.push(账号('u9'));
    现在.reminder.push(提醒('r9', 'u9'));
    现在.favorite.push(收藏('f8', 'u1', 'ed-2'), 收藏('f9', 'u1', 'ed-3'));
    const 结果 = 补(现在);
    expect(用户库.get('user_account', 'u9')).toBeNull();
    expect(用户库.get('reminder', 'r9')).toBeNull();
    expect(用户库.get('favorite', 'f8')).toBeNull();
    expect(用户库.get('favorite', 'f9').data.competition_id).toBe('c-3');
    expect(结果.冲突们.map(x => x.编号)).toEqual(expect.arrayContaining(['u9', 'r9', 'f8']));
  });

  test('试跑只算不写；任何一条写失败整个撤回', () => {
    const 现在 = 基线();
    现在.user_account.push(账号('u4'));
    expect(补(现在, { 试跑: true }).统计.新增).toBe(1);
    expect(用户库.get('user_account', 'u4')).toBeNull();

    const 坏库 = new Proxy(用户库, { get(目标, 名) {
      if (名 !== 'transaction') return 目标[名];
      return fn => 目标.transaction(tx => { fn(tx); throw new Error('写到一半出错'); });
    } });
    expect(() => 补差量(基线(), 现在, { 用户库: 坏库, 报错库, 届次对照: 对照 })).toThrow('写到一半出错');
    expect(用户库.get('user_account', 'u4')).toBeNull();
  });

  test('报告不带 openid 和用户写的内容；交回上海还管着的提醒编号', () => {
    const 现在 = 基线();
    现在.user_account.push(账号('u4'));
    现在.reminder.push(提醒('r3', 'u4'));
    const 结果 = 补(现在);
    expect(JSON.stringify({ ...结果, 上海提醒编号: undefined })).not.toContain('o-u4');
    expect(结果.上海提醒编号.sort()).toEqual(['r1', 'r2', 'r3']);
  });
});
