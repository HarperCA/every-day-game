// 纠错审核 · 取数据和操作（美国服务器上跑）：列表读北京同步到美国的纠错（用户副本的 feedback），连上比赛库里对应的届次（2026-11-02）。
// 采纳、驳回经 环境.回传 写回北京正本（沟通/审核结果回传），用户在小程序“我的纠错”里看得到；
// 采纳的把那一届转回待人工审核（照旧后台 OperationModules.tsx），驳回只留后台记录；审核说明记在比赛库的后台记录里，不传北京。
//   取({ 动作: '采纳' | '驳回', 编号, 说明, 读到的更新时间 }, { db, 用户副本库, 回传 }) → { 条目们, 接好了, 结果 }
import { 用户副本, 用户反馈 } from '../../../../db/index.mjs';

const 来源 = '北京同步来的纠错提交（用户副本的 feedback）';
const 类别名 = { time: '时间错误', registration_link: '报名链接', eligibility: '参赛资格', rules: '规则信息', other: '其他' };
const 中文 = {
  feedback_conflict: '这条纠错已被其他管理员处理过，请刷新后再看。',
  feedback_not_found: '北京找不到这条纠错（可能已随账号删除）。',
};

function 届次信息(db, id) {
  const 行 = db.get('edition', id)?.data;
  return 行 ? { id, 名称: 行.edition_name, 状态: 行.status } : null;
}

async function 处理({ 动作, 编号, 说明 = '', 读到的更新时间 }, { db, 用户副本库, 回传 }) {
  const 条 = 用户副本.一条(用户副本库, 'feedback', 编号);
  if (!条) throw new Error('找不到这条纠错（刷新看看）');
  const 写的 = String(说明).trim();
  if (动作 === '驳回' && !写的) throw new Error('请写明驳回的原因');
  try {
    await 回传({ 种类: '纠错', 编号, 改动: { status: 动作 === '采纳' ? 'accepted' : 'rejected' }, 读到的更新时间 });
  } catch (错误) {
    throw new Error(中文[错误?.message] || String(错误?.message || 错误));
  }
  const 类别 = 类别名[条.category] || 条.category;
  if (动作 === '驳回') {
    用户反馈.记处理(db, { 动作: '驳回纠错', 表: 'feedback', 编号, 详情: { 名称: 条.competition_name, 届次: 条.edition_id, 说明: 写的 } });
    return '已驳回，用户可在“我的纠错”看到处理结果。';
  }
  if (!届次信息(db, 条.edition_id)) {
    用户反馈.记处理(db, { 动作: '采纳纠错', 表: 'feedback', 编号, 详情: { 名称: 条.competition_name, 届次: 条.edition_id, 说明: 写的, 备注: '届次已不在比赛库' } });
    return '已采纳；这条纠错对应的届次已不在比赛库（删了或在回收站），没转审核。';
  }
  用户反馈.纠错转审核(db, 条.edition_id, { 纠错编号: 编号, 类别, 内容: 条.content, 说明: 写的 });
  return '已采纳，那一届已转回待人工审核，去比赛列表改好后再发布。';
}

export async function 取(参数 = {}, 环境 = {}) {
  if (!环境.用户副本库) return { 条目: [], 来源, 接好了: false };
  const 结果 = ['采纳', '驳回'].includes(参数.动作) ? await 处理(参数, 环境) : null;
  const 条目们 = 用户副本.列出(环境.用户副本库, 'feedback').map(条 => ({ ...条, 届次: 届次信息(环境.db, 条.edition_id) }));
  return { 条目们, 来源, 接好了: true, 结果 };
}
