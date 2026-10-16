// 把历史 runs/*/jev-filter-report.json 里的“只留线索/人工复核”补入后续任务。
// 可重复运行：每个 URL + run ID 只计一次。只补任务，不触发抽取或入库。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leadKey, loadLeadFollowups, recordJevLeads, saveLeadFollowups } from './lead-followups.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function backfillLeadFollowups(runsDir, queueFile, runId = '') {
  const names = runId ? [runId] : fs.readdirSync(runsDir, { withFileTypes:true })
    .filter(item => item.isDirectory() && /^\d{4}-\d\d-\d\dT[\d-]+Z$/.test(item.name))
    .map(item => item.name).sort();
  let state = loadLeadFollowups(queueFile);
  let reports = 0;
  for (const name of names) {
    if (!/^\d{4}-\d\d-\d\dT[\d-]+Z$/.test(name)) throw new Error(`无效 run ID：${name}`);
    const dir = path.join(runsDir, name);
    const report = readJson(path.join(dir, 'jev-filter-report.json'));
    if (!Array.isArray(report?.decisions)) continue;
    reports += 1;
    // “只留线索”中有少数标题虽被 Jev 判为 lead，后来仍按通知进入追溯。
    // 它们不属于流程图的 end_lead，避免回填成未处理任务。
    const progressedUrls = new Set([
      ...(readJson(path.join(dir, 'formal-notices.json'))?.candidates || []),
      ...(readJson(path.join(dir, 'combined-candidates.json'))?.candidates || []),
    ].map(item => leadKey(item.detailUrl)));
    const candidates = new Map();
    for (const file of fs.readdirSync(dir).filter(file => /-candidates\.json$/.test(file))) {
      for (const candidate of readJson(path.join(dir, file))?.candidates || []) {
        const key = leadKey(candidate.detailUrl);
        if (key && !candidates.has(key)) candidates.set(key, candidate);
      }
    }
    const decisions = report.decisions.filter(item => ['lead', 'review'].includes(item.action) && !progressedUrls.has(leadKey(item.url)))
      .map(item => ({ ...item, candidate:candidates.get(leadKey(item.url)) || { name:item.name, detailUrl:item.url } }));
    const fromName = name.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1:$2:$3.$4Z');
    const at = new Date(report.createdAt || fromName);
    state = recordJevLeads(state, decisions, Number.isNaN(at.getTime()) ? new Date() : at, name);
  }
  saveLeadFollowups(queueFile, state);
  return { reports, tasks:Object.keys(state.entries).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => args[args.indexOf(flag) + 1] || '';
  const runId = args.includes('--run') ? value('--run') : '';
  const runsDir = args.includes('--runs-dir') ? path.resolve(value('--runs-dir')) : path.join(HERE, 'runs');
  const queueFile = args.includes('--queue') ? path.resolve(value('--queue')) : path.join(HERE, 'plans', 'lead-followups.json');
  const result = backfillLeadFollowups(runsDir, queueFile, runId);
  console.log(`回填报告 ${result.reports} 轮，后续任务 ${result.tasks} 条：${queueFile}`);
}
