import type { PipelineRun, PipelineRunRow } from './adminCloud';

export interface PipelineMetric {
  value: number | null;
  recordedRuns: number;
  missingRuns: number;
}

const METRICS = [
  'searchResults', 'newLeads', 'eligibleDiscovered', 'newRecords', 'qualifiedNew',
  'publishedNew', 'publishedExisting', 'publishedTotal', 'existingEnriched',
  'existingUpdated', 'extractionAttempted', 'extractionSucceeded',
] as const;

type MetricName = typeof METRICS[number];

/** 汇总结果账内已完成的轮次；每个数值同时报告覆盖轮数，缺失值不当作零。 */
export function summarizePipelineRuns(runs: PipelineRun[]) {
  const unique = [...new Map(runs.map(run => [run.id, run])).values()];
  const completed = unique.filter(run => run.status === 'completed');
  const dates = completed.map(run => run.finishedAt).filter(Boolean).sort();
  const metrics = Object.fromEntries(METRICS.map(name => {
    const numbers = completed.map(run => run[name]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return [name, { value:numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null,
      recordedRuns:numbers.length, missingRuns:completed.length - numbers.length }];
  })) as Record<MetricName, PipelineMetric>;

  const failureCounts = new Map<string, { stage:string; reason:string; count:number }>();
  for (const run of completed) for (const failure of run.failures || []) {
    if (!Number.isFinite(failure.count) || failure.count <= 0) continue;
    const stage = String(failure.stage || 'unknown').trim();
    const reason = String(failure.reason || '原因未记录').trim();
    const key = JSON.stringify([stage, reason]);
    const previous = failureCounts.get(key);
    if (previous) previous.count += failure.count;
    else failureCounts.set(key, { stage, reason, count:failure.count });
  }
  return {
    coverage:{ totalRuns:unique.length, completedRuns:completed.length, excludedRuns:unique.length - completed.length,
      earliestAt:dates[0] || null, latestAt:dates[dates.length - 1] || null },
    metrics,
    // 同一候选可能在多环节出现，以下是原因事件次数，不是未入库的唯一比赛数。
    failures:[...failureCounts.values()].sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage) || a.reason.localeCompare(b.reason)),
  };
}

export interface PipelineProblem {
  stage: 'same_name' | 'scope' | 'gate';
  reason: string;
  count: number;
}

function normalizeProblemReason(stage: PipelineProblem['stage'], note: string): string {
  const reason = String(note || '').replace(/\s+/g, ' ').trim();
  if (stage === 'same_name' && reason.startsWith('库里已有同名记录')) return '库里已有同名记录（已隔离）';
  if (stage === 'same_name' && reason.startsWith('库里已有同名赛事')) return '库里已有同名赛事（来源已存在）';
  if (stage === 'gate' && reason.startsWith('已处理（')) return '已有记录已处理';
  return reason || '原因未逐条记录';
}

/** 汇总逐条去向。计数单位是候选页面/线索，不保证是不同比赛。 */
export function summarizePipelineRows(rows: PipelineRunRow[]) {
  const terminalCounts: Record<string, number> = {};
  const problems = new Map<string, PipelineProblem>();
  let afterReadNotStoredTotal = 0;
  for (const row of rows) {
    const trail = (row.trail || []).filter(step => !step.virtual);
    const terminal = [...trail].reverse().find(step => step.n.startsWith('end_'))?.n || 'unknown';
    terminalCounts[terminal] = (terminalCounts[terminal] || 0) + 1;
    // 只认已读到正文并抽取成功、且最后被同名/范围/收录门槛拦下的候选。
    if (!trail.some(step => step.n === 'read' && step.o === 'ok')
      || !trail.some(step => step.n === 'extract' && step.o === 'ok')) continue;
    const lastDecision = [...trail].reverse().find(step =>
      (step.n === 'same_name' && step.o === 'exists')
      || (step.n === 'scope' && step.o === 'reject')
      || (step.n === 'gate' && step.o === 'skip'));
    if (!lastDecision) continue;
    const stage = lastDecision.n as PipelineProblem['stage'];
    const reason = normalizeProblemReason(stage, lastDecision.note || '');
    const key = JSON.stringify([stage, reason]);
    const previous = problems.get(key);
    if (previous) previous.count++;
    else problems.set(key, { stage, reason, count:1 });
    afterReadNotStoredTotal++;
  }
  return { totalRows:rows.length, terminalCounts,
    afterReadNotStored:{ total:afterReadNotStoredTotal,
      byProblem:[...problems.values()].sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage) || a.reason.localeCompare(b.reason)) } };
}
