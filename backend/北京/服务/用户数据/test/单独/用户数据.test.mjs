// 用户数据：搬自上海云函数 userData（2026-11-02），去掉云函数的兼容外壳。动作、校验、交回的格式都和上海一样，改了三处：
//   身份：上海用 cloud.getWXContext()；北京由入口校验令牌后把 openid 交进来，这里按 openid 找账号
//   收藏：上海挂届次；北京挂比赛（2026-11-01 定）。小程序照旧传届次编号，按主数据库换成比赛存；列出时交回这个比赛最新的一届
//   纠错限频：上海把计数存在账号上；北京数这个人最近 24 小时交了几条，规则一样（每人每天 20 条）
// 不再把快到期的提醒推给美国（reminderPush）：北京自己的“发提醒”服务从用户库读到期的提醒。
import { describe, expect, test } from 'vitest';
import { openMainDb, 同步 } from '../../../../主数据库/index.mjs';
import { openUserDb, 用户 } from '../../../../副数据库/index.mjs';
import { handle } from '../../index.mjs';

const NOW = new Date('2026-11-02T02:00:00Z');
function 环境({ now = NOW } = {}) {
  const 主库 = openMainDb({ file: ':memory:', now: () => now });
  同步.收下(主库, {
    比赛们: [{ id: 'event-math', version: 1, name: '全国大学生数学建模竞赛', level: '国家级', data: {} }],
    届次们: [
      { id: 'ed-math-2025', competition_id: 'event-math', version: 1, registration_end: '2025-09-10', status: '已归档', data: { edition_name: '2025 年' } },
      { id: 'ed-math-2026', competition_id: 'event-math', version: 1, registration_end: '2026-09-10', status: '已发布', data: { edition_name: '2026 年' } },
    ],
  });
  const 用户库 = openUserDb({ file: ':memory:', now: () => now });
  const 账号 = 用户.新建或登录(用户库, { openid: 'o-1' }, { now });
  return { 主库, 用户库, 账号, openid: 'o-1', now: () => now };
}
const 做 = (env, action, 参数 = {}) => handle({ action, ...参数 }, env);
const 提醒 = (id, over = {}) => ({ id, editionId: 'ed-math-2026', competitionName: '全国大学生数学建模竞赛', eventType: 'registration_end', eventLabel: '报名截止',
  targetAt: '2026-09-10T15:59:59.000Z', advanceKey: '1d', advanceLabel: '提前 1 天', remindAt: '2026-09-09T15:59:59.000Z',
  authorizationStatus: 'accepted', deliveryStatus: 'pending', scheduleChangeStatus: 'normal', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', ...over });

describe('身份', () => {
  test('没有身份、账号不存在：unauthenticated；账号停用：user_account_disabled；不认识的动作：unsupported_action', async () => {
    const env = 环境();
    expect(await 做({ ...env, openid: '' }, 'listFavorites')).toEqual({ ok: false, message: 'unauthenticated' });
    expect(await 做({ ...env, openid: 'o-陌生' }, 'listFavorites')).toEqual({ ok: false, message: 'unauthenticated' });
    expect(await 做(env, 'deleteEverything')).toEqual({ ok: false, message: 'unsupported_action' });
    用户.停用(env.用户库, env.账号.id, { now: NOW });
    expect(await 做(env, 'listFavorites')).toEqual({ ok: false, message: 'user_account_disabled' });
  });
  test('请求里自己写的 openid 不认，只认入口交进来的', async () => {
    const env = 环境();
    await 做(env, 'setFavorite', { editionId: 'ed-math-2026', favorited: true, openid: 'o-别人' });
    expect(env.用户库.find('favorite', {})[0].user_id).toBe(env.账号.id);
  });
});

describe('收藏：小程序传届次，存的是比赛', () => {
  test('收藏一届 = 收藏它的比赛；同一个比赛的另一届不重复存；列出时交回这个比赛最新的一届', async () => {
    const env = 环境();
    expect(await 做(env, 'setFavorite', { editionId: 'ed-math-2025', favorited: true })).toEqual({ ok: true, data: { favorited: true } });
    await 做(env, 'setFavorite', { editionId: 'ed-math-2026', favorited: true });
    expect(env.用户库.find('favorite', {}).map(f => f.competition_id)).toEqual(['event-math']);
    expect(await 做(env, 'listFavorites')).toEqual({ ok: true, data: [{ editionId: 'ed-math-2026', createdAt: NOW.toISOString() }] });
  });
  test('取消收藏：哪一届都行，取消的是整个比赛', async () => {
    const env = 环境();
    await 做(env, 'setFavorite', { editionId: 'ed-math-2026', favorited: true });
    await 做(env, 'setFavorite', { editionId: 'ed-math-2025', favorited: false });
    expect((await 做(env, 'listFavorites')).data).toEqual([]);
  });
  test('合并本地收藏（mergeFavorites）：一批届次，换成比赛存；主数据库里找不到的届次报 edition_not_found', async () => {
    const env = 环境();
    expect(await 做(env, 'mergeFavorites', { records: [{ editionId: 'ed-math-2025', createdAt: '2026-10-01T00:00:00.000Z' }] })).toEqual({ ok: true, data: { merged: 1 } });
    expect((await 做(env, 'listFavorites')).data).toEqual([{ editionId: 'ed-math-2026', createdAt: '2026-10-01T00:00:00.000Z' }]);
    expect(await 做(env, 'setFavorite', { editionId: 'ed-不存在', favorited: true })).toEqual({ ok: false, message: 'edition_not_found' });
    expect(await 做(env, 'setFavorite', { editionId: 'ed-math-2026', favorited: 'yes' })).toEqual({ ok: false, message: 'invalid_favorited' });
  });
});

describe('提醒', () => {
  test('合并（mergeReminders）：校验后存进用户库，列出时交回和上海一样的格式', async () => {
    const env = 环境();
    expect(await 做(env, 'mergeReminders', { records: [提醒('r-1')] })).toEqual({ ok: true, data: { merged: 1, preserved: 0 } });
    const [r] = (await 做(env, 'listReminders')).data;
    expect(r).toMatchObject({ id: 'r-1', editionId: 'ed-math-2026', taskName: '全国大学生数学建模竞赛·报名截止提醒', eventType: 'registration_end',
      remindAt: '2026-09-09T15:59:59.000Z', offsetMs: 86400000, deliveryStatus: 'pending', retryCount: 0 });
    expect(await 做(env, 'mergeReminders', { records: [{ ...提醒('r-2'), remindAt: '2026-09-11T00:00:00.000Z' }] })).toEqual({ ok: false, message: 'invalid_remind_at' });
  });
  test('已经发出或排队中的提醒不被覆盖（上海的 reminderWritePolicy）', async () => {
    const env = 环境();
    await 做(env, 'mergeReminders', { records: [提醒('r-1', { deliveryStatus: 'sent' })] });
    expect((await 做(env, 'mergeReminders', { records: [提醒('r-1', { advanceKey: '3d', advanceLabel: '提前 3 天', remindAt: '2026-09-07T15:59:59.000Z' })] })).data).toEqual({ merged: 1, preserved: 1 });
    expect((await 做(env, 'listReminders')).data[0].advanceKey).toBe('1d');
  });
  test('改一届一类的提醒（replaceReminderEvent）：留下新给的，删掉其余的，已发出的留着', async () => {
    const env = 环境();
    await 做(env, 'mergeReminders', { records: [提醒('r-1'), 提醒('r-2', { advanceKey: '3d', advanceLabel: '提前 3 天', remindAt: '2026-09-07T15:59:59.000Z' }), 提醒('r-3', { deliveryStatus: 'sent', advanceKey: '7d', advanceLabel: '提前 7 天', remindAt: '2026-09-03T15:59:59.000Z' })] });
    const r = await 做(env, 'replaceReminderEvent', { editionId: 'ed-math-2026', eventType: 'registration_end', records: [提醒('r-1'), 提醒('r-4', { advanceKey: '5d', advanceLabel: '提前 5 天', remindAt: '2026-09-05T15:59:59.000Z' })] });
    expect(r).toEqual({ ok: true, data: { saved: 2, removed: 1, preserved: 1 } });
    expect((await 做(env, 'listReminders')).data.map(x => x.id).sort()).toEqual(['r-1', 'r-3', 'r-4']);
  });
  test('存好后把这批提醒交给发提醒排计划（环境给了 排提醒 才交；原来上海推给美国）', async () => {
    const 排了 = [];
    const env = { ...环境(), 排提醒: 提醒们 => 排了.push(提醒们.map(r => r.id)) };
    await 做(env, 'mergeReminders', { records: [提醒('r-1')] });
    await 做(env, 'replaceReminderEvent', { editionId: 'ed-math-2026', eventType: 'registration_end', records: [提醒('r-2')] });
    expect(排了).toEqual([['r-1'], ['r-2']]);
    expect((await 做(环境(), 'mergeReminders', { records: [提醒('r-1')] })).ok).toBe(true);
  });
  test('删一条、删一届的全部', async () => {
    const env = 环境();
    await 做(env, 'mergeReminders', { records: [提醒('r-1'), 提醒('r-2', { advanceKey: '3d', advanceLabel: '提前 3 天', remindAt: '2026-09-07T15:59:59.000Z' })] });
    expect(await 做(env, 'removeReminder', { id: 'r-1' })).toEqual({ ok: true, data: { removed: 1 } });
    expect(await 做(env, 'removeRemindersForEdition', { editionId: 'ed-math-2026' })).toEqual({ ok: true, data: { removed: 1 } });
    expect((await 做(env, 'listReminders')).data).toEqual([]);
  });
});

describe('偏好', () => {
  test('没填过是 null；保存后读回来；不在名单里的值丢掉', async () => {
    const env = 环境();
    expect(await 做(env, 'getPreferences')).toEqual({ ok: true, data: null });
    const 存 = await 做(env, 'savePreferences', { preferences: { profession: '计算机与AI', categories: ['不存在的大类'], province: '浙江省', surveyStatus: 'completed' } });
    expect(存.data).toMatchObject({ profession: '计算机与AI', categories: [], province: '浙江省', surveyStatus: 'completed', dontShowAgain: false });
    expect((await 做(env, 'getPreferences')).data).toMatchObject({ profession: '计算机与AI', province: '浙江省' });
  });
});

describe('纠错', () => {
  const 纠错 = { editionId: 'ed-math-2026', competitionName: '全国大学生数学建模竞赛', category: 'time', content: '报名截止应为 9 月 12 日', evidenceUrl: 'https://www.mcm.edu.cn/n' };
  test('提交：待 AI 审核；列出时只给用户看自己交的和处理状态', async () => {
    const env = 环境();
    const r = await 做(env, 'submitFeedback', 纠错);
    expect(r).toMatchObject({ ok: true, data: { status: 'pending_ai_review', createdAt: NOW.toISOString() } });
    const [给用户看] = (await 做(env, 'listFeedback')).data;
    expect(给用户看).toEqual({ id: r.data.id, editionId: 'ed-math-2026', competitionName: '全国大学生数学建模竞赛', category: 'time', content: '报名截止应为 9 月 12 日',
      evidenceUrl: 'https://www.mcm.edu.cn/n', status: 'pending_ai_review', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), resolvedAt: null });
    expect(await 做(env, 'submitFeedback', { ...纠错, category: '乱写' })).toEqual({ ok: false, message: 'invalid_category' });
  });
  test('每人 24 小时最多 20 条（feedback_rate_limit_exceeded）；过了 24 小时又能交', async () => {
    const env = 环境();
    for (let i = 0; i < 20; i += 1) expect((await 做(env, 'submitFeedback', 纠错)).ok).toBe(true);
    expect(await 做(env, 'submitFeedback', 纠错)).toEqual({ ok: false, message: 'feedback_rate_limit_exceeded' });
    const 第二天 = new Date(NOW.getTime() + 24 * 3600 * 1000);
    expect((await 做({ ...env, now: () => 第二天 }, 'submitFeedback', 纠错)).ok).toBe(true);
  });
});

describe('意见反馈', () => {
  test('提交、列出（分页）：交回和上海一样的格式，内部备注不给用户看', async () => {
    const env = 环境();
    const r = await 做(env, 'submitGeneralFeedback', { type: 'suggestion', content: '希望能按省份筛', contact: '', appVersion: '1.1.2' });
    expect(r.data.feedback).toMatchObject({ type: 'suggestion', content: '希望能按省份筛', contact: '', status: 'pending', publicReply: '', createdAt: NOW.toISOString(), resolvedAt: null });
    expect(r.data.feedback).not.toHaveProperty('internalNote');
    expect((await 做(env, 'listGeneralFeedback', { page: 1, pageSize: 20 })).data).toMatchObject({ total: 1, hasMore: false, items: [{ id: r.data.feedback.id }] });
    expect(await 做(env, 'submitGeneralFeedback', { type: 'praise', content: 'x' })).toEqual({ ok: false, message: 'invalid_feedback_type' });
  });
});

// 昵称头像（2026-11-09）：组队里给队友看。头像只存网址、只收 https（小程序上传图片存哪以后定，先存微信给的头像地址或我们以后的图片地址）
describe('昵称和头像', () => {
  test('没填过是空的；保存后读回来；空的清掉', async () => {
    const env = 环境();
    expect((await 做(env, 'getProfile')).data).toEqual({ nickname: '', avatarUrl: '' });
    expect((await 做(env, 'saveProfile', { nickname: ' 小黄 ', avatarUrl: 'https://thirdwx.qlogo.cn/mmopen/a/132' })).data)
      .toEqual({ nickname: '小黄', avatarUrl: 'https://thirdwx.qlogo.cn/mmopen/a/132' });
    expect((await 做(env, 'getProfile')).data).toEqual({ nickname: '小黄', avatarUrl: 'https://thirdwx.qlogo.cn/mmopen/a/132' });
    expect((await 做(env, 'saveProfile', { nickname: '', avatarUrl: '' })).data).toEqual({ nickname: '', avatarUrl: '' });
  });
  test('只改给了的那一项；昵称最多 30 字；头像只收 https、最长 500', async () => {
    const env = 环境();
    await 做(env, 'saveProfile', { nickname: '小黄', avatarUrl: 'https://a.cn/1.png' });
    expect((await 做(env, 'saveProfile', { nickname: '老黄' })).data).toEqual({ nickname: '老黄', avatarUrl: 'https://a.cn/1.png' });
    expect((await 做(env, 'saveProfile', { avatarUrl: 'https://a.cn/2.png' })).data).toEqual({ nickname: '老黄', avatarUrl: 'https://a.cn/2.png' });
    expect((await 做(env, 'saveProfile', { nickname: '名'.repeat(31) })).message).toBe('invalid_nickname');
    expect((await 做(env, 'saveProfile', { nickname: 123 })).message).toBe('invalid_nickname');
    for (const avatarUrl of ['http://a.cn/1.png', 'wxfile://tmp/1.png', 'javascript:alert(1)', `https://a.cn/${'x'.repeat(500)}`, 7]) {
      expect((await 做(env, 'saveProfile', { avatarUrl })).message, String(avatarUrl).slice(0, 30)).toBe('invalid_avatar_url');
    }
    expect((await 做(env, 'saveProfile', {})).message).toBe('invalid_profile');
    expect((await 做(env, 'getProfile')).data).toEqual({ nickname: '老黄', avatarUrl: 'https://a.cn/2.png' });
  });
});

test('微信明确拦截昵称时保留已有昵称', async () => {
  const env = 环境();
  await 做(env, 'saveProfile', { nickname: '原昵称' });
  const 微信 = { msgSecCheck: async () => ({ result: { suggest: 'risky' } }) };
  expect(await 做({ ...env, 微信 }, 'saveProfile', { nickname: '新昵称' })).toEqual({ ok: false, message: 'content_not_allowed' });
  expect((await 做(env, 'getProfile')).data.nickname).toBe('原昵称');
});
