// 后台 · 回收站：删除（在比赛管理里点）只打标记（比赛连同届次），别处看不到、只在回收站列出；30 天内一键恢复；每天清理超过 30 天的，真删并留操作日志。
// 回收站只管列出、恢复、到期清理；删除、恢复、彻底删除都调比赛库的函数（比赛.*、届次.*）。用内存里的比赛库。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../../../db/test/复用/样例数据.mjs';
import { 届次 } from '../../../../../db/index.mjs';
import { 处理后台请求 } from '../../../../接口.mjs';
import { 清理到期 } from '../../数据库.mjs';
import { 整理 } from '../../整理.mjs';

const 环境 = (db, 时间, 操作人 = '管理员甲') => ({ db, 操作人, now: () => new Date(时间) });
const 回收站 = (db, 参数, 时间 = '2026-10-01T00:00:00.000Z', 操作人) => 处理后台请求('回收站', 参数, 环境(db, 时间, 操作人));
// 删除在比赛管理里点
const 删 = (db, 参数, 时间 = '2026-10-01T00:00:00.000Z', 操作人) => 处理后台请求('比赛管理', 参数, 环境(db, 时间, 操作人));
const 日志 = (db, action) => db.find('audit_log', { action }, { orderBy: 'created_at' });

function 准备() {
  const db = open(); seed(db);
  db.transaction(tx => {
    tx.insert('competition', 'event-math-sd', { name: '数学建模山东赛区', level: '省级/区域级', parent_id: 'event-math' });
    tx.insert('source', 'src-1', { edition_id: 'ed-math-2025', url: 'https://a.cn/1', source_type: 'organizer_website' });
    tx.insert('source', 'src-2', { edition_id: 'ed-math-2026', url: 'https://a.cn/2', source_type: 'organizer_website' });
    tx.insert('process_log', 'log-1', { edition_id: 'ed-math-2026', kind: 'ai_review', at: '2026-09-01T00:00:00.000Z', detail: { 结论: '通过' } });
  });
  return db;
}

describe('删除', () => {
  test('删除比赛：比赛和它的届次一起标删除，别处都看不到，回收站里列出来，记操作日志', async () => {
    const db = 准备();
    const 回 = await 删(db, { 动作: '删除比赛', 编号: 'event-math' });
    expect(回.结果).toEqual({ 动作: '删除比赛', 编号: 'event-math', 名称: '全国大学生数学建模竞赛', 届次: 2 });
    expect(db.get('competition', 'event-math')).toBeNull();
    expect(届次.search(db, {}).map(r => r.competition.id)).toEqual(['event-art', 'event-art']);
    const 列表 = await 回收站(db, {}, '2026-10-11T00:00:00.000Z');
    expect(列表.比赛们).toEqual([{ id: 'event-math', name: '全国大学生数学建模竞赛', 届次数: 2, deleted_at: '2026-10-01T00:00:00.000Z', deleted_by: '管理员甲', 还剩天数: 20 }]);
    expect(日志(db, '标记删除比赛')[0]).toMatchObject({ table_name: 'competition', record_id: 'event-math', detail: { 名称: '全国大学生数学建模竞赛', 届次: 2, 操作人: '管理员甲' } });
  });
  test('删除届次：只标这一届；回收站里单独列出', async () => {
    const db = 准备();
    await 删(db, { 动作: '删除届次', 编号: 'ed-math-2025' });
    expect(db.get('edition', 'ed-math-2025')).toBeNull();
    expect(db.get('competition', 'event-math')).not.toBeNull();
    expect((await 回收站(db, {}, '2026-10-02T00:00:00.000Z')).届次们.map(e => [e.id, e.还剩天数])).toEqual([['ed-math-2025', 29]]);
    expect(日志(db, '标记删除届次')).toHaveLength(1);
  });
  test('删不存在的、已经删过的：报“找不到”；不认识的动作拒绝', async () => {
    const db = 准备();
    await expect(删(db, { 动作: '删除比赛', 编号: 'event-none' })).rejects.toMatchObject({ kind: '找不到' });
    await 删(db, { 动作: '删除比赛', 编号: 'event-art' });
    await expect(删(db, { 动作: '删除比赛', 编号: 'event-art' })).rejects.toMatchObject({ kind: '找不到' });
    await expect(回收站(db, { 动作: '清空' })).rejects.toThrow('不认识的动作');
    await expect(回收站(db, { 动作: '删除比赛', 编号: 'event-math' })).rejects.toThrow('不认识的动作');   // 删除只在比赛管理里
  });
  test('勾了“以后不再收录”：记进不收录名单（名称、别名、官网）', async () => {
    const db = 准备();
    await 删(db, { 动作: '删除比赛', 编号: 'event-math', 不再收录: true, 理由: '不是大学生比赛' });
    expect(db.find('blocked_competition', {})).toEqual([expect.objectContaining({ name: '全国大学生数学建模竞赛', aliases: ['国赛数模'], competition_id: 'event-math', reason: '不是大学生比赛', created_by: '管理员甲' })]);
  });
});

