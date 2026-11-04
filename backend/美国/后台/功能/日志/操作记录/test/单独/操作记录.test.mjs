// 后台 · 操作记录：读比赛库的后台记录表 audit_log，只看不改（2026-11-01 用户定）。
// 新到旧，每页 50 条；按类型（后台编辑、删除和恢复、自动维护）筛选，按名称或编号搜；每条用中文写清楚做了什么。用内存里的比赛库。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../../../../db/test/复用/样例数据.mjs';
import { 届次, 比赛 } from '../../../../../../db/index.mjs';
import { 处理后台请求 } from '../../../../../接口.mjs';
import { 每页, 类型们 } from '../../数据库.mjs';
import { 整理 } from '../../整理.mjs';

const 读 = (db, 参数 = {}) => 处理后台请求('操作记录', 参数, { db });
const 记 = (db, id, created_at, action, table_name, record_id, detail) =>
  db.transaction(tx => tx.insert('audit_log', id, { created_at, action, table_name, record_id, detail }));

function 准备() {
  const db = open(); seed(db);
  记(db, 'a1', '2026-10-01T01:00:00.000Z', '编辑比赛', 'competition', 'event-math', { 名称: '全国大学生数学建模竞赛', 改了: ['name', 'organizer'], 操作人: '管理员甲' });
  记(db, 'a2', '2026-10-02T01:00:00.000Z', '改状态', 'edition', 'ed-math-2026', { 名称: '2026 年全国大学生数学建模竞赛', 从: '待人工审核', 改成: '已发布', 操作人: '管理员乙' });
  记(db, 'a3', '2026-10-03T01:00:00.000Z', '标记删除比赛', 'competition', 'event-art', { 名称: '全国大学生艺术展演', 届次: 2, 操作人: '管理员甲', 不再收录: true, 理由: '不是学科竞赛' });
  记(db, 'a4', '2026-10-04T01:00:00.000Z', '回收站清理', 'competition', 'event-old', { 名称: '旧比赛', 标记时间: '2026-09-01T00:00:00.000Z', 标记人: '管理员甲', 连带: { edition: 2, source: 3 } });
  记(db, 'a5', '2026-10-05T01:00:00.000Z', '维护比赛', 'competition', 'event-math', { 检查完成: ['状态', '缺失字段', '新一届'], 检查失败: [{ name: '链接', error: '还没实现' }, { name: '核对原文', error: '还没实现' }], 改正: 1, 转人工: 0, 留着: 0 });
  记(db, 'a6', '2026-10-05T01:00:01.000Z', '维护改正', 'edition', 'ed-math-2026', { 检查项: '状态', 字段: 'status', 原值: '已发布', 新值: { status: '已归档' }, 依据: '报名已截止' });
  return db;
}

describe('取数据', () => {
  test('新到旧，交回总数、页码；没有记录时是空的', async () => {
    expect(await 读(open())).toMatchObject({ 条目: [], 总数: 0, 页: 1, 每页 });
    const r = await 读(准备());
    expect(r.条目.map(x => x.id)).toEqual(['a6', 'a5', 'a4', 'a3', 'a2', 'a1']);
    expect(r).toMatchObject({ 总数: 6, 页: 1, 类型: '全部', 搜: '' });
  });
  test('每页 50 条，翻页', async () => {
    const db = open();
    for (let i = 0; i < 55; i += 1) 记(db, `m${String(i).padStart(2, '0')}`, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), '维护比赛', 'competition', 'event-math', {});
    const 第一页 = await 读(db);
    expect(第一页.条目).toHaveLength(50);
    expect(第一页.条目[0].id).toBe('m54');
    const 第二页 = await 读(db, { 页: 2 });
    expect(第二页.条目.map(x => x.id)).toEqual(['m04', 'm03', 'm02', 'm01', 'm00']);
    expect(第二页).toMatchObject({ 总数: 55, 页: 2 });
  });
  test('按类型筛：后台编辑、删除和恢复、自动维护', async () => {
    expect(类型们.map(t => t.名称)).toEqual(['全部', '后台编辑', '删除和恢复', '自动维护']);
    const db = 准备();
    expect((await 读(db, { 类型: '后台编辑' })).条目.map(x => x.id)).toEqual(['a2', 'a1']);
    expect((await 读(db, { 类型: '删除和恢复' })).条目.map(x => x.id)).toEqual(['a4', 'a3']);
    expect((await 读(db, { 类型: '自动维护' })).条目.map(x => x.id)).toEqual(['a6', 'a5']);
    await expect(读(db, { 类型: '乱写' })).rejects.toThrow(/类型/);
  });
  test('按名称或编号搜（和类型可以一起用）', async () => {
    const db = 准备();
    expect((await 读(db, { 搜: '数学建模' })).条目.map(x => x.id)).toEqual(['a2', 'a1']);
    expect((await 读(db, { 搜: 'ed-math-2026' })).条目.map(x => x.id)).toEqual(['a6', 'a2']);
    expect((await 读(db, { 搜: 'event-math', 类型: '自动维护' })).条目.map(x => x.id)).toEqual(['a5']);
  });
  test('真实操作写下的记录也能读到（比赛库的函数写的格式）', async () => {
    const db = open(); seed(db);
    const 原 = db.get('edition', 'ed-math-2026');
    届次.改状态(db, 'ed-math-2026', 原.data.status === '已发布' ? '已归档' : '已发布', 原.version, { 操作人: '管理员丙', at: '2026-10-09T00:00:00.000Z' });
    比赛.删除(db, 'event-art', { 操作人: '管理员丙', at: '2026-10-10T00:00:00.000Z' });
    const 行们 = 整理(await 读(db)).行们;
    expect(行们.map(r => [r.动作, r.操作人])).toEqual([['标记删除比赛', '管理员丙'], ['改状态', '管理员丙']]);
  });
});

