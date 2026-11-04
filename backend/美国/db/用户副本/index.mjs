// 用户副本：北京用户库（和报错库）同步到美国的只读副本（2026-11-02，用户定用户数据传回美国）。正本在北京，美国只读。
// 只有 沟通/用户数据同步/美国端.mjs 写；后台用 readOnly 打开读（访问异常、问卷统计、意见反馈、纠错审核）。
//   open({ file, readOnly, now })            打开（默认 DB_DIR/用户副本.db）
//   写(db, [{ 表, 编号, data }], { now, 轮次 })  有就覆盖、没有就加；整体重推时带轮次
//   删(db, [{ 表, 编号 }]) → 删了几条          没有的不报错
//   收尾(db, 轮次) → 清掉几条                   整体重推写完后，这一轮没写到的（北京已经没有了）清掉
//   列出(db, 表) → [data]   一条(db, 表, 编号) → data | null   条数(db) → { 表: 条数 }
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../../共用/db/index.mjs';
import { 同步来的表 } from './描述/北京副本.mjs';
import { TABLES } from './结构/生成.mjs';

export { 同步来的表 };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const 表名 = 'beijing_copy';
export const STRUCTURE_DIR = path.join(HERE, '结构');
export const 默认文件 = () => path.join(process.env.DB_DIR || path.join(HERE, '..', '数据'), '用户副本.db');
const 键 = (表, 编号) => `${表}:${编号}`;

export function open({ file = 默认文件(), readOnly = false, now } = {}) {
  return openDb({ file, tables: TABLES, structureDir: STRUCTURE_DIR, readOnly, now });
}

export function 写(db, 条们, { now = new Date(), 轮次 = null } = {}) {
  return db.transaction(tx => {
    for (const { 表, 编号, data } of 条们) {
      const 行 = { table_name: 表, row_id: String(编号), data, round: 轮次, synced_at: now.toISOString() };
      if (tx.get(表名, 键(表, 编号))) tx.update(表名, 键(表, 编号), 行);
      else tx.insert(表名, 键(表, 编号), 行);
    }
    return 条们.length;
  });
}

export function 删(db, 键们) {
  return db.transaction(tx => {
    let 删了 = 0;
    for (const { 表, 编号 } of 键们) if (tx.get(表名, 键(表, 编号))) { tx.remove(表名, 键(表, 编号)); 删了 += 1; }
    return 删了;
  });
}

export function 收尾(db, 轮次) {
  return db.transaction(tx => {
    const 多的 = tx.find(表名, {}).filter(r => r.round !== 轮次);
    for (const r of 多的) tx.remove(表名, r.id);
    return 多的.length;
  });
}

export const 列出 = (db, 表) => db.find(表名, { table_name: 表 }, { orderBy: 'row_id' }).map(r => r.data);
export const 一条 = (db, 表, 编号) => db.get(表名, 键(表, 编号))?.data.data ?? null;
export function 条数(db) {
  const 数 = {};
  for (const r of db.find(表名, {})) 数[r.table_name] = (数[r.table_name] || 0) + 1;
  return 数;
}
