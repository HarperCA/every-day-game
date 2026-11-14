// 补搜索记忆（2026-11-07）：线上库早已建好，003 加的搜索记忆表是空的。部署后跑一次，给每个还没有搜索记忆的比赛（含回收站里的）
// 写上初始的一份（有官网的写上域名并注明还没核实，其余留空），已有的不动。以后新建的比赛由新维护第一次改记忆时从初始开始写。
//   node backend/美国/db/建库/补搜索记忆.mjs [--库 <库文件>] [--dry-run]     不给 --库 用 DB_DIR/比赛库.db
// 库文件不存在时报错，不新建空库。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDbFile, openDb, 搜索记忆 } from '../index.mjs';

export function 补搜索记忆({ 库 = defaultDbFile(), 试跑 = false } = {}) {
  if (!fs.existsSync(库)) throw new Error(`库文件 ${库} 不存在`);
  const db = openDb({ file: 库 });
  try {
    return { ...搜索记忆.补齐(db, { 试跑, 操作人: '补搜索记忆' }), 试跑 };
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--库');
  const 结果 = 补搜索记忆({ ...(i >= 0 ? { 库: argv[i + 1] } : {}), 试跑: argv.includes('--dry-run') });
  console.log(JSON.stringify({ ...结果, 新建: 结果.新建.length }, null, 1));
}