describe('整理：每条写清楚', () => {
  test('时间按北京时间；对象写名称和是比赛还是届次；维护和清理的操作人是“系统”', async () => {
    const 行们 = 整理(await 读(准备())).行们;
    const 按 = Object.fromEntries(行们.map(r => [r.id, r]));
    expect(按.a1).toMatchObject({ 时间: '2026-10-01 09:00', 动作: '编辑比赛', 对象: '全国大学生数学建模竞赛', 对象类: '比赛', 编号: 'event-math', 操作人: '管理员甲' });
    expect(按.a2).toMatchObject({ 对象类: '届次', 操作人: '管理员乙' });
    expect(按.a4.操作人).toBe('系统');
    expect(按.a5).toMatchObject({ 操作人: '系统', 对象: '全国大学生数学建模竞赛', 编号: 'event-math' });
    // 记录里没写名称的（维护），按编号到比赛库查；查不到就写编号
    expect(按.a4).toMatchObject({ 对象: '旧比赛', 编号: 'event-old' });
  });
  test('详情：改了哪些字段用中文名；状态从哪到哪；删除连带几届、是否不再收录；清理连带了什么；维护的结果和改正', async () => {
    const 按 = Object.fromEntries(整理(await 读(准备())).行们.map(r => [r.id, r.详情]));
    expect(按.a1).toEqual(['改了：比赛名称、主办方']);
    expect(按.a2).toEqual(['状态：待人工审核 → 已发布']);
    expect(按.a3).toEqual(['连同 2 届', '以后不再收录：不是学科竞赛']);
    expect(按.a4).toEqual(['2026-09-01 08:00 由 管理员甲 删除', '连带删除：届次 2、来源 3']);
    expect(按.a5).toEqual(['检查完成 3 项、失败 2 项（链接、核对原文）', '改正 1 处、转人工 0 处']);
    expect(按.a6).toEqual(['状态（status）：已发布 → 已归档', '依据：报名已截止']);
  });
  test('没见过的动作：把内容原样列出来，不丢', () => {
    const r = 整理({ 条目: [{ id: 'x', created_at: '2026-10-01T00:00:00.000Z', action: '以后的新动作', table_name: null, record_id: null, detail: { 甲: 1, 乙: '二' } }], 总数: 1, 页: 1, 每页, 类型: '全部', 搜: '', 字段名: {} });
    expect(r.行们[0]).toMatchObject({ 动作: '以后的新动作', 对象: '', 详情: ['甲：1', '乙：二'] });
  });
  test('翻页信息：共几页、有没有上一页下一页', () => {
    const 空 = { 条目: [], 每页, 类型: '全部', 搜: '', 字段名: {} };
    expect(整理({ ...空, 总数: 120, 页: 2 })).toMatchObject({ 共几页: 3, 有上一页: true, 有下一页: true });
    expect(整理({ ...空, 总数: 0, 页: 1 })).toMatchObject({ 共几页: 1, 有上一页: false, 有下一页: false });
  });
});
