// 意见反馈：用户对小程序本身的意见。列表读美国的用户副本；处理结果（状态、公开回复、内部备注）经 环境.回传 写回北京正本（沟通/审核结果回传），
// 比赛库留一条“处理意见反馈”的后台记录。规则照旧后台 GeneralFeedbackModule.tsx + adminData/generalFeedback.js（2026-11-02）。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../../../../db/test/复用/样例数据.mjs';
import { 用户副本 } from '../../../../../../db/index.mjs';
import { 取 } from '../../数据库.mjs';
import { 整理 } from '../../整理.mjs';

const NOW = new Date('2026-11-02T04:00:00.000Z');
const 条 = (id, 改 = {}) => ({ id, user_id: 'user-abcdef123456', type: 'bug', content: `内容 ${id}`, contact: null, status: 'pending', public_reply: null, internal_note: null,
  created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z', resolved_at: null, ...改 });

function 准备({ 回传失败 = null } = {}) {
  const db = open(); seed(db);
  const 副本库 = 用户副本.open({ file: ':memory:' });
  用户副本.写(副本库, [条('g1'), 条('g2', { type: 'suggestion', status: 'resolved', public_reply: '好的', created_at: '2026-11-01T05:00:00.000Z' })].map(x => ({ 表: 'general_feedback', 编号: x.id, data: x })));
  const 传了 = [];
  const 回传 = async 参数 => {
    传了.push(参数);
    if (回传失败) throw new Error(回传失败);
    const 行 = { ...用户副本.一条(副本库, 'general_feedback', 参数.编号), ...参数.改动, updated_at: NOW.toISOString() };
    用户副本.写(副本库, [{ 表: 'general_feedback', 编号: 行.id, data: 行 }]);   // 真的回传会写副本，这里照样
    return 行;
  };
  return { db, 副本库, 传了, 环境: { db, 用户副本库: 副本库, 回传, now: () => NOW } };
}

describe('意见反馈', () => {
  test('取：列出用户副本里的意见反馈；没配用户副本时说明数据从哪来', async () => {
    const t = 准备();
    const 原始 = await 取({}, t.环境);
    expect(原始.接好了).toBe(true);
    expect(原始.条目们.map(x => x.id).sort()).toEqual(['g1', 'g2']);
    expect(await 取({}, {})).toMatchObject({ 接好了: false });
  });
  test('保存：经回传写回北京，比赛库留“处理意见反馈”记录，交回新的列表', async () => {
    const t = 准备();
    const 原始 = await 取({ 动作: '保存', 编号: 'g1', status: 'resolved', public_reply: ' 已修好 ', internal_note: '缓存', 读到的更新时间: '2026-11-01T00:00:00.000Z' }, t.环境);
    expect(t.传了).toEqual([{ 种类: '意见反馈', 编号: 'g1', 改动: { status: 'resolved', public_reply: '已修好', internal_note: '缓存' }, 读到的更新时间: '2026-11-01T00:00:00.000Z' }]);
    expect(原始.条目们.find(x => x.id === 'g1')).toMatchObject({ status: 'resolved', public_reply: '已修好' });
    expect(原始.结果).toMatch('已保存');
    expect(t.db.find('audit_log', { action: '处理意见反馈' })[0]).toMatchObject({ record_id: 'g1', detail: { 状态: '已解决' } });
  });
  test('保存：已解决没写公开回复，不发出去；北京报冲突，换成中文说明', async () => {
    const t = 准备();
    await expect(取({ 动作: '保存', 编号: 'g1', status: 'resolved', public_reply: '', 读到的更新时间: 'x' }, t.环境)).rejects.toThrow('请填写具体的公开回复');
    expect(t.传了).toEqual([]);
    const u = 准备({ 回传失败: 'feedback_conflict' });
    await expect(取({ 动作: '保存', 编号: 'g1', status: 'processing', 读到的更新时间: 'x' }, u.环境)).rejects.toThrow('已被其他管理员修改');
    expect(u.db.find('audit_log', { action: '处理意见反馈' })).toEqual([]);
  });
  test('整理：新的在前；按状态、类型筛；中文标签；账号只露尾巴', () => {
    const 原始 = { 接好了: true, 条目们: [条('g1'), 条('g2', { type: 'suggestion', status: 'resolved', created_at: '2026-11-01T05:00:00.000Z' })] };
    const 全部 = 整理(原始, {});
    expect(全部.条目们.map(x => x.id)).toEqual(['g2', 'g1']);
    expect(全部.条目们[1]).toMatchObject({ 类型: '功能异常', 状态: '待处理', 账号: '…123456' });
    expect(全部.数量).toEqual({ 全部: 2, pending: 1, processing: 0, resolved: 1 });
    expect(整理(原始, { 状态: 'resolved' }).条目们.map(x => x.id)).toEqual(['g2']);
    expect(整理(原始, { 类型: 'bug' }).条目们.map(x => x.id)).toEqual(['g1']);
  });
});
