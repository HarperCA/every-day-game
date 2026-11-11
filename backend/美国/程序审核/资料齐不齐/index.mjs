// 第 3 关 资料齐不齐：入库最低的证据完整度，不是“已经核实”。只看字段，不调接口。
// 搬自 adminData/competitionScope.js 的 assessIntakeRecord（规则不变，字段改成新库的名字）。
// 旧代码先跑范围闸再查资料；新结构里范围闸是单独一关，由总的 审核() 按顺序调，这里只查资料。
//
//   查资料(记录, { 允许专业待定 }) → { 结果: '通过' | '待定', 缺: [..], 原因 }
//   允许专业待定：新抓的草稿、发现时已截止直接归档的，专业分类可以先空着，后面由 AI 判；发布仍要有
import { 大学生对象 } from '../范围闸/index.mjs';

const 要有 = [['organizer', '主办方'], ['participants', '参赛对象'], ['eligibility', '大学生资格依据'], ['format_and_rules', '专业任务与赛制']];

export function 查资料(记录 = {}, { 允许专业待定 = false } = {}) {
  // 参赛对象已写明大学生时，它本身就是资格依据，不再另要“参赛资格”一栏（2026-09-30 用户确认放宽）
  const 对象写了大学生 = 大学生对象.test(String(记录.participants || ''));
  const 缺 = 要有.filter(([key]) => !(key === 'eligibility' && 对象写了大学生) && !String(记录[key] || '').trim()).map(([, label]) => label);
  if (!记录.professions?.length && !允许专业待定) 缺.push('专业分类');
  if (!(记录.sources || []).some(s => /^https?:\/\//i.test(s?.url || ''))) 缺.push('来源网址');
  return 缺.length
    ? { 结果: '待定', 缺, 原因: `缺少${缺.join('、')}，不得以标题关键词代替核验` }
    : { 结果: '通过', 缺, 原因: '' };
}
