// 第 4 关 收录门槛：什么竞赛都收，但水赛不收。规则打分和 AI 再判放在这一个文件里（2026-11-01 用户定）。
// 规则搬自 adminData/competitionAdmission.js，AI 再判搬自 competitionAdmissionAi.js（判断标准不变，字段改成新库的名字）。
//
// 最重要的前提（旧注释）：冷门不是水赛。参赛人数少、知名度低正是产品要找的，绝不能作为拒收依据。
// 水赛的真实特征：收费高 + 门槛极低 + 人人有奖 + 主办方无行业地位 + 证书无实际用途。宁可多放到“要人看”，也不自动拒收。
//
//   查门槛(记录) → { 结果: '通过' | '不收', 档: '直接收' | '要人看' | null, 原因, 加分项, 红旗, 分, 红旗分 }   只按规则
//   收录门槛(记录, { ai }) → 上面的结果加 再判：判成“要人看”的，经 AI 总管（用途 admission → DeepSeek）再读一遍资料；
//                            值得收录且有把握的升成“直接收”。AI 只能把“要人看”升级，不参与红旗拒收。没给 ai 时不再判（再判: null）。
//                            调用出错抛给调用方；返回内容用不了先 ai.报告问题 再抛。
import { loadPrompt } from '../../../共用/工具/提示词.mjs';

export const 用途 = 'admission';
export const 提示词文件 = new URL('./prompt.md', import.meta.url);

// 主办方带这些字样，说明背后有学术组织或行政机构
const 权威 = [
  { 规则: /教育部|共青团中央|中国科协|工业和信息化部|科技部|人力资源和社会保障部/, 信号: '行政机构主办', 分: 3 },
  { 规则: /一级学会|中国[一-龥]{2,8}学会|全国[一-龥]{2,8}学会/, 信号: '全国性学会主办', 分: 3 },
  { 规则: /学会|协会|研究会|专业委员会|专委会|学术委员会/, 信号: '学术组织参与', 分: 2 },
  { 规则: /全国组委会|组织委员会|指导委员会|教学指导委员会/, 信号: '设有组委会', 分: 1 },
  // 只认真正指向学术会议的措辞（旧注释：原先把“评测”“论文”也算进来太松，会翻转同一赛事几条赛道的判定）
  { 规则: /学术会议|全国[一-龥]{2,10}大会|届[一-龥]{0,10}大会|论文集/, 信号: '依托学术会议', 分: 1 },
  // 知名技术平台真金白银投入（算力、数据集、奖金），权重比学会类低一档
  { 规则: /阿里云天池|DataFountain|Kaggle|华为云|腾讯云|百度飞桨|飞桨|魔搭社区|ModelScope|字节跳动|抖音集团/, 信号: '知名技术平台联合主办或支持', 分: 2 },
];
// 水赛红旗，命中都要抵消证据才能收
const 红旗规则 = [
  { 规则: /人人有奖|保证获奖|100%获奖|全员获奖|包过|包拿奖/, 信号: '宣称人人有奖', 分: 4 },
  { 规则: /获奖率\s*(9[0-9]|100)\s*%/, 信号: '获奖率畸高', 分: 4 },
  { 规则: /证书可查询?[^。；]{0,10}(收费|付费|工本费)/, 信号: '证书另行收费', 分: 3 },
  { 规则: /滚动报名|随时报名|每月一期|每周一期|常年招生/, 信号: '无固定赛期，疑似流水线', 分: 2 },
  { 规则: /含金量极高|国家级含金量|保研必备|稳拿/, 信号: '夸张宣传话术', 分: 2 },
];
export const 直接收分 = 3;
export const 不收红旗分 = 4;

const 扫 = (text, 规则们) => {
  const 命中 = 规则们.filter(r => r.规则.test(text));
  return { 信号们: 命中.map(r => r.信号), 分: 命中.reduce((s, r) => s + r.分, 0) };
};

// 要看的文字：主办方、简介、奖项、赛制、报名方式、费用，加上抽取时逐字引证过的权威信号
function 文字(记录) {
  const signals = Array.isArray(记录.authority_signals)
    ? 记录.authority_signals.map(item => (typeof item === 'string' ? item : `${item?.signal || ''} ${item?.quote || ''}`)) : [];
  return [记录.organizer, 记录.introduction, 记录.rewards, 记录.format_and_rules, 记录.registration_method, 记录.fees, ...signals]
    .filter(v => typeof v === 'string').join('\n');
}

