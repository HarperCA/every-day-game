// 把 export-from-cloudbase.mjs 导出的 JSON 灌进 SQLite。
//
// 映射是直给的：CloudBase 里「集合 + 文档」在这边还是「集合 + 文档」，
// 字段一个不动。这样云函数代码读到的东西和在 CloudBase 上读到的完全一样。
//
// 校验：条数 + 内容哈希，对不上直接报错退出，不"差不多就算了"——
// 迁移最不能出的错就是静默丢数据。
//
// 用法：node migrate/import-to-sqlite.mjs [--in ../../reports/cloudbase-export] [--db ./data/app.db] [--force]
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase, putDoc, listDocs, getDoc } from '../src/db.mjs';
import { canonicalHash } from './canonical.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

function parseArgs(argv) {
  const args = {
    in: path.join(REPO_ROOT, 'reports', 'cloudbase-export'),
    db: path.join(HERE, '..', 'data', 'app.db'),
    force: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') args.in = path.resolve(argv[i + 1]);
    if (argv[i] === '--db') args.db = path.resolve(argv[i + 1]);
    if (argv[i] === '--force') args.force = true;
  }
  return args;
}

// 规范化哈希：比内容，不比键顺序（见 canonical.mjs）
const hashOf = canonicalHash;
const readJson = async file => JSON.parse(await fsp.readFile(file, 'utf8'));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = await readJson(path.join(args.in, 'manifest.json'));

  if (fs.existsSync(args.db) && !args.force) {
    throw new Error(`数据库已存在：${args.db}。确认要重灌请加 --force`);
  }
  if (fs.existsSync(args.db) && args.force) {
    // WAL 模式下还有 -wal/-shm 两个附属文件，一起清掉，否则会读到旧数据。
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${args.db}${suffix}`, { force: true });
  }

  // better-sqlite3 是同步 API，事务里不能有 await——先把 JSON 全读进内存。
  const loaded = {};
  for (const [name, entry] of Object.entries(manifest.tables)) {
    loaded[name] = await readJson(path.join(args.in, entry.file));
  }

  const db = openDatabase(args.db);
  const results = [];

  db.transaction(() => {
    // admin_state：三个文档，每个是「整表 records + 版本号」，
    // 和 CloudBase 里的形状完全一致，云函数 loadState 能直接读。
    for (const [name, docId] of [
      ['admin_state.competitions', 'competitions'],
      ['admin_state.feedbacks', 'feedbacks'],
      ['admin_state.ai_jobs', 'ai_jobs'],
    ]) {
      const payload = loaded[name];
      if (!payload) continue;
      putDoc(db, 'admin_state', docId, {
        records: payload.records,
        version: payload.version,
        updated_at: new Date().toISOString(),
        updated_by: 'migration',
      });
      results.push({ name, expected: manifest.tables[name].count, actual: payload.records.length });
    }

    // 其余集合：一行一个文档，字段原样搬。
    for (const [name, collection] of [
      ['event_edition_public_cache', 'event_edition_public_cache'],
      ['audit_log', 'audit_log'],
      ['user_account', 'user_account'],
      ['favorite', 'favorite'],
      ['reminder', 'reminder'],
      ['feedback', 'feedback'],
    ]) {
      const rows = loaded[name] || [];
      for (const row of rows) {
        const id = row._id || row.id;
        if (!id) throw new Error(`${name} 里有记录没有 id，拒绝导入：${JSON.stringify(row).slice(0, 120)}`);
        // _id 是 CloudBase 的主键字段，存进去时去掉，读出来时由存储层补上，
        // 避免同一个值在文档里和主键里各存一份、以后改了一个忘了另一个。
        const { _id, ...rest } = row;
        putDoc(db, collection, String(id), rest);
      }
      results.push({ name, expected: manifest.tables[name]?.count ?? 0, actual: rows.length });
    }
  })();

  // 回读校验：从 SQLite 读出来重新算哈希，和导出时的哈希比。
  for (const [name, read] of [
    ['admin_state.competitions', () => { const d = getDoc(db, 'admin_state', 'competitions'); return { records: d.records, version: d.version }; }],
    ['admin_state.feedbacks', () => { const d = getDoc(db, 'admin_state', 'feedbacks'); return { records: d.records, version: d.version }; }],
    ['admin_state.ai_jobs', () => { const d = getDoc(db, 'admin_state', 'ai_jobs'); return { records: d.records, version: d.version }; }],
    // 回读保留 _id：存储层读出来会补上它，导出时原始数据里也有，
    // 两边口径一致才是真比对。audit_log 本来就没有 _id，补上的是 id 的同值副本，
    // 所以这里按导出原文里有没有 _id 来决定。
    ['audit_log', () => listDocs(db, 'audit_log').map(row => { const { _id, ...rest } = row; return rest; })],
    ['reminder', () => listDocs(db, 'reminder')],
  ]) {
    const entry = manifest.tables[name];
    if (!entry) continue;
    results.push({ name: `${name}（哈希）`, expected: entry.hash, actual: hashOf(read()) });
  }

  db.close();

  console.log('表名'.padEnd(34) + '导出'.padEnd(20) + '导入'.padEnd(20) + '结果');
  let failed = false;
  for (const item of results) {
    const ok = item.expected === item.actual;
    if (!ok) failed = true;
    console.log(String(item.name).padEnd(32) + String(item.expected).padEnd(20) + String(item.actual).padEnd(20) + (ok ? '✓ 一致' : '✗ 对不上'));
  }
  if (failed) throw new Error('校验未通过，数据库内容与导出不一致');
  console.log(`\n全部一致，数据库：${args.db}`);
}

main().catch(error => {
  console.error('导入失败:', error.message);
  process.exit(1);
});
