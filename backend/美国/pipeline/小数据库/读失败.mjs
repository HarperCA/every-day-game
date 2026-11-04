// 读失败：给后台“失败任务”页读最近几晚的 run.db（2026-11-01 用户定：失败任务只看）。只读打开，不改文件。
// 交回两种失败：整个模块失败（关键模块失败整晚停下；非关键的记“跳过”继续），和标成“失败”的条目（原因取它最后一条失败的经过）。
// 已丢弃、顺延不算失败。运行文件夹按北京时间日期命名（2026-11-01、2026-11-01-02），只读最近 天数 天的。
// 只用自己和 共用/工具，根目录由调用方给（后台用 pipeline/shared/paths.mjs 的 logRoot()）。
//
//   读最近失败({ 根, 天数, now }) → [{ 哪一晚, 时间, 环节, 对象, 网址, 原因, 整晚停下 }]，新的晚上在前
import fs from 'node:fs';
import path from 'node:path';
import { openSqlite } from '../../../共用/工具/sqlite.mjs';

const 运行文件夹 = /^(\d{4}-\d{2}-\d{2})(?:-\d{2})?$/;
const DAY_MS = 24 * 3600 * 1000;
const 北京日期 = t => new Date(t.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

function 一晚(file, 哪一晚) {
  const db = openSqlite(file, { readonly: true, fileMustExist: true });
  try {
    const 模块们 = db.prepare("SELECT name, status, started_at, finished_at, error FROM modules WHERE status IN ('失败', '跳过') ORDER BY COALESCE(finished_at, started_at) DESC").all()
      .map(m => ({ 哪一晚, 时间: m.finished_at || m.started_at || '', 环节: m.name, 对象: '整个模块', 网址: '', 原因: m.error || '', 整晚停下: m.status === '失败' }));
    const 条目们 = db.prepare(`SELECT i.key, i.data, t.module, t.reason, t.at FROM items i
      JOIN trail t ON t.id = (SELECT MAX(id) FROM trail WHERE key = i.key AND status = '失败')
      WHERE i.status = '失败' ORDER BY t.at DESC`).all()
      .map(r => {
        const data = JSON.parse(r.data || '{}');
        return { 哪一晚, 时间: r.at, 环节: r.module, 对象: data.name || data.url || r.key, 网址: data.url || '', 原因: r.reason, 整晚停下: false };
      });
    return [...模块们, ...条目们].sort((a, b) => String(b.时间).localeCompare(String(a.时间)));
  } finally {
    db.close();
  }
}

export function 读最近失败({ 根, 天数 = 7, now = new Date() }) {
  if (!根 || !fs.existsSync(根)) return [];
  const 从哪天 = 北京日期(new Date(now.getTime() - (天数 - 1) * DAY_MS));
  const 晚上们 = fs.readdirSync(根).filter(名 => 运行文件夹.exec(名)?.[1] >= 从哪天).sort().reverse();
  return 晚上们.flatMap(名 => {
    const file = path.join(根, 名, 'run.db');
    if (!fs.existsSync(file)) return [];
    try { return 一晚(file, 名); } catch (error) {
      return [{ 哪一晚: 名, 时间: '', 环节: '读运行记录', 对象: 'run.db', 网址: '', 原因: `打不开：${error?.message || error}`, 整晚停下: false }];
    }
  });
}
