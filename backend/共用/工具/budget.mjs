// 额度：每家接口当晚能用多少（次数或 token），用完就不再派发新请求。
// 没处理完的条目由模块标成“顺延”，下一晚优先处理。
//
// 用法：
//   const budget = createBudget({ deepseek: 2_000_000, baidu: 30, codex: 40 });
//   if (!budget.use('baidu', 1)) { /* 额度用完：把这条标成顺延 */ }
//   budget.left('baidu')   // 还剩多少；没设上限的返回 Infinity

export function createBudget(limits = {}) {
  const used = new Map();
  const limitOf = provider => (provider in limits ? limits[provider] : Infinity);
  return {
    use(provider, amount = 1) {
      const next = (used.get(provider) || 0) + amount;
      if (next > limitOf(provider)) return false;
      used.set(provider, next);
      return true;
    },
    left: provider => limitOf(provider) - (used.get(provider) || 0),
    exhausted: provider => limitOf(provider) - (used.get(provider) || 0) <= 0,
    report: () => Object.fromEntries([...new Set([...Object.keys(limits), ...used.keys()])]
      .map(provider => [provider, { used: used.get(provider) || 0, limit: limitOf(provider) }])),
  };
}
