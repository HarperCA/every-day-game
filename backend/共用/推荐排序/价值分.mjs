// 价值分和报名时间可靠度（综合分要用）。从旧代码 publicData/competitionValue.js 搬来，逻辑不变：
// 旧系统发布时把 value_scores、timing_reliability 算好存进公开缓存；新比赛库不存，用到时当场算。
//
// 含金量不等于奖金：现金最多贡献 1 分，且只在这条路径上已有认可时才计入。
// 含金量分路径（保研考研、求职就业、出国留学、创业融资）、分岗位：认可度条目带 scope 的只对这些岗位成立。

export const 认可路径 = ['保研考研', '求职就业', '出国留学', '创业融资'];
export const 价值分上限 = 9;

const 认可等级 = ['高', '中', '低', '暂未明确'];
const 等级分 = { 高: 6, 中: 3, 低: 1, 暂未明确: 0 };
const 回报亮点 = ['保研考研加分', '实习或直通面试', '就业绿色通道', '创业扶持', '国际交流', '证书荣誉', '实物奖品', '现金奖金'];
// 非现金回报各自服务于不同路径：直通面试对求职有用，对保研没用
const 亮点路径 = { 保研考研加分: '保研考研', 实习或直通面试: '求职就业', 就业绿色通道: '求职就业', 国际交流: '出国留学', 创业扶持: '创业融资' };
const 亮点加分 = 3;
// 参赛规模小 = 获奖概率高，但只在已有认可时才加分
const 规模档 = ['千人以下', '千人-1万', '1万-10万', '10万以上', '暂未公布'];
const 稀缺分 = { 千人以下: 2, '千人-1万': 1, '1万-10万': 0, '10万以上': 0, 暂未公布: 0 };

// 认可度条目必须带出处；同一路径多条时留等级最高的
function 整理认可度(列表) {
  if (!Array.isArray(列表)) return [];
  const 按路径 = new Map();
  for (const 条 of 列表) {
    if (!条 || typeof 条 !== 'object') continue;
    const 路径 = 认可路径.includes(条.path) ? 条.path : null;
    const 等级 = 认可等级.includes(条.level) ? 条.level : null;
    const 出处 = String(条.evidence || '').slice(0, 300);
    if (!路径 || !等级 || !出处) continue;
    const 范围 = Array.isArray(条.scope)
      ? [...new Set(条.scope.filter(值 => typeof 值 === 'string' && 值.trim()).map(值 => 值.trim().slice(0, 40)))].slice(0, 8)
      : [];
    const 已有 = 按路径.get(路径);
    if (!已有 || 等级分[等级] > 等级分[已有.level]) 按路径.set(路径, { path: 路径, level: 等级, evidence: 出处, scope: 范围 });
  }
  return 认可路径.filter(路径 => 按路径.has(路径)).map(路径 => 按路径.get(路径));
}

const 现金加分 = (金额, 档) => (Number.isFinite(Number(金额)) && Number(金额) >= 100000 ? 1 : 档 === '10万-50万' || 档 === '50万以上' ? 1 : 0);

// 每条路径一个分（0..9）。岗位给了时，只有通用条目和命中这个岗位的条目参与计分。字段用新比赛库的名字。
export function 价值分(item, { 岗位 = '' } = {}) {
  const 目标 = String(岗位 || '').trim();
  const 认可 = 整理认可度(item.recognition).filter(条 => !条.scope.length || !目标 || 条.scope.includes(目标));
  const 亮点 = Array.isArray(item.reward_highlights) ? [...new Set(item.reward_highlights.filter(值 => 回报亮点.includes(值)))] : [];
  const 稀缺 = 稀缺分[规模档.includes(item.scale_tier) ? item.scale_tier : '暂未公布'] || 0;
  const 现金 = 现金加分(item.reward_amount, item.reward_tier);
  const 分 = {};
  for (const 路径 of 认可路径) {
    const 认可分 = 等级分[认可.find(条 => 条.path === 路径)?.level] || 0;
    const 亮点分 = Math.min(亮点.filter(值 => 亮点路径[值] === 路径).length * 亮点加分, 亮点加分);
    const 底 = 认可分 + 亮点分;
    // 这条路径上没有实质价值，稀缺和奖金都不加分
    分[路径] = 底 ? Math.min(底 + 稀缺 + 现金, 价值分上限) : 0;
  }
  return 分;
}

// 报名时间可靠度：近一半比赛的实际截止由学校决定，官方日期只是参考。不知道怎么组织的也不能当可靠。
const 时间可靠度表 = {
  需先校内选拔: '学校决定', 学校统一报名: '学校决定', 以赛区或学校通知为准: '学校决定',
  两种方式均可: '未核实', 暂未明确: '未核实',
  自行报名: '官方',
};
export const 时间可靠度 = item => 时间可靠度表[item.registration_organization] || '未核实';
