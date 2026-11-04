// 审计的检查项：名字和时间上限。各项互相独立，同时跑；一项失败只记下原因，不影响别的。
const MINUTE = 60 * 1000;

export const CHECKS = [
  { name: '状态', timeoutMs: 5 * MINUTE },
  { name: '缺失字段', timeoutMs: 5 * MINUTE },
  { name: '新一届', timeoutMs: 5 * MINUTE },
  { name: '链接', timeoutMs: 30 * MINUTE },
  { name: '核对原文', timeoutMs: 60 * MINUTE },
];

export async function loadCheck(entry) {
  if (typeof entry.run === 'function') return entry;   // 测试里直接传进来的假检查项
  const mod = await import(`./审计/${entry.name}/index.mjs`);
  if (typeof mod.run !== 'function') throw new Error(`检查项 ${entry.name} 没有导出 run 函数`);
  return { ...entry, run: mod.run };
}
