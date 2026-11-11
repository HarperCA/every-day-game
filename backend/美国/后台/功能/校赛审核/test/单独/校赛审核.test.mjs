// 校赛审核（2026-11-08 用户定：校赛在美国审核通过才能在小程序发布）：管理员申请、校赛两块。
// 列表读美国的用户副本（北京同步来的 school_admin、school_contest）；审核经 环境.回传 写回北京正本（沟通/审核结果回传），
// 比赛库留一条后台记录（audit_log），照意见反馈、纠错审核的做法。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../../../db/test/复用/样例数据.mjs';
import { 用户副本 } from '../../../../../db/index.mjs';
import { 取 } from '../../数据库.mjs';
import { 整理 } from '../../整理.mjs';

const NOW = new Date('2026-11-08T04:00:00.000Z');
const 申请 = (id, 改 = {}) => ({ id, user: 'user-abcdef123456', school: '福州大学', real_name: '张老师', contact: '13800000000', proof: '团委老师，工号 123',
  status: '待审核', review_note: null, created_at: '2026-11-07T00:00:00.000Z', updated_at: '2026-11-07T00:00:00.000Z', version: 1, ...改 });
const 校赛 = (id, 改 = {}) => ({ id, school: '福州大学', admin: 'sa-1', title: `校赛 ${id}`, content: '简介', signup: '扫码报名', start_date: '2026-12-01', end_date: '2026-12-02',
  status: '待审核', review_note: null, created_at: '2026-11-07T00:00:00.000Z', updated_at: '2026-11-07T00:00:00.000Z', version: 1, ...改 });

function 准备({ 回传失败 = null } = {}) {
  const db = open(); seed(db);
  const 副本库 = 用户副本.open({ file: ':memory:' });
  用户副本.写(副本库, [
    ...[申请('sa-1'), 申请('sa-2', { status: '已通过', created_at: '2026-11-07T05:00:00.000Z' })].map(x => ({ 表: 'school_admin', 编号: x.id, data: x })),
    ...[校赛('sc-1'), 校赛('sc-2', { status: '已发布' })].map(x => ({ 表: 'school_contest', 编号: x.id, data: x })),
  ]);
  const 传了 = [];
  const 回传 = async 参数 => {
    传了.push(参数);
    if (回传失败) throw new Error(回传失败);
    const 表 = 参数.种类 === '校赛' ? 'school_contest' : 'school_admin';
    const 行 = { ...用户副本.一条(副本库, 表, 参数.编号), ...参数.改动, updated_at: NOW.toISOString() };
    用户副本.写(副本库, [{ 表, 编号: 行.id, data: 行 }]);   // 真的回传会写副本，这里照样
    return 行;
  };
  return { db, 副本库, 传了, 环境: { db, 用户副本库: 副本库, 回传, now: () => NOW } };
}

