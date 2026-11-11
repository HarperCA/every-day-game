// 综合分（《第一步：排序规则》第 ⑥ 条：截止日相同或都没有截止日时，综合分越高越靠前）。
// 从旧代码 publicData/competitionRanking.js 的 relevance、diversify、rankRecords（默认智能排序那条路）搬来，逻辑和权重不变；
// 字段换成新比赛库的名字，报名状态、价值分、时间可靠度当场算（旧系统是发布时算好存着）。
//
//   综合分(item, 条件, now)       → { 分数 0..1, 各项 }：各维度归一到 0..1 后加权求和，任何一维都能影响结果
//   综合分排名(items, 条件, now)   → 新数组：按综合分从高到低（同分按名称），再做多样性重排，免得前十条全是同一专业
//   条件：用户专业（用户偏好的专业，数组）、专业（明确筛的一个专业）、目标路径（保研考研等）、目标岗位
//
// 权重是当前的判断，不是定论：没有真实点击数据之前无法验证，集中写在这里方便以后按数据调。
import { 报名状态 } from './报名状态.mjs';
import { 价值分, 价值分上限, 认可路径, 时间可靠度 } from './价值分.mjs';

export const 权重 = {
  目标匹配: 0.28,   // 目标路径、岗位上的认可度：这是“含金量”
  推荐等级: 0.18,
  紧迫度: 0.18,     // 相对报名窗口长度，不是绝对天数
  机会窗口: 0.14,   // 首届、短报名期这类不抢就错过的
  专业匹配: 0.12,
  参与门槛: 0.06,
  信息完整: 0.04,   // 资料不全的不该排前面
};

const 推荐分 = { 强烈推荐: 1, 值得参加: 0.8, 适合练手: 0.6, 高难挑战: 0.5, 谨慎报名: 0.2 };
// 没评过级（信息不足或空）按中间分：原先算 0 分，137 条公开比赛里 116 条因此全被排到后面（2026-10-01）
const 未评级分 = 0.5;
const 天 = 24 * 60 * 60 * 1000;
const 短窗口天数 = 14;   // 报名期短于两周：容易还没听说就截止
// 官方日期的可靠度决定紧迫度下限：提醒用户现在就去查本校安排
const 紧迫度下限 = { 学校决定: 0.75, 未核实: 0.6, 官方: 0 };

// 推荐等级：比赛库里存的是对象（等级在 recommendation.recommendation，另有理由、适合谁……），旧缓存里直接是等级；两种都认
const 推荐结论 = item => (typeof item.recommendation === 'string' ? item.recommendation : item.recommendation?.recommendation ?? null);

// 报名窗口总长度（天）；缺开始或截止时给 null
function 窗口天数(item) {
  if (!item.registration_start || !item.registration_end) return null;
  const 长 = (new Date(item.registration_end).getTime() - new Date(item.registration_start).getTime()) / 天;
  return Number.isFinite(长) && 长 > 0 ? 长 : null;
}

// 剩 3 天，对报名期 90 天的是拖到最后、多半来不及；对报名期 7 天的是正常节奏
function 紧迫度(item, now) {
  const 状态 = 报名状态(item, now);
  if (状态 === '时间待公布') return 0.3;
  if (状态 === '即将报名') return 0.6;
  if (!item.registration_end) return 0.5;
  const 剩 = (new Date(item.registration_end).getTime() - now.getTime()) / 天;
  if (!Number.isFinite(剩)) return 0.5;
  if (剩 < 0) return 0;
  const 窗口 = 窗口天数(item);
  if (窗口 !== null && 窗口 <= 短窗口天数) return 剩 <= 1 ? 0.85 : 1;
  let 分;
  if (剩 <= 3) 分 = 窗口 !== null && 剩 / 窗口 >= 0.2 ? 0.9 : 0.6;
  else if (剩 <= 21) 分 = 1;
  else if (剩 <= 60) 分 = 0.75;
  else 分 = 0.45;
  // 校内选拔往往早几周到几个月，官方还剩 60 天时显示不紧急是错的；只抬到下限，不加分
  return Math.max(分, 紧迫度下限[时间可靠度(item)]);
}

// 首届必然没有历史认可度，不单独给一维会被结构性埋在底部；但首届本身不是优点，要有背书或实质回报才加分
function 机会窗口(item) {
  let 分 = 0.4;
  const 亮点 = Array.isArray(item.reward_highlights) ? item.reward_highlights : [];
  const 实质回报 = 亮点.some(值 => 值 !== '现金奖金' && 值 !== '实物奖品' && 值 !== '证书荣誉');
  const 有认可 = Array.isArray(item.recognition) && item.recognition.some(条 => 条 && (条.level === '高' || 条.level === '中'));
  const 奖金丰厚 = Number(item.reward_amount) >= 50000 || item.reward_tier === '10万-50万' || item.reward_tier === '50万以上';
  const 有背书 = 实质回报 || 有认可 || 奖金丰厚;
  if (item.lifecycle === '首届' && 有背书) 分 += 0.3;
  const 窗口 = 窗口天数(item);
  if (窗口 !== null && 窗口 <= 短窗口天数 && 有背书) 分 += 0.3;
  return Math.min(分, 1);
}

