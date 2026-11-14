// 当晚总报告 report.md：每个模块的结果、条目去向统计、提交结果、没提交的改动和原因。
import fs from 'node:fs';

const cell = value => String(value ?? '').replace(/\|/g, '｜').replace(/\n/g, ' ');

export function writeReport(file, { runId, startedAt, finishedAt, dryRun, modules, rundb, result }) {
  const states = new Map(rundb.moduleStates().map(s => [s.name, s]));
  const lines = [
    `# 当晚总报告 ${runId}`,
    '',
    `- 开始：${startedAt.toISOString()}`,
    `- 结束：${finishedAt.toISOString()}`,
    `- 方式：${dryRun ? '试跑（不写总库）' : '正式运行'}`,
    `- 结果：${result.stoppedAt ? `停在关键模块 ${result.stoppedAt}，没有提交` : '全部模块跑完'}`,
    '',
    '## 各模块',
    '',
    '| 模块 | 状态 | 处理条目 | 其中 | 提出改动 | 问题或错误 |',
    '|---|---|---|---|---|---|',
  ];
  for (const m of modules) {
    const s = states.get(m.name);
    const stats = s?.stats;
    const by = stats?.byStatus ? Object.entries(stats.byStatus).map(([k, v]) => `${k} ${v}`).join('，') : '';
    const note = s?.error || (stats?.problems || []).join('；');
    lines.push(`| ${m.name} ${cell(m.title)} | ${s?.status || '没运行'} | ${stats?.items ?? ''} | ${cell(by)} | ${stats?.changes ?? ''} | ${cell(note)} |`);
  }
  const counts = rundb.statusCounts();
  lines.push('', '## 条目最后的状态', '', Object.entries(counts).map(([k, v]) => `- ${k}：${v}`).join('\n') || '- 没有条目');

  lines.push('', '## 提交到总库', '');
  if (!result.commit) lines.push('- 没有提交');
  else {
    const c = result.commit;
    lines.push(c.dryRun ? `- 试跑：可以写入 ${c.wouldWrite} 条，不提交 ${c.rejected} 条` :
      `- 写入 ${c.written} 条，冲突跳过 ${c.conflicts} 条，不提交 ${c.rejected} 条${c.error ? `；提交失败已撤回：${cell(c.error)}` : ''}`);
  }
  if (result.commit?.入库复核?.length) {
    lines.push('', '### 入库复核名单', '', '| 比赛 | 赛道 | 入库动作 | 复核结果 | 原因 |', '|---|---|---|---|---|');
    for (const r of result.commit.入库复核) {
      lines.push('| ' + [r.名称, r.赛道, r.decision, r.可入库 ? '可入库' : '暂缓', r.原因].map(cell).join(' | ') + ' |');
    }
  }
  const notWritten = rundb.changes().filter(c => !['已写入', '待提交'].includes(c.result));
  if (notWritten.length) {
    lines.push('', '### 没写进总库的改动', '', '| 表/行 | 提出的模块 | 结果 | 原因 |', '|---|---|---|---|');
    for (const c of notWritten.slice(0, 500)) lines.push(`| ${cell(c.tbl)}/${cell(c.row_key)} | ${c.module} | ${c.result} | ${cell(c.reason)} |`);
    if (notWritten.length > 500) lines.push(`| …… | | | 共 ${notWritten.length} 条，其余见 run.db 的 changes 表 |`);
  }
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}
