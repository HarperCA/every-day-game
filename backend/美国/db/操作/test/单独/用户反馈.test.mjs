// 用户反馈在比赛库这边要留的东西（2026-11-02）：纠错、意见反馈的正本在北京，处理结果经 沟通/审核结果回传 写回北京；
// 比赛库这边记后台操作记录（谁、什么时候、怎么处理、说明），采纳的纠错把那一届转回待人工审核（照旧后台：采纳后届次转审核、带上 user_feedback_requires_review）。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../test/复用/样例数据.mjs';
import { 用户反馈 } from '../../../index.mjs';

const 选项 = { 操作人: '管理员甲', at: '2026-11-02T02:00:00.000Z' };
const 日志 = (db, action) => db.find('audit_log', { action });

describe('用户反馈', () => {
  test('纠错转审核：已发布的届次转待人工审核，理由写明是哪条纠错、说了什么；留一条“采纳纠错”', () => {
    const db = open(); seed(db);
    用户反馈.纠错转审核(db, 'ed-math-2026', { 纠错编号: 'feedback-1', 类别: '时间错误', 内容: '截止日期应该是 11 月 20 日', 说明: '核过官网' }, 选项);
    const 届 = db.get('edition', 'ed-math-2026').data;
    expect(届).toMatchObject({ status: '待人工审核', status_at: 选项.at, updated_by: '管理员甲' });
    expect(届.status_reason.at(-1)).toBe('用户纠错已采纳（feedback-1，时间错误）：截止日期应该是 11 月 20 日');
    expect(日志(db, '采纳纠错')[0]).toMatchObject({ table_name: 'feedback', record_id: 'feedback-1', detail: { 届次: 'ed-math-2026', 名称: '2026 年数学建模', 从: '已发布', 说明: '核过官网', 操作人: '管理员甲' } });
  });
  test('纠错转审核：届次已经删了或不存在，报找不到，什么都不改', () => {
    const db = open(); seed(db);
    expect(() => 用户反馈.纠错转审核(db, 'ed-没有', { 纠错编号: 'feedback-1', 类别: '其他', 内容: 'x' }, 选项)).toThrow('没有届次');
    expect(日志(db, '采纳纠错')).toEqual([]);
  });
  test('记处理：驳回纠错、处理意见反馈只留操作记录', () => {
    const db = open(); seed(db);
    用户反馈.记处理(db, { 动作: '驳回纠错', 表: 'feedback', 编号: 'feedback-2', 详情: { 名称: '数学建模', 说明: '官网就是这么写的' } }, 选项);
    expect(日志(db, '驳回纠错')[0]).toMatchObject({ created_at: 选项.at, record_id: 'feedback-2', detail: { 名称: '数学建模', 说明: '官网就是这么写的', 操作人: '管理员甲' } });
  });
});