describe('恢复', () => {
  test('恢复比赛：比赛和跟它一起删的届次回来；之前单独删的届次仍在回收站；不收录名单里的去掉；记操作日志', async () => {
    const db = 准备();
    await 删(db, { 动作: '删除届次', 编号: 'ed-math-2025' }, '2026-09-20T00:00:00.000Z', '管理员乙');
    await 删(db, { 动作: '删除比赛', 编号: 'event-math', 不再收录: true });
    await 回收站(db, { 动作: '恢复比赛', 编号: 'event-math' }, '2026-10-05T00:00:00.000Z');
    expect(db.get('competition', 'event-math').data.deleted_at).toBeNull();
    expect(db.get('edition', 'ed-math-2026').data.deleted_by).toBeNull();
    expect(db.get('edition', 'ed-math-2025')).toBeNull();
    expect(db.count('blocked_competition')).toBe(0);
    expect(日志(db, '恢复比赛')[0].detail).toMatchObject({ 名称: '全国大学生数学建模竞赛', 届次: 1, 操作人: '管理员甲' });
  });
  test('恢复届次：比赛还在回收站时不能单独恢复，要先恢复比赛', async () => {
    const db = 准备();
    await 删(db, { 动作: '删除届次', 编号: 'ed-math-2025' });
    await 回收站(db, { 动作: '恢复届次', 编号: 'ed-math-2025' });
    expect(db.get('edition', 'ed-math-2025')).not.toBeNull();
    await 删(db, { 动作: '删除比赛', 编号: 'event-art' });
    await expect(回收站(db, { 动作: '恢复届次', 编号: 'ed-art-2026' })).rejects.toThrow('先恢复比赛');
  });
  test('没删的不能恢复：报“找不到”', async () => {
    await expect(回收站(准备(), { 动作: '恢复比赛', 编号: 'event-math' })).rejects.toMatchObject({ kind: '找不到' });
  });
});

describe('每天清理', () => {
  test('超过 30 天的比赛真删：届次、来源、处理记录一起删，下级比赛断开上级，每删一个留一条操作日志', async () => {
    const db = 准备();
    await 删(db, { 动作: '删除比赛', 编号: 'event-math' });
    expect(清理到期(db, { now: () => new Date('2026-10-31T00:00:01.000Z') })).toMatchObject({ 比赛: 1, 届次: 0 });
    const 全部 = { 包括已删除: true };
    expect(db.get('competition', 'event-math', 全部)).toBeNull();
    expect(db.count('edition', { competition_id: 'event-math' }, 全部)).toBe(0);
    expect(db.count('source')).toBe(0);
    expect(db.count('process_log')).toBe(0);
    expect(db.get('competition', 'event-math-sd').data.parent_id).toBeNull();
    expect(日志(db, '回收站清理')[0]).toMatchObject({ table_name: 'competition', record_id: 'event-math',
      detail: { 名称: '全国大学生数学建模竞赛', 标记时间: '2026-10-01T00:00:00.000Z', 标记人: '管理员甲',
        连带: { edition: 2, source: 2, process_log: 1 }, 断开的下级比赛: ['event-math-sd'] } });
  });
  test('单独删的届次超过 30 天也真删；没到 30 天的、没删的都不动', async () => {
    const db = 准备();
    await 删(db, { 动作: '删除届次', 编号: 'ed-math-2025' });
    await 删(db, { 动作: '删除比赛', 编号: 'event-art' }, '2026-10-20T00:00:00.000Z');
    expect(清理到期(db, { now: () => new Date('2026-10-31T00:00:01.000Z') })).toMatchObject({ 比赛: 0, 届次: 1 });
    expect(db.get('edition', 'ed-math-2025', { 包括已删除: true })).toBeNull();
    expect(db.count('source')).toBe(1);
    expect(db.get('competition', 'event-art', { 包括已删除: true })).not.toBeNull();
    expect(日志(db, '回收站清理')).toHaveLength(1);
  });
  test('刚好 30 天整还不删（超过才删）；没东西可清时什么都不写', async () => {
    const db = 准备();
    await 删(db, { 动作: '删除比赛', 编号: 'event-math' });
    expect(清理到期(db, { now: () => new Date('2026-10-31T00:00:00.000Z') })).toMatchObject({ 比赛: 0, 届次: 0 });
    expect(日志(db, '回收站清理')).toHaveLength(0);
  });
});

describe('整理', () => {
  test('快到期的排前面；刚做完的动作给一句提示；空的时候总数为 0', () => {
    const 原始 = { 比赛们: [{ id: 'a', name: 'A', 还剩天数: 20 }, { id: 'b', name: 'B', 还剩天数: 3 }], 届次们: [{ id: 'e', 还剩天数: 10 }], 结果: { 动作: '恢复比赛', 编号: 'x', 届次: 2 } };
    const 数据 = 整理(原始);
    expect(数据.比赛们.map(c => c.id)).toEqual(['b', 'a']);
    expect(数据.总数).toBe(3);
    expect(数据.提示).toBe('已恢复比赛 x，连同 2 届');
    expect(整理({ 比赛们: [], 届次们: [] })).toMatchObject({ 总数: 0, 提示: '' });
  });
});
