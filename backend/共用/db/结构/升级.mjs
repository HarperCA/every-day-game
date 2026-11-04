// 把 结构/ 里还没执行过的编号文件按顺序补执行；执行过的编号记在库里的 schema_version 表。
// 每个文件在一个事务里执行，中途出错这个文件整个撤回，库停在上一个编号。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function structureFiles(dir = HERE) {
  return fs.readdirSync(dir).filter(name => /^\d{3}-.+\.sql$/.test(name)).sort()
    .map(name => ({ number: Number(name.slice(0, 3)), name, file: path.join(dir, name) }));
}

export function migrate(sqlite, { dir = HERE, now = () => new Date() } = {}) {
  sqlite.exec('CREATE TABLE IF NOT EXISTS schema_version (number INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const done = new Set(sqlite.prepare('SELECT number FROM schema_version').all().map(row => row.number));
  const applied = [];
  for (const item of structureFiles(dir)) {
    if (done.has(item.number)) continue;
    const sql = fs.readFileSync(item.file, 'utf8');
    sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite.prepare('INSERT INTO schema_version (number, name, applied_at) VALUES (?, ?, ?)').run(item.number, item.name, now().toISOString());
    })();
    applied.push(item.name);
  }
  return applied;
}
