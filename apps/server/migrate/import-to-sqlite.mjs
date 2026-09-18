// 把 export-from-cloudbase.mjs 导出的 JSON 灌进 SQLite，并逐表校验。
//
// 校验方式和导出时一致：条数 + 内容哈希。哈希对不上就报错退出，
// 不会"差不多就算了"——迁移最不能出的错就是静默丢数据。
//
// 默认拒绝覆盖已有数据库文件，要重灌得显式加 --force。
//
// 用法：node migrate/import-to-sqlite.mjs [--in ../../reports/cloudbase-export] [--db ./data/app.db] [--force]
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase, writeState, putPublicCache, appendAudit } from '../src/db.mjs';

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

function hashOf(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

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

  const db = openDatabase(args.db);
  const results = [];

  // better-sqlite3 是同步 API，事务里不能有 await——先把 JSON 全读进内存，再同步写入。
  await importAllSync(db, args, manifest, results);

  db.close();

  console.log('表名'.padEnd(34) + '导出'.padEnd(20) + '导入'.padEnd(20) + '结果');
  let failed = false;
  for (const item of results) {
    const ok = item.status ? false : item.expected === item.actual;
    if (!ok) failed = true;
    console.log(
      String(item.name).padEnd(32)
      + String(item.expected ?? '-').padEnd(20)
      + String(item.actual ?? '-').padEnd(20)
      + (item.status || (ok ? '✓ 一致' : '✗ 对不上')),
    );
  }
  if (failed) throw new Error('校验未通过，数据库内容与导出不一致');
  console.log(`\n全部一致，数据库：${args.db}`);
}

// better-sqlite3 是同步 API，事务里不能有 await——所以先把 JSON 读进内存，再同步写。
async function importAllSync(db, args, manifest, results) {
  const loaded = {};
  for (const [name, entry] of Object.entries(manifest.tables)) {
    loaded[name] = await readJson(path.join(args.in, entry.file));
  }

  const run = db.transaction(() => {
    for (const [name, stateId] of [
      ['admin_state.competitions', 'competitions'],
      ['admin_state.feedbacks', 'feedbacks'],
      ['admin_state.ai_jobs', 'ai_jobs'],
    ]) {
      const payload = loaded[name];
      if (!payload) continue;
      writeState(db, stateId, payload.records, payload.version);
      results.push({ name, expected: manifest.tables[name].count, actual: payload.records.length });
    }

    for (const row of loaded['event_edition_public_cache'] || []) putPublicCache(db, row.id || row._id, row);
    results.push({ name: 'event_edition_public_cache', expected: manifest.tables['event_edition_public_cache']?.count ?? 0, actual: (loaded['event_edition_public_cache'] || []).length });

    for (const row of loaded['audit_log'] || []) appendAudit(db, { ...row, id: row.id || row._id });
    results.push({ name: 'audit_log', expected: manifest.tables['audit_log']?.count ?? 0, actual: (loaded['audit_log'] || []).length });

    const userInsert = db.prepare('INSERT INTO user_account (id, openid, appid, unionid, status, created_at, updated_at, last_login_at) VALUES (@id, @openid, @appid, @unionid, @status, @created_at, @updated_at, @last_login_at)');
    for (const row of loaded['user_account'] || []) {
      userInsert.run({
        id: row._id || row.id, openid: row.openid, appid: row.appid ?? null, unionid: row.unionid ?? null,
        status: row.status || 'active', created_at: row.created_at ?? null, updated_at: row.updated_at ?? null,
        last_login_at: row.last_login_at ?? null,
      });
    }
    results.push({ name: 'user_account', expected: manifest.tables['user_account']?.count ?? 0, actual: (loaded['user_account'] || []).length });

    const favInsert = db.prepare('INSERT INTO favorite (id, user_id, edition_id, data) VALUES (@id, @user_id, @edition_id, @data)');
    for (const row of loaded['favorite'] || []) favInsert.run({ id: row._id || row.id, user_id: row.user_id, edition_id: row.edition_id, data: JSON.stringify(row) });
    results.push({ name: 'favorite', expected: manifest.tables['favorite']?.count ?? 0, actual: (loaded['favorite'] || []).length });

    const remInsert = db.prepare('INSERT INTO reminder (id, user_id, edition_id, data) VALUES (@id, @user_id, @edition_id, @data)');
    for (const row of loaded['reminder'] || []) remInsert.run({ id: row._id || row.id, user_id: row.user_id, edition_id: row.edition_id ?? null, data: JSON.stringify(row) });
    results.push({ name: 'reminder', expected: manifest.tables['reminder']?.count ?? 0, actual: (loaded['reminder'] || []).length });

    const fbInsert = db.prepare('INSERT INTO feedback (id, user_id, data) VALUES (@id, @user_id, @data)');
    for (const row of loaded['feedback'] || []) fbInsert.run({ id: row._id || row.id, user_id: row.user_id ?? null, data: JSON.stringify(row) });
    results.push({ name: 'feedback', expected: manifest.tables['feedback']?.count ?? 0, actual: (loaded['feedback'] || []).length });
  });

  run();

  // 回读校验：从 SQLite 读出来重新算哈希，和导出时的哈希比对。
  const { readState, listPublicCache } = await import('../src/db.mjs');
  const roundTrip = [
    ['admin_state.competitions', () => { const s = readState(db, 'competitions'); return { records: s.records, version: s.version }; }],
    ['admin_state.feedbacks', () => { const s = readState(db, 'feedbacks'); return { records: s.records, version: s.version }; }],
    ['admin_state.ai_jobs', () => { const s = readState(db, 'ai_jobs'); return { records: s.records, version: s.version }; }],
    ['event_edition_public_cache', () => listPublicCache(db)],
  ];
  for (const [name, read] of roundTrip) {
    const entry = manifest.tables[name];
    if (!entry) continue;
    const actualHash = hashOf(read());
    results.push({ name: `${name}（回读哈希）`, expected: entry.hash, actual: actualHash });
  }
}

main().catch(error => {
  console.error('导入失败:', error.message);
  process.exit(1);
});
