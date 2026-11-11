// 届次对照：每一届属于哪个比赛（含回收站里的），2026-11-02。
// 给北京搬旧用户数据用：旧的上海收藏挂届次，新的收藏挂比赛，北京主数据库只有公开的届次，挂在后来删掉、转审核的届次上的旧收藏得靠这份对上。
//   届次对照(db) → { 届次编号: 比赛编号 }
//   node backend/美国/db/建库/届次对照.mjs --出 <文件.json>     比赛库只读打开（默认 DB_DIR/比赛库.db，或 --库 指定）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../index.mjs';

export function 届次对照(db) {
  return Object.fromEntries(db.find('edition', {}, { orderBy: 'id', 包括已删除: true }).map(e => [e.id, e.competition_id]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const 参数 = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const 出 = 参数('--出');
  if (!出) { console.error('要给 --出 <文件.json>'); process.exit(1); }
  const db = openDb({ ...(参数('--库') ? { file: 参数('--库') } : {}), readOnly: true });
  const 对照 = 届次对照(db);
  fs.mkdirSync(path.dirname(path.resolve(出)), { recursive: true });
  fs.writeFileSync(出, JSON.stringify(对照, null, 1), 'utf8');
  console.log(`届次对照：${Object.keys(对照).length} 届，写到 ${出}`);
  db.close();
}
