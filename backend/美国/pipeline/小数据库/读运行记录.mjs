// 读运行记录：给后台“抓取结果账”页读每晚的 run.db（2026-11-02），只读打开，不改文件。
// 只用自己和 共用/工具，根目录由调用方给（后台用 pipeline/shared/paths.mjs 的 logRoot()）。
// 是不是试跑、跑完没有只写在 report.md 里（总控写的），从那里读。
//
//   列出几晚({ 根 }) → ['2026-11-01-02', '2026-11-01', …]   有 run.db 的运行文件夹，新的在前
//   读一晚({ 根, 名 }) → { 名, 开始, 结束, 方式, 结果, 搜索词们, 候选, 模块们, 条目们, 去向们, 改动 }
//     模块们：[{ 模块, 状态, 开始, 结束, 处理, 各状态, 改动, 问题, 错误 }]（没跑的模块不列）
//     条目们：[{ 网址, 名称, 状态, 模块, 原因 }]，模块和原因取它最后一条经过；最多 1000 条
//     去向们：同一模块、同一状态、同一原因的合在一起计数，多的在前
//     改动：{ 已写入, 不提交, 待提交, 不提交原因: [{ 表, 编号, 原因 }] }
import fs from 'node:fs';
import path from 'node:path';
import { openSqlite } from '../../../共用/工具/sqlite.mjs';

const 运行文件夹 = /^\d{4}-\d{2}-\d{2}(?:-\d{2})?$/;
const 最多条目 = 1000;
const 最多原因 = 200;
const 解析 = text => { try { return JSON.parse(text); } catch { return null; } };

export function 列出几晚({ 根 }) {
  if (!根 || !fs.existsSync(根)) return [];
  return fs.readdirSync(根).filter(名 => 运行文件夹.test(名) && fs.existsSync(path.join(根, 名, 'run.db'))).sort().reverse();
}

function 读报告(目录) {
  const file = path.join(目录, 'report.md');
  const 文 = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const 取 = 项 => new RegExp(`^- ${项}：(.+)$`, 'm').exec(文)?.[1].trim() || '';
  return { 开始: 取('开始'), 结束: 取('结束'), 方式: 取('方式') || '不知道', 结果: 取('结果') || '不知道' };
}

export function 读一晚({ 根, 名 }) {
  if (!运行文件夹.test(String(名))) throw new Error(`${名} 不是运行文件夹的名字`);
  const 目录 = path.join(根, 名);
  const file = path.join(目录, 'run.db');
  if (!fs.existsSync(file)) throw new Error(`${名} 没有 run.db`);
  const 报告 = 读报告(目录);
  const db = openSqlite(file, { readonly: true, fileMustExist: true });
  try {
    const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map(r => [r.key, r.value]));
    const 当晚 = 解析(meta.当晚信息) || {};
    const 模块们 = db.prepare('SELECT * FROM modules ORDER BY COALESCE(started_at, finished_at), name').all().map(m => {
      const stats = 解析(m.stats);
      return { 模块: m.name, 状态: m.status, 开始: m.started_at || '', 结束: m.finished_at || '', 处理: stats?.items ?? null, 各状态: stats?.byStatus || {},
        改动: stats?.changes ?? null, 问题: stats?.problems || [], 错误: m.error || '' };
    });
    const 条目们 = db.prepare(`SELECT i.key, i.status, i.data, t.module, t.reason FROM items i
      LEFT JOIN trail t ON t.id = (SELECT MAX(id) FROM trail WHERE key = i.key) ORDER BY i.rowid LIMIT ?`).all(最多条目).map(r => {
      const data = 解析(r.data) || {};
      return { 网址: data.url || r.key, 名称: data.name || '', 状态: r.status, 模块: r.module || '', 原因: r.reason || '' };
    });
    const 计数 = new Map();
    for (const e of 条目们) {
      const 键 = `${e.模块}|${e.状态}|${e.原因}`;
      计数.set(键, { 模块: e.模块, 状态: e.状态, 原因: e.原因, 次数: (计数.get(键)?.次数 || 0) + 1 });
    }
    const 去向们 = [...计数.values()].sort((a, b) => b.次数 - a.次数 || a.模块.localeCompare(b.模块));
    const 按结果 = Object.fromEntries(db.prepare('SELECT result, COUNT(*) n FROM changes GROUP BY result').all().map(r => [r.result, r.n]));
    const 不提交原因 = db.prepare("SELECT tbl, row_key, reason FROM changes WHERE result = '不提交' ORDER BY id LIMIT ?").all(最多原因)
      .map(r => ({ 表: r.tbl, 编号: r.row_key, 原因: r.reason }));
    return {
      名, 开始: 报告.开始 || meta.created_at || '', 结束: 报告.结束, 方式: 报告.方式, 结果: 报告.结果,
      搜索词们: (当晚.计划?.搜索词们 || []).map(x => x.词).filter(Boolean), 候选: 当晚.候选 ?? null,
      模块们, 条目们, 去向们,
      改动: { 已写入: 按结果.已写入 || 0, 不提交: 按结果.不提交 || 0, 待提交: 按结果.待提交 || 0, 不提交原因 },
    };
  } finally {
    db.close();
  }
}

// 读候选网站：给每周统计“建议屏蔽的网站”用（美国/屏蔽网站建议，2026-11-02 搬自 site-block-suggest.mjs）。
// 近 天数 天正式跑的每一晚（试跑的不算，免得同一批结果算两次），01 搜到的每条候选：
//   读了详情：到过 04 读详情（旧的“前置筛选放行去读详情”）
//   追溯了：交给过 03 的 Codex 代理追踪；追溯找到：追到了官方来源（旧的“通知追溯 found_official”）
//   读候选网站({ 根, 天数, now }) → [{ 名, 候选们: [{ 网址, 名称, 读了详情, 追溯了, 追溯找到 }] }]，新的晚上在前
const DAY_MS = 24 * 3600 * 1000;
const 北京日期 = t => new Date(t.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

export function 读候选网站({ 根, 天数 = 30, now = new Date() }) {
  const 从哪天 = 北京日期(new Date(now.getTime() - (天数 - 1) * DAY_MS));
  return 列出几晚({ 根 }).filter(名 => 名.slice(0, 10) >= 从哪天 && !/试跑/.test(读报告(path.join(根, 名)).方式)).map(名 => {
    const db = openSqlite(path.join(根, 名, 'run.db'), { readonly: true, fileMustExist: true });
    try {
      const 候选们 = db.prepare(`SELECT i.key, i.data,
          EXISTS (SELECT 1 FROM trail t WHERE t.key = i.key AND t.module IN ('04-extract', '05-review', '06-ingest')) AS 读了详情,
          EXISTS (SELECT 1 FROM trail t WHERE t.key = i.key AND t.reason LIKE '%Codex代理追踪%') AS 追溯了,
          EXISTS (SELECT 1 FROM trail t WHERE t.key = i.key AND t.reason LIKE '%已追溯到官方来源%') AS 追溯找到
        FROM items i WHERE i.kind = 'candidate' AND i.created_by = '01-search' ORDER BY i.rowid`).all()
        .map(r => {
          const data = 解析(r.data) || {};
          return { 网址: data.url || r.key, 名称: data.name || '', 读了详情: Boolean(r.读了详情), 追溯了: Boolean(r.追溯了), 追溯找到: Boolean(r.追溯找到) };
        });
      return { 名, 候选们 };
    } finally {
      db.close();
    }
  });
}
