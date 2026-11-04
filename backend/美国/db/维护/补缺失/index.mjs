// 每日补缺失（2026-11-03 用户定）：缺失字段交给 Codex 补字段（美国/补字段/）很费 Codex 和搜索额度（试跑实测每查一条约 8 次 Codex、3 次百度），
// 所以不走每 5 分钟一个比赛的轮流，而是每天跑一次（定时器每天 10:00，见 ../../../定时/），挑最有用的先补，每天最多 上限 个（默认 20）：
//   1 已发布、报名还没截止的（没写截止的也算）   2 其他已发布的   3 已归档的
//   比赛级的问题（主办方、专业分类）按这个比赛有没有这样的届次排；同一档里缺报名时间的排前面（学生最要紧的）
//   7 天内查过的跳过（状态文件记每条上次查的时间），免得每天反复查同一批查不到的
// 挑出来的交给维护的主流程（审计 → 分流 → 查找 → 组装 → 提交），检查项名还是“缺失字段”，后台记录一样。
//
//   挑要补的(问题们, db, now, 上次查过, 上限) → 问题们（排好、截好）
//   每日补缺失({ db, ai, web, log, now, 上限, 状态文件, 试跑 }) → { 挑了: [{ table, key, 字段 }], 结果 }
import fs from 'node:fs';
import path from 'node:path';
import { runMaintenance } from '../index.mjs';
import { run as 查缺失 } from '../审计/缺失字段/index.mjs';
import { 报名还没截止 } from '../处理/查找/index.mjs';

export const 默认上限 = 20;
const 七天 = 7 * 24 * 3600 * 1000;
const 记多久 = 30 * 24 * 3600 * 1000;
const 键 = p => `${p.table}:${p.key}`;

function 档(届, now) {
  if (届.status === '已发布' && 报名还没截止(届, now)) return 0;
  return 届.status === '已发布' ? 1 : 2;
}

export function 挑要补的(问题们, db, now, 上次查过 = {}, 上限 = 默认上限) {
  const 排 = 问题们.map((p, 原序) => {
    const 届次们 = p.table === 'edition' ? [db.get('edition', p.key)?.data].filter(Boolean) : db.find('edition', { competition_id: p.key });
    const 缺报名时间 = (p.字段们 || []).some(k => ['registration_start', 'registration_end'].includes(k)) ? 0 : 1;
    return { p, 原序, 档: Math.min(2, ...届次们.map(e => 档(e, now))), 缺报名时间 };
  }).filter(x => !(now.getTime() - Date.parse(上次查过[键(x.p)] || 0) < 七天));
  return 排.sort((a, b) => a.档 - b.档 || a.缺报名时间 - b.缺报名时间 || a.原序 - b.原序).slice(0, 上限).map(x => x.p);
}

function 读状态(文件) {
  try { return JSON.parse(fs.readFileSync(文件, 'utf8')); } catch { return { 上次查过: {} }; }
}

export async function 每日补缺失({ db, ai, web, log, now = () => new Date(), 上限 = 默认上限, 状态文件, 试跑 = false }) {
  const 现在 = now();
  const 状态 = 读状态(状态文件);
  const 视图 = { get: (...a) => db.get(...a), list: (...a) => db.list(...a), find: (...a) => db.find(...a), count: (...a) => db.count(...a) };
  const { problems } = await 查缺失({ db: 视图, now, log, 范围: null });
  const 挑了 = 挑要补的(problems, db, 现在, 状态.上次查过, 上限);
  log.info(`缺字段的记录 ${problems.length} 条，今天补 ${挑了.length} 条（上限 ${上限}，7 天内查过的跳过）`);
  const 结果 = await runMaintenance({ db, ai, web, log, now, dryRun: 试跑, checks: [{ name: '缺失字段', timeoutMs: 60 * 1000, run: () => ({ problems: 挑了 }) }] });
  if (!试跑) {
    const 留下 = Object.fromEntries(Object.entries(状态.上次查过 || {}).filter(([, at]) => 现在.getTime() - Date.parse(at) < 记多久));
    for (const p of 挑了) 留下[键(p)] = 现在.toISOString();
    fs.mkdirSync(path.dirname(状态文件), { recursive: true });
    fs.writeFileSync(状态文件, JSON.stringify({ 上次查过: 留下 }, null, 1), 'utf8');
  }
  return { 挑了: 挑了.map(p => ({ table: p.table, key: p.key, 字段: p.字段 })), 结果 };
}
