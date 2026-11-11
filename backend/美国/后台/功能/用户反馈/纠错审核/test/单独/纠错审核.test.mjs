// 纠错审核：用户报的比赛信息错误。列表读美国的用户副本，连上比赛库里对应的届次；采纳、驳回经 环境.回传 写回北京正本（沟通/审核结果回传），
// 采纳的把那一届转回待人工审核（照旧后台 OperationModules.tsx），驳回只留后台记录；说明记在比赛库的后台记录里（2026-11-02）。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../../../../db/test/复用/样例数据.mjs';
import { 用户副本 } from '../../../../../../db/index.mjs';
import { 取 } from '../../数据库.mjs';
import { 整理 } from '../../整理.mjs';

const NOW = new Date('2026-11-02T04:00:00.000Z');
const 条 = (id, 改 = {}) => ({ id, user_id: 'user-abcdef123456', edition_id: 'ed-math-2026', competition_name: '数学建模', category: 'time', content: `截止日期错了 ${id}`,
  evidence_url: null, status: 'pending_ai_review', created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z', resolved_at: null, ...改 });

function 准备() {
  const db = open(); seed(db);
  const 副本库 = 用户副本.open({ file: ':memory:' });
  用户副本.写(副本库, [条('f1'), 条('f2', { edition_id: 'ed-没有了', status: 'accepted', created_at: '2026-11-01T05:00:00.000Z' })].map(x => ({ 表: 'feedback', 编号: x.id, data: x })));
  const 传了 = [];
  const 回传 = async 参数 => {
    传了.push(参数);
    const 行 = { ...用户副本.一条(副本库, 'feedback', 参数.编号), ...参数.改动, updated_at: NOW.toISOString() };
    用户副本.写(副本库, [{ 表: 'feedback', 编号: 行.id, data: 行 }]);
    return 行;
  };
  return { db, 传了, 环境: { db, 用户副本库: 副本库, 回传, now: () => NOW } };
}

describe('纠错审核', () => {
  test('取：列出纠错，连上比赛库里的届次（名称、现在的状态）；届次不在了也照样列出', async () => {
    const t = 准备();
    const 原始 = await 取({}, t.环境);
    expect(原始.接好了).toBe(true);
    expect(原始.条目们.find(x => x.id === 'f1')).toMatchObject({ 届次: { id: 'ed-math-2026', 名称: '2026 年数学建模', 状态: '已发布' } });
    expect(原始.条目们.find(x => x.id === 'f2').届次).toBeNull();
    expect(await 取({}, { db: t.db })).toMatchObject({ 接好了: false });
  });
  test('采纳：北京改成 accepted；那一届转待人工审核，理由写明这条纠错；留“采纳纠错”记录', async () => {
    const t = 准备();
    const 原始 = await 取({ 动作: '采纳', 编号: 'f1', 说明: '核过官网', 读到的更新时间: '2026-11-01T00:00:00.000Z' }, t.环境);
    expect(t.传了).toEqual([{ 种类: '纠错', 编号: 'f1', 改动: { status: 'accepted' }, 读到的更新时间: '2026-11-01T00:00:00.000Z' }]);
    expect(t.db.get('edition', 'ed-math-2026').data).toMatchObject({ status: '待人工审核' });
    expect(t.db.get('edition', 'ed-math-2026').data.status_reason.at(-1)).toMatch('用户纠错已采纳（f1，时间错误）');
    expect(t.db.find('audit_log', { action: '采纳纠错' })[0]).toMatchObject({ record_id: 'f1', detail: { 说明: '核过官网' } });
    expect(原始.条目们.find(x => x.id === 'f1')).toMatchObject({ status: 'accepted', 届次: { 状态: '待人工审核' } });
    expect(原始.结果).toMatch('已采纳');
  });
  test('驳回：北京改成 rejected，届次不动，留“驳回纠错”记录；驳回要写原因', async () => {
    const t = 准备();
    await expect(取({ 动作: '驳回', 编号: 'f1', 说明: ' ', 读到的更新时间: 'x' }, t.环境)).rejects.toThrow('写明驳回的原因');
    await 取({ 动作: '驳回', 编号: 'f1', 说明: '官网就是这么写的', 读到的更新时间: '2026-11-01T00:00:00.000Z' }, t.环境);
    expect(t.传了.at(-1).改动).toEqual({ status: 'rejected' });
    expect(t.db.get('edition', 'ed-math-2026').data.status).toBe('已发布');
    expect(t.db.find('audit_log', { action: '驳回纠错' })[0]).toMatchObject({ record_id: 'f1', detail: { 说明: '官网就是这么写的' } });
  });
  test('采纳的届次已经不在比赛库：北京照样改成已采纳，提示没转审核；找不到的纠错报错', async () => {
    const t = 准备();
    const 原始 = await 取({ 动作: '采纳', 编号: 'f2', 读到的更新时间: '2026-11-01T00:00:00.000Z' }, t.环境);
    expect(原始.结果).toMatch('届次已不在比赛库');
    await expect(取({ 动作: '采纳', 编号: 'f-没有', 读到的更新时间: 'x' }, t.环境)).rejects.toThrow('找不到这条纠错');
  });
  test('整理：新的在前；按视图筛（待处理、已处理）；中文标签', () => {
    const 原始 = { 接好了: true, 条目们: [{ ...条('f1'), 届次: null }, { ...条('f2', { status: 'accepted', created_at: '2026-11-01T05:00:00.000Z' }), 届次: null }] };
    const 全部 = 整理(原始, {});
    expect(全部.条目们.map(x => x.id)).toEqual(['f2', 'f1']);
    expect(全部.条目们[1]).toMatchObject({ 类别: '时间错误', 状态: '待AI审核', 能处理: true });
    expect(全部.条目们[0]).toMatchObject({ 状态: '已采纳', 能处理: false });
    expect(全部.数量).toEqual({ 全部: 2, 待处理: 1, 已处理: 1 });
    expect(整理(原始, { 视图: '待处理' }).条目们.map(x => x.id)).toEqual(['f1']);
  });
});
