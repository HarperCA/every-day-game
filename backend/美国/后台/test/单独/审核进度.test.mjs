import { afterEach, expect, test } from 'vitest';
import { open, seed } from '../../../db/test/复用/样例数据.mjs';
import { 维护队列, 审核进度 } from '../../../db/index.mjs';
import { 批量维护 } from '../../../db/维护/批量.mjs';
import { 建服务 } from '../../建服务.mjs';

const now = () => new Date('2026-11-11T08:00:00Z');
const log = { info() {}, warn() {}, error() {}, child() { return log; } };
const 口令 = 'review-progress-test-password-123456789';
let db;
let server;
afterEach(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  db?.close();
  server = db = null;
});

async function 启动() {
  db = open();
  seed(db);
  server = 建服务({ 口令, 环境: () => ({ db, now }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const 地址 = 'http://127.0.0.1:' + server.address().port;
  const 请求 = (路径, 数据, cookie) => fetch(地址 + encodeURI(路径), {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(数据),
  });
  const 登录 = await 请求('/api/登录', { 口令 });
  const cookie = 登录.headers.get('set-cookie').split(';')[0];
  const 总览 = async (参数 = {}) => {
    const 回 = await 请求('/api/后台/总览', { 动作: '审核进度', ...参数 }, cookie);
    expect(回.status).toBe(200);
    return (await 回.json()).数据;
  };
  return { 请求, 总览, cookie };
}

test('由比赛管理入队，经真实审核入口上报当前届次和搜索轮次，完成后仍可按编号读取', async () => {
  const { 请求, 总览, cookie } = await 启动();
  expect((await 请求('/api/后台/总览', { 动作: '审核进度' })).status).toBe(401);
  const 入队 = await 请求('/api/后台/比赛管理', { 动作: '启动AI维护', 编号们: ['event-math'] }, cookie);
  expect(入队.status).toBe(200);
  expect((await 总览()).排队).toMatchObject([{ 比赛编号: 'event-math', 状态: '排队中', 排位: 1 }]);
  const 等AI = Promise.withResolvers();
  const 到了 = Promise.withResolvers();
  const ai = { async chat() {
    到了.resolve();
    await 等AI.promise;
    return { data: { 结论: '查不到', 理由: '无官方材料', 来源性质: '判断不了', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [] } };
  } };
  const 运行 = 批量维护({ db, ai, web: { async 读网页() { return {}; } }, log, now, 只队列: true });
  try {
    await Promise.race([到了.promise, 运行.then(() => { throw new Error('未进入 AI 审核'); })]);
    const 当前 = await 总览();
    expect(当前.正在).toMatchObject({ 比赛编号: 'event-math', 名称: '全国大学生数学建模竞赛', 来源: '手动', 状态: '审核中' });
    expect(当前.正在.步骤们.at(-1)).toMatchObject({ 阶段: '搜索官方资料', 届次: '2025 年数学建模', 轮次: 1, 最多轮次: 3 });
    expect(当前.正在).not.toHaveProperty('进程');
    expect(当前.排队).toEqual([]);
    expect((await 总览({ 比赛编号: 'event-math' })).比赛).toEqual(当前.正在);
  } finally { 等AI.resolve(); await 运行; }

  const 完成 = await 总览({ 比赛编号: 'event-math' });
  expect(完成.比赛.状态).toBe('审核完成');
  const 阶段们 = 完成.比赛.步骤们.map(x => x.阶段);
  expect(阶段们.slice(0, 4)).toEqual(['准备审核', '搜索官方资料', '读取官方原文', '核对原文']);
  expect(阶段们.slice(-2)).toEqual(['处理审核结果', '保存审核结果']);
  expect((await 总览()).正在).toBeNull();
});

test('额度用尽时保留排队、显示重试时间，试跑不会覆盖进度', async () => {
  const { 总览 } = await 启动();
  维护队列.加入(db, ['event-math', 'event-art']);
  const ai = { async chat() { throw Object.assign(new Error('额度不足'), { kind: '额度用完' }); } };
  await 批量维护({ db, ai, log, now, 只队列: true });
  const 暂停 = await 总览();
  expect(暂停).toMatchObject({
    正在: null, 暂停到: '2026-11-11T10:00:00.000Z',
    排队: [{ 比赛编号: 'event-math', 状态: '等待重试' }, { 比赛编号: 'event-art', 状态: '等待重试' }],
    最近: [{ 比赛编号: 'event-math', 状态: '等待重试' }],
  });
  await 批量维护({ db, ai, log, now, 上限: 1, dryRun: true });
  expect(await 总览()).toEqual(暂停);
});

test('过期的进程不显示为正在审核，过时的任务回调不会覆盖新任务', async () => {
  await 启动();
  const 过时 = 审核进度.开始(db, 'event-math', { now });
  const 活动 = 审核进度.开始(db, 'event-art', { now });
  过时.更新('读取官方原文');
  过时.结束('审核完成');
  expect(审核进度.读(db).正在.比赛编号).toBe('event-art');
  const row = db.get('admin_state', 'ai_review_progress');
  db.update('admin_state', 'ai_review_progress', { data: { 正在: { ...row.data.data.正在, 进程: 2147483647 } } }, row.version);
  expect(审核进度.读(db)).toMatchObject({ 正在: null, 最近: [{ 比赛编号: 'event-art', 状态: '审核中断' }] });
  活动.结束('审核失败');
});
