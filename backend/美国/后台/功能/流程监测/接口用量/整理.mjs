// 接口用量 · 整理（纯计算）：合计，按天（新的在前）、按接口（次数多的在前）、按来源汇总；费用只加有价格的，有没算价的写明。
const 接口名 = { deepseek: 'DeepSeek', kimi: 'Kimi', baidu: '百度', jev: 'Jev', codex: 'Codex' };
const 中文 = p => 接口名[p] || p;
const 保留 = x => Math.round(x * 1e6) / 1e6;

function 加起来(行们) {
  const 有价 = 行们.filter(r => r.cost != null);
  return {
    次数: 行们.reduce((和, r) => 和 + (r.calls || 0), 0),
    失败: 行们.reduce((和, r) => 和 + (r.failed || 0), 0),
    输入token: 行们.reduce((和, r) => 和 + (r.tokensIn || 0), 0),
    输出token: 行们.reduce((和, r) => 和 + (r.tokensOut || 0), 0),
    费用: 有价.length ? 保留(有价.reduce((和, r) => 和 + r.cost, 0)) : null,
    有没算价的: 行们.some(r => r.cost == null && r.calls > 0),
  };
}

function 分组(行们, 键, 名称 = x => x) {
  const 组 = new Map();
  for (const r of 行们) 组.set(r[键], [...(组.get(r[键]) || []), r]);
  return [...组].map(([k, rs]) => ({ 名称: 名称(k), ...加起来(rs) }));
}

export function 整理(原始) {
  return {
    天数: 原始.天数, 从: 原始.从, 到: 原始.到, 月份: 原始.月份, 没接上: Boolean(原始.没接上),
    合计: 加起来(原始.行们),
    按天: 分组(原始.行们, 'day').sort((a, b) => b.名称.localeCompare(a.名称)),
    按接口: 分组(原始.行们, 'provider', 中文).sort((a, b) => b.次数 - a.次数),
    按来源: 分组(原始.行们, 'source').sort((a, b) => b.次数 - a.次数),
    月费: (原始.固定费用 || []).map(f => ({ 接口: 中文(f.provider), 金额: f.amount, 说明: f.note || '' })),
  };
}
