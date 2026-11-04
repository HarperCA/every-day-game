// 模块清单：运行顺序、名字、是不是关键模块、时间上限。
// 关键模块失败，整晚停下（不提交）；非关键模块失败，记下原因、跳过，继续跑后面的。
// 顺序 2026-10-31 按用户的意见改：先对比去重、再筛选和追溯，审核放在入库之前；维护已有记录移出，单独放在 backend/美国/db/维护/；
// 搜索计划和发现候选合成一个“搜索”模块；11-01 通知追溯并进 03 筛选（Codex 代理追踪）。
// 11-01 去掉 07 验收：06 入库写进主库就是发布，一共 6 个（用户定）。
// 03 筛选 11-01 改成关键模块：Jev、Codex 出错要截断整晚（和 02 一样），跳过它会把没筛过的候选全送去读详情。
// 哪些算关键模块是草案，还没最后定。
const MINUTE = 60 * 1000;

export const MODULES = [
  { name: '01-search', title: '搜索', critical: true, timeoutMs: 60 * MINUTE },
  { name: '02-dedup', title: '对比去重', critical: true, timeoutMs: 20 * MINUTE },
  { name: '03-filter', title: '筛选', critical: true, timeoutMs: 120 * MINUTE },
  { name: '04-extract', title: '读详情和抽取', critical: false, timeoutMs: 60 * MINUTE },
  { name: '05-review', title: '审核', critical: true, timeoutMs: 90 * MINUTE },
  { name: '06-ingest', title: '入库', critical: true, timeoutMs: 20 * MINUTE },
];

export async function loadModule(entry) {
  if (typeof entry.run === 'function') return entry;   // 测试里直接传进来的假模块
  const mod = await import(`../../modules/${entry.name}/index.mjs`);
  if (typeof mod.run !== 'function') throw new Error(`模块 ${entry.name} 没有导出 run 函数`);
  return { ...entry, run: mod.run, meta: mod.meta || {} };
}
