// 用户反馈在比赛库这边要留的东西（2026-11-02）。纠错、意见反馈的正本在北京，处理结果由后台经 沟通/审核结果回传 写回北京；这里只管比赛库这一侧：
//   纠错转审核(db, 届次id, { 纠错编号, 类别, 内容, 说明 }, { 操作人, at })   采纳的纠错：那一届转待人工审核，理由写明哪条纠错、说了什么；留“采纳纠错”记录
//     照旧后台 OperationModules.tsx：采纳后届次转审核、加上 user_feedback_requires_review
//   记处理(db, { 动作, 表, 编号, 详情 }, { 操作人, at })   驳回纠错、处理意见反馈：只留后台记录
import { 现有, 并进人工字段, 记日志 } from './后台写入.mjs';

const 默认选项 = 选项 => ({ 操作人: '管理员', at: new Date().toISOString(), ...选项 });

export function 纠错转审核(db, 届次id, { 纠错编号, 类别, 内容, 说明 = '' }, 选项) {
  const { 操作人, at } = 默认选项(选项);
  return db.transaction(tx => {
    const 原 = 现有(tx, 'edition', 届次id, '届次');
    const 理由 = `用户纠错已采纳（${纠错编号}，${类别}）：${String(内容).slice(0, 200)}`;
    const 回 = tx.update('edition', 届次id, {
      status: '待人工审核', status_at: at, updated_by: 操作人,
      status_reason: [...(原.data.status_reason || []), 理由],
      manual_fields: 并进人工字段(原.data.manual_fields, ['status']),
    }, 原.version);
    记日志(tx, '采纳纠错', 'feedback', 纠错编号, { 届次: 届次id, 名称: 原.data.edition_name, 从: 原.data.status, 说明, 操作人 }, at);
    return 回;
  });
}

export function 记处理(db, { 动作, 表, 编号, 详情 = {} }, 选项) {
  const { 操作人, at } = 默认选项(选项);
  db.transaction(tx => 记日志(tx, 动作, 表, 编号, { ...详情, 操作人 }, at));
}