// 只在本校办的不收：学生对自己学校的比赛本来就知情。挂了上级比赛的校内选拔不同，它是国赛的第一个环节
export const 只在本校 = (记录 = {}) => /校级/.test(String(记录.level || '')) && !记录.parent_id;

export function 查门槛(记录 = {}) {
  const text = 文字(记录);
  const 权威命中 = 扫(text, 权威);
  const 红旗命中 = 扫(text, 红旗规则);
  const 加分项 = [...权威命中.信号们];
  let 分 = 权威命中.分;
  // 已核实的认可度是最硬的证据
  const 认可 = (Array.isArray(记录.recognition) ? 记录.recognition : []).filter(x => x && (x.level === '高' || x.level === '中'));
  if (认可.length) { 加分项.push(`已核实认可度：${认可.map(x => `${x.path}(${x.level})`).join('、')}`); 分 += 4; }
  // 保研加分、直通面试这类实质回报是逐字引证过的原文事实；现金、实物、证书不算
  const 实质 = (Array.isArray(记录.reward_highlights) ? 记录.reward_highlights : []).filter(x => !['现金奖金', '实物奖品', '证书荣誉'].includes(x));
  if (实质.length) { 加分项.push(`实质回报：${实质.join('、')}`); 分 += 3; }
  const 依据 = { 加分项, 红旗: 红旗命中.信号们, 分, 红旗分: 红旗命中.分 };

  if (只在本校(记录)) return { 结果: '不收', 档: null, 原因: '仅本校举办、无上级赛事，学生本来就知情，不在收录范围', ...依据 };
  if (红旗命中.分 >= 不收红旗分 && 分 < 红旗命中.分) return { 结果: '不收', 档: null, 原因: `命中水赛特征（${红旗命中.信号们.join('、')}），且没有抵消证据`, ...依据 };
  if (分 >= 直接收分) return { 结果: '通过', 档: '直接收', 原因: `有可查的价值证据（${加分项.join('、')}）${红旗命中.信号们.length ? `；但仍需留意：${红旗命中.信号们.join('、')}` : ''}`, ...依据 };
  return { 结果: '通过', 档: '要人看', 原因: 加分项.length ? `证据偏弱（${加分项.join('、')}），需要确认主办方与回报` : '缺少可查的价值证据，需要人工或 AI 判断', ...依据 };
}

const 资料 = 记录 => ({
  名称: 记录.name || '',
  主办方: 记录.organizer || '',
  权威信号: (Array.isArray(记录.authority_signals) ? 记录.authority_signals : []).map(x => (typeof x === 'string' ? x : `${x?.signal || ''}：${x?.quote || ''}`)),
  实质回报: Array.isArray(记录.reward_highlights) ? 记录.reward_highlights : [],
  认可度: (Array.isArray(记录.recognition) ? 记录.recognition : []).map(x => ({ 路径: x?.path, 等级: x?.level, 依据: x?.evidence })),
  简介: String(记录.introduction || '').slice(0, 2000),
});

function 检查再判(data) {
  if (!data || typeof data !== 'object') return '没有交回 JSON 对象';
  if (typeof data.值得收录 !== 'boolean') return '“值得收录”要填 true 或 false';
  if (typeof data.有把握 !== 'boolean') return '“有把握”要填 true 或 false';
  if (typeof data.理由 !== 'string' || !data.理由.trim()) return '“理由”不能空';
  return null;
}

export async function 收录门槛(记录 = {}, { ai } = {}) {
  const 规则 = 查门槛(记录);
  if (规则.档 !== '要人看' || !ai) return { ...规则, 再判: null };
  const { version, text } = loadPrompt(提示词文件, { 候选资料: JSON.stringify(资料(记录)) });
  const { data } = await ai.chat({ purpose: 用途, json: true, promptVersion: version,
    messages: [{ role: 'system', content: '你是严谨的赛事资料审核助手，只依据给出的资料判断，证据不足就如实说不确定，不得编造或过度推断。只输出 JSON。' }, { role: 'user', content: text }] });
  const 问题 = 检查再判(data);
  if (问题) {
    ai.报告问题({ purpose: 用途, promptVersion: version, 原因: `${记录.name || ''}：${问题}` });
    throw new Error(`收录再判返回的内容用不了：${问题}`);
  }
  const 再判 = { 值得收录: data.值得收录, 有把握: data.有把握, 理由: data.理由 };
  return 再判.值得收录 && 再判.有把握
    ? { ...规则, 档: '直接收', 原因: `${规则.原因}；AI 再判值得收录：${再判.理由}`, 再判 }
    : { ...规则, 再判 };
}
