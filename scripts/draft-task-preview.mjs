// 草稿处理任务 · 只读预览（不写库）
//
// 对草稿、待系统验证、待人工审核的记录逐条运行后台同一套 previewDraftTask，
// 列出每项发布条件的证据状态（已证实／官方未公布／待核验／有冲突）、阻断项、下一动作、目标网址，
// 并附上分诊留下的追溯要求、卡住天数与来源链。老记录没有来源链，不追溯。
//
// 管理端逻辑是 TypeScript，先用 esbuild 打包再运行：
//   esbuild scripts/draft-task-preview.mjs --bundle --platform=node --format=esm --outfile=<临时>/preview.mjs
//   node <临时>/preview.mjs <bootstrap.json> <输出目录>
import fs from 'node:fs';
import path from 'node:path';
import { previewDraftTask } from '../apps/admin/src/draftTaskPreview.ts';

const TARGET_STATUSES = ['draft', 'pending_system_validation', 'pending_manual_review'];
const STATUS_LABEL = { draft:'草稿', pending_system_validation:'待系统验证', pending_manual_review:'待人工审核' };
const CHECK_ORDER = ['EVENT_IDENTITY', 'ORGANIZER', 'COLLEGE_ELIGIBILITY', 'PROFESSIONAL_SCOPE', 'OFFICIAL_EDITION_SOURCE', 'REGISTRATION_TIME', 'REGISTRATION_ENTRY'];
const STATE_MARK = { '已证实':'✓', '官方未公布':'○', '待核验':'？', '有冲突':'✗' };

export function buildPreview(records, now = new Date()) {
  return records.filter(record => TARGET_STATUSES.includes(record.dataStatus)).map(record => {
    const task = previewDraftTask(record, now);
    const seen = Date.parse(record.firstSeenAt || '');
    return {
      ...task, name:record.name, dataStatus:record.dataStatus,
      stuckDays:Number.isFinite(seen) ? Math.floor((now.getTime() - seen) / 86400000) : null,
      triage:record.triage ? { bucket:record.triage.bucket || null, traceTodo:record.triage.traceTodo || null, traceDue:record.triage.traceDue || null } : null,
      discovery:record.discovery || null,
    };
  }).sort((a, b) => TARGET_STATUSES.indexOf(a.dataStatus) - TARGET_STATUSES.indexOf(b.dataStatus) || a.result.localeCompare(b.result, 'zh') || a.name.localeCompare(b.name, 'zh'));
}

export function summarize(preview) {
  const count = (list, key) => list.reduce((acc, item) => { const k = key(item); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const checks = {};
  for (const item of preview) for (const check of item.checks) {
    checks[check.label] ||= { '已证实':0, '官方未公布':0, '待核验':0, '有冲突':0 };
    checks[check.label][check.state] += 1;
  }
  const stuck = preview.map(item => item.stuckDays).filter(Number.isFinite);
  return {
    total:preview.length,
    byStatus:count(preview, item => STATUS_LABEL[item.dataStatus]),
    byResult:count(preview, item => item.result),
    byNextAction:count(preview, item => item.nextAction),
    checks,
    stuckDaysAverage:stuck.length ? Number((stuck.reduce((a, b) => a + b, 0) / stuck.length).toFixed(1)) : null,
    withTargetUrl:preview.filter(item => item.targetUrl).length,
  };
}

function toMarkdown(preview, summary, now) {
  const lines = [`# 草稿处理任务 · 只读预览（${now.toISOString().slice(0, 10)}）`, '',
    '未写库。证据状态：✓ 已证实　○ 官方未公布　？ 待核验　✗ 有冲突', '',
    `共 ${summary.total} 条：${Object.entries(summary.byStatus).map(([k, v]) => `${k} ${v}`).join('，')}。平均已卡 ${summary.stuckDaysAverage ?? '-'} 天；有目标网址 ${summary.withTargetUrl} 条。`, '',
    '## 各项发布条件', '', '| 条件 | 已证实 | 官方未公布 | 待核验 | 有冲突 |', '|---|---|---|---|---|',
    ...Object.entries(summary.checks).map(([label, s]) => `| ${label} | ${s['已证实']} | ${s['官方未公布']} | ${s['待核验']} | ${s['有冲突']} |`), '',
    '## 下一动作分布', '', ...Object.entries(summary.byNextAction).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${v} 条：${k}`), ''];
  let group = null;
  for (const item of preview) {
    if (item.dataStatus !== group) { group = item.dataStatus; lines.push(`## ${STATUS_LABEL[group]}`, ''); }
    const marks = CHECK_ORDER.map(code => item.checks.find(c => c.code === code)).filter(Boolean).map(c => `${c.label}${STATE_MARK[c.state]}`).join(' ');
    lines.push(`### ${item.name}`, '',
      `- 结论：${item.result}${item.terminal ? '（终止自动追踪）' : ''}`,
      `- 条件：${marks}`,
      `- 下一动作：${item.nextAction}`,
      `- 目标网址：${item.targetUrl || '无'}`,
      ...(item.triage?.traceTodo ? [`- 分诊追溯要求：${item.triage.traceTodo}（期限 ${String(item.triage.traceDue || '').slice(0, 10)}）`] : []),
      `- 已卡：${item.stuckDays ?? '-'} 天｜来源链：${item.discovery ? `${item.discovery.route || '未标路线'}｜${item.discovery.query || '无查询词'}` : '老记录，不追溯'}`,
      ...item.checks.filter(c => c.state === '有冲突').map(c => `- ✗ ${c.label}：${c.detail}`), '');
  }
  return lines.join('\n');
}

const [input, outDir] = process.argv.slice(2);
if (input && outDir) {
  const now = new Date();
  const bootstrap = JSON.parse(fs.readFileSync(input, 'utf8'));
  const records = bootstrap.data?.records || bootstrap.records;
  const preview = buildPreview(records, now);
  const summary = summarize(preview);
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  fs.mkdirSync(outDir, { recursive:true });
  fs.writeFileSync(path.join(outDir, `draft-task-preview-${stamp}.json`), JSON.stringify({ generatedAt:now.toISOString(), summary, preview }, null, 2));
  fs.writeFileSync(path.join(outDir, `draft-task-preview-${stamp}.md`), toMarkdown(preview, summary, now));
  console.log(JSON.stringify(summary, null, 2));
}