describe('校赛审核 · 取', () => {
  test('列出用户副本里的管理员申请和校赛；没配用户副本时说明数据从哪来', async () => {
    const t = 准备();
    const 原始 = await 取({}, t.环境);
    expect(原始.接好了).toBe(true);
    expect(原始.申请们.map(x => x.id).sort()).toEqual(['sa-1', 'sa-2']);
    expect(原始.校赛们.map(x => x.id).sort()).toEqual(['sc-1', 'sc-2']);
    expect(await 取({}, {})).toMatchObject({ 接好了: false });
  });
  test('管理员申请通过：经回传改成已通过，留“审核校赛管理员”记录，交回新列表', async () => {
    const t = 准备();
    const 原始 = await 取({ 动作: '审核申请', 编号: 'sa-1', 决定: '通过', 说明: ' 核过工号 ', 读到的更新时间: '2026-11-07T00:00:00.000Z' }, t.环境);
    expect(t.传了).toEqual([{ 种类: '校赛管理员', 编号: 'sa-1', 改动: { status: '已通过', review_note: '核过工号' }, 读到的更新时间: '2026-11-07T00:00:00.000Z' }]);
    expect(原始.申请们.find(x => x.id === 'sa-1')).toMatchObject({ status: '已通过' });
    expect(原始.结果).toMatch('已通过');
    expect(t.db.find('audit_log', { action: '审核校赛管理员' })[0]).toMatchObject({ table_name: 'school_admin', record_id: 'sa-1', detail: { 学校: '福州大学', 姓名: '张老师', 结果: '已通过', 说明: '核过工号' } });
  });
  test('管理员申请拒绝要写说明；已处理过的不能再审；找不到的说清楚', async () => {
    const t = 准备();
    await expect(取({ 动作: '审核申请', 编号: 'sa-1', 决定: '拒绝', 说明: '  ', 读到的更新时间: 'x' }, t.环境)).rejects.toThrow('写明');
    await expect(取({ 动作: '审核申请', 编号: 'sa-2', 决定: '拒绝', 说明: '重复', 读到的更新时间: 'x' }, t.环境)).rejects.toThrow('不能');
    await expect(取({ 动作: '审核申请', 编号: 'sa-没有', 决定: '通过', 读到的更新时间: 'x' }, t.环境)).rejects.toThrow('找不到');
    expect(t.传了).toEqual([]);
    const 原始 = await 取({ 动作: '审核申请', 编号: 'sa-1', 决定: '拒绝', 说明: '证明不清楚', 读到的更新时间: '2026-11-07T00:00:00.000Z' }, t.环境);
    expect(原始.申请们.find(x => x.id === 'sa-1')).toMatchObject({ status: '已拒绝', review_note: '证明不清楚' });
  });
  test('校赛：待审核的通过→已发布、拒绝要写说明；已发布的才能下架，下架要写说明', async () => {
    const t = 准备();
    await 取({ 动作: '审核校赛', 编号: 'sc-1', 决定: '通过', 读到的更新时间: '2026-11-07T00:00:00.000Z' }, t.环境);
    expect(t.传了.at(-1)).toEqual({ 种类: '校赛', 编号: 'sc-1', 改动: { status: '已发布', review_note: '' }, 读到的更新时间: '2026-11-07T00:00:00.000Z' });
    await expect(取({ 动作: '审核校赛', 编号: 'sc-2', 决定: '下架', 说明: '', 读到的更新时间: 'x' }, t.环境)).rejects.toThrow('写明');
    await expect(取({ 动作: '审核校赛', 编号: 'sc-2', 决定: '通过', 读到的更新时间: 'x' }, t.环境)).rejects.toThrow('不能');
    const 原始 = await 取({ 动作: '审核校赛', 编号: 'sc-2', 决定: '下架', 说明: '报名已结束', 读到的更新时间: '2026-11-07T00:00:00.000Z' }, t.环境);
    expect(原始.校赛们.find(x => x.id === 'sc-2')).toMatchObject({ status: '已下架', review_note: '报名已结束' });
    expect(t.db.find('audit_log', { action: '审核校赛' }).map(x => x.detail.结果).sort()).toEqual(['已下架', '已发布']);
  });
  test('北京报冲突、北京还没上线校赛审核：换成中文说明，不留记录', async () => {
    const u = 准备({ 回传失败: 'feedback_conflict' });
    await expect(取({ 动作: '审核校赛', 编号: 'sc-1', 决定: '通过', 读到的更新时间: 'x' }, u.环境)).rejects.toThrow('其他管理员');
    expect(u.db.find('audit_log', { action: '审核校赛' })).toEqual([]);
    const v = 准备({ 回传失败: 'school_review_not_ready' });
    await expect(取({ 动作: '审核申请', 编号: 'sa-1', 决定: '通过', 读到的更新时间: 'x' }, v.环境)).rejects.toThrow('北京还没');
  });
});

describe('校赛审核 · 整理', () => {
  const 原始 = { 接好了: true,
    申请们: [申请('sa-1', { created_at: '2026-11-01T00:00:00.000Z' }), 申请('sa-2', { status: '已通过', created_at: '2026-11-07T05:00:00.000Z' }), 申请('sa-3', { created_at: '2026-11-06T00:00:00.000Z' })],
    校赛们: [校赛('sc-1', { status: '已发布' }), 校赛('sc-2'), 校赛('sc-3', { status: '已下架' })] };
  test('待审核在前，同一类里新的在前；数量；能做的操作按状态给；账号只露尾巴', () => {
    const 数据 = 整理(原始, {});
    expect(数据.申请们.map(x => x.id)).toEqual(['sa-3', 'sa-1', 'sa-2']);
    expect(数据.申请们[0]).toMatchObject({ 能做: ['通过', '拒绝'], 账号: '…123456' });
    expect(数据.申请们[2].能做).toEqual([]);
    expect(数据.校赛们.map(x => x.id)).toEqual(['sc-2', 'sc-1', 'sc-3']);
    expect(数据.校赛们.map(x => x.能做)).toEqual([['通过', '拒绝'], ['下架'], []]);
    expect(数据.数量).toEqual({ 申请: { 全部: 3, 待审核: 2 }, 校赛: { 全部: 3, 待审核: 1 } });
  });
  test('只看待审核', () => {
    const 数据 = 整理(原始, { 视图: '待审核' });
    expect(数据.申请们.map(x => x.id)).toEqual(['sa-3', 'sa-1']);
    expect(数据.校赛们.map(x => x.id)).toEqual(['sc-2']);
  });
  test('没接好时交回来源', () => expect(整理({ 接好了: false, 来源: 'x' })).toEqual({ 接好了: false, 来源: 'x' }));
});
