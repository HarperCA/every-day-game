// 搜索词的记录表：每个搜索词上次什么时候搜、搜到几条、连续几次零候选、暂停到什么时候、一共搜过几次。
// 只给本文件夹的 index.mjs 用。库文件默认在 搜索词/数据/搜索词记录.db（不进 git）。
//
// 冷却规则从旧的 search-plan.mjs 搬来（updateCooldown）：零候选累计两次起暂停 2^(n-1) 天，最长 32 天；有产出就恢复。
//
//   读历史(file)            → { [词]: { 路线, 上次搜索, 上次候选数, 连续零候选, 暂停到, 搜过次数 } }；没有库文件时是 {}，也不建文件
//   打开记录表(file)        → { 读历史(), 写入(每个词: [{ 词, 路线, 候选数 }], now), close() }；自动建文件夹和表
//   更新冷却(历史, 每个词, now) 纯函数，交回新的历史，不改传进来的
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSqlite } from '../../../../../共用/工具/sqlite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const 默认文件 = path.join(HERE, '数据', '搜索词记录.db');
const 天 = 86400000;

const 建表 = `CREATE TABLE IF NOT EXISTS search_term (
  term TEXT PRIMARY KEY,
  route TEXT,
  last_searched_at TEXT,
  last_candidates INTEGER,
  zero_streak INTEGER NOT NULL DEFAULT 0,
  paused_until TEXT,
  times_searched INTEGER NOT NULL DEFAULT 0
)`;

export function 更新冷却(历史, 每个词, now) {
  const 新 = { ...历史 };
  for (const { 词, 路线, 候选数 } of 每个词 || []) {
    const 旧 = 新[词] || {};
    const 连续零候选 = 候选数 > 0 ? 0 : (旧.连续零候选 || 0) + 1;
    const 暂停天数 = 连续零候选 >= 2 ? Math.min(32, 2 ** (连续零候选 - 1)) : 0;
    新[词] = { 路线: 路线 ?? 旧.路线 ?? null, 上次搜索: now.toISOString(), 上次候选数: 候选数, 连续零候选,
      暂停到: 暂停天数 ? new Date(now.getTime() + 暂停天数 * 天).toISOString() : null, 搜过次数: (旧.搜过次数 || 0) + 1 };
  }
  return 新;
}

const 读出 = db => Object.fromEntries(db.prepare('SELECT * FROM search_term').all().map(r => [r.term, {
  路线: r.route, 上次搜索: r.last_searched_at, 上次候选数: r.last_candidates, 连续零候选: r.zero_streak, 暂停到: r.paused_until, 搜过次数: r.times_searched,
}]));

export function 打开记录表(file = 默认文件) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openSqlite(file);
  db.exec(建表);
  const 存 = db.prepare(`INSERT INTO search_term (term, route, last_searched_at, last_candidates, zero_streak, paused_until, times_searched)
    VALUES (@term, @route, @last_searched_at, @last_candidates, @zero_streak, @paused_until, @times_searched)
    ON CONFLICT(term) DO UPDATE SET route = excluded.route, last_searched_at = excluded.last_searched_at, last_candidates = excluded.last_candidates,
      zero_streak = excluded.zero_streak, paused_until = excluded.paused_until, times_searched = excluded.times_searched`);
  return {
    读历史: () => 读出(db),
    写入: db.transaction((每个词, now) => {
      const 新 = 更新冷却(读出(db), 每个词, now);
      for (const { 词 } of 每个词) {
        const x = 新[词];
        存.run({ term: 词, route: x.路线, last_searched_at: x.上次搜索, last_candidates: x.上次候选数, zero_streak: x.连续零候选, paused_until: x.暂停到, times_searched: x.搜过次数 });
      }
    }),
    close: () => db.close(),
  };
}

export function 读历史(file = 默认文件) {
  if (!fs.existsSync(file)) return {};
  const db = openSqlite(file, { readonly: true });
  try {
    const 有表 = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'search_term'").get();
    return 有表 ? 读出(db) : {};
  } finally { db.close(); }
}