function 目标匹配(item, 条件) {
  const 路径 = 认可路径.includes(条件.目标路径) ? 条件.目标路径 : '';
  const 分们 = 价值分(item, { 岗位: 条件.目标岗位 });
  const 值们 = 路径 ? [Number(分们[路径]) || 0] : Object.values(分们).map(Number).filter(Number.isFinite);
  return (值们.length ? Math.max(0, ...值们) : 0) / 价值分上限;
}

function 专业匹配(item, 条件) {
  const 专业们 = Array.isArray(item.professions) ? item.professions : [];
  if (!专业们.length) return 0;
  if (条件.专业) return 专业们.includes(条件.专业) ? 1 : 0;
  const 想要 = Array.isArray(条件.用户专业) ? 条件.用户专业 : [];
  if (!想要.length) return 0.5;   // 没表达偏好，不加分也不扣分
  return 想要.some(值 => 专业们.includes(值)) ? 1 : 0.2;
}

// 门槛低 = 更多人真的报得上
function 参与门槛(item) {
  let 分 = 0.4;
  if (item.fee_type === '免费') 分 += 0.3;
  if (item.registration_organization === '自行报名') 分 += 0.2;
  if (item.scale_tier === '千人以下') 分 += 0.1;
  return Math.min(分, 1);
}

const 完整字段 = ['participants', 'eligibility', 'format_and_rules', 'team_size', 'registration_method', 'fees', 'rewards', 'participant_scale'];
function 信息完整(item) {
  const 填了 = 完整字段.filter(字段 => String(item[字段] || '').trim()).length;
  const 有日程 = item.registration_start && item.registration_end ? 1 : 0;
  return (填了 + 有日程) / (完整字段.length + 1);
}

export function 综合分(item, 条件 = {}, now = new Date()) {
  const 各项 = {
    目标匹配: 目标匹配(item, 条件),
    推荐等级: 推荐分[推荐结论(item)] ?? 未评级分,
    紧迫度: 紧迫度(item, now),
    机会窗口: 机会窗口(item),
    专业匹配: 专业匹配(item, 条件),
    参与门槛: 参与门槛(item),
    信息完整: 信息完整(item),
  };
  const 分数 = Object.entries(权重).reduce((和, [名, 重]) => 和 + 重 * 各项[名], 0);
  return { 分数, 各项 };
}

// 两场比赛有多像：共同的专业方向和方向标签越多越像（Jaccard）
function 相似度(a, b) {
  const 集合 = item => new Set([...(item.professions || []), ...(item.objective_tags || [])]);
  const 左 = 集合(a);
  const 右 = 集合(b);
  if (!左.size || !右.size) return 0;
  let 共同 = 0;
  for (const 值 of 左) if (右.has(值)) 共同 += 1;
  return 共同 / (左.size + 右.size - 共同);
}

// MMR：每次挑“分高、又和已选的不太像”的一条
const 多样性系数 = 0.78;   // 偏向分数；越小越强调多样
const 重排范围 = 60;       // 只对靠前的候选做 O(n²) 重排

function 多样性重排(打好分的) {
  const 池 = 打好分的.slice(0, 重排范围);
  const 其余 = 打好分的.slice(重排范围);
  const 选中 = [];
  while (池.length) {
    let 最好 = 0;
    let 最好值 = -Infinity;
    for (let i = 0; i < 池.length; i += 1) {
      const 最像 = 选中.reduce((大, 已选) => Math.max(大, 相似度(池[i].item, 已选.item)), 0);
      const 值 = 多样性系数 * 池[i].分数 - (1 - 多样性系数) * 最像;
      if (值 > 最好值) { 最好值 = 值; 最好 = i; }
    }
    选中.push(池.splice(最好, 1)[0]);
  }
  return 选中.concat(其余);
}

export function 综合分排名(items, 条件 = {}, now = new Date()) {
  const 打好分的 = items
    .map(item => ({ item, 分数: 综合分(item, 条件, now).分数 }))
    .sort((a, b) => b.分数 - a.分数 || String(a.item.name || '').localeCompare(String(b.item.name || ''), 'zh-CN'));
  return 多样性重排(打好分的).map(entry => entry.item);
}
