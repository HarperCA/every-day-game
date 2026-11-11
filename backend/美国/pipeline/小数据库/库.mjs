// 当晚的小数据库 run.db：模块之间的交接都在这里，总库在流程运行期间只读。
//
// 表：
//   meta     运行编号、格式版本、创建时间
//   items    每条候选或记录一行：编号 key、类型 kind、状态 status、最后经过的模块 stage、全部字段 data
//   trail    每条在每个模块里的结果和原因（逐条去向）
//   blobs    网页正文等大块内容，按内容指纹只存一份；items 里只记指纹
//   changes  待写进总库的改动：哪张表、哪一行、新增还是修改、改成什么、读取时的版本号、哪个模块提的
//   modules  每个模块的运行状态，接着跑就看这张表
//   calls    每次调用外部接口的记账
//
// 谁都不直接碰这些表，只调下面交回的接口。写入结果（写入结果）先过格式检查（交接检查.mjs），合格才用一个事务一次写入，
// 所以模块中途出错时这里什么都不会留下，重跑这个模块也不会重复。
// 查找、删除、标记线索给模块在运行中途用：删除是把条目标成“已丢弃”、标记线索是标成“线索”，都写明原因，条目和经过都留着；
// 模块出错时总控按经过撤回它改的。
import crypto from 'node:crypto';
import { openSqlite } from '../../../共用/工具/sqlite.mjs';
import { checkModuleOutput, summarize } from './交接检查.mjs';

export const RUNDB_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items (
  key TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL,
  data TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS items_status ON items(status, kind);
CREATE TABLE IF NOT EXISTS trail (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, module TEXT NOT NULL,
  status TEXT NOT NULL, result TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', at TEXT NOT NULL,
  prev_stage TEXT, prev_status TEXT, prev_kind TEXT, prev_data TEXT);
CREATE INDEX IF NOT EXISTS trail_key ON trail(key);
CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, length INTEGER NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, item_key TEXT,
  tbl TEXT NOT NULL, row_key TEXT NOT NULL, op TEXT NOT NULL, payload TEXT NOT NULL, base_version INTEGER,
  result TEXT NOT NULL DEFAULT '待提交', reason TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS modules (
  name TEXT PRIMARY KEY, status TEXT NOT NULL, started_at TEXT, finished_at TEXT, stats TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT, provider TEXT NOT NULL, ok INTEGER NOT NULL,
  tokens INTEGER, cost REAL, ms INTEGER, note TEXT, at TEXT NOT NULL);
`;

const now = () => new Date().toISOString();
const parse = row => (row ? { ...row, data: JSON.parse(row.data) } : null);

export function openRunDb(file, { runId } = {}) {
  const db = openSqlite(file);
  db.exec(SCHEMA);
  const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
  const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const version = getMeta.get('version')?.value;
  if (version && Number(version) !== RUNDB_VERSION) {
    db.close();
    throw new Error(`run.db 的格式版本是 ${version}，现在的代码只认 ${RUNDB_VERSION}，不能拿旧结果接着跑`);
  }
  if (!version) {
    setMeta.run('version', String(RUNDB_VERSION));
    setMeta.run('created_at', now());
  }
  if (runId) setMeta.run('run_id', runId);

  const st = {
    item: db.prepare('SELECT * FROM items WHERE key = ?'),
    items: db.prepare('SELECT * FROM items WHERE status = ? ORDER BY rowid'),
    setStatus: db.prepare('UPDATE items SET status = ?, stage = ?, updated_at = ? WHERE key = ?'),
    upsertItem: db.prepare(`INSERT INTO items (key, kind, status, stage, data, created_by, updated_at) VALUES (@key, @kind, @status, @stage, @data, @stage, @at)
      ON CONFLICT(key) DO UPDATE SET kind = excluded.kind, status = excluded.status, stage = excluded.stage, data = excluded.data, updated_at = excluded.updated_at`),
    trail: db.prepare(`INSERT INTO trail (key, module, status, result, reason, at, prev_stage, prev_status, prev_kind, prev_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    trailByModule: db.prepare('SELECT * FROM trail WHERE module = ? ORDER BY id DESC'),
    deleteItem: db.prepare('DELETE FROM items WHERE key = ?'),
    restoreItem: db.prepare('UPDATE items SET status = ?, stage = ?, kind = ?, data = ?, updated_at = ? WHERE key = ?'),
    deleteTrail: db.prepare('DELETE FROM trail WHERE module = ?'),
    deleteChanges: db.prepare('DELETE FROM changes WHERE module = ?'),
    deleteModule: db.prepare('DELETE FROM modules WHERE name = ?'),
    deleteCalls: db.prepare('DELETE FROM calls WHERE module = ?'),
    trailOf: db.prepare('SELECT module, status, result, reason, at FROM trail WHERE key = ? ORDER BY id'),
    change: db.prepare('INSERT INTO changes (module, item_key, tbl, row_key, op, payload, base_version, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    changes: db.prepare('SELECT * FROM changes ORDER BY id'),
    pendingFor: db.prepare(`SELECT * FROM changes WHERE tbl = ? AND row_key = ? AND result = '待提交' ORDER BY id`),
    markChange: db.prepare('UPDATE changes SET result = ?, reason = ? WHERE id = ?'),
    blobPut: db.prepare('INSERT OR IGNORE INTO blobs (hash, kind, length, body) VALUES (?, ?, ?, ?)'),
    blobGet: db.prepare('SELECT body FROM blobs WHERE hash = ?'),
    moduleGet: db.prepare('SELECT * FROM modules WHERE name = ?'),
    moduleAll: db.prepare('SELECT * FROM modules'),
    moduleSet: db.prepare(`INSERT INTO modules (name, status, started_at, finished_at, stats, error) VALUES (@name, @status, @started_at, @finished_at, @stats, @error)
      ON CONFLICT(name) DO UPDATE SET status = excluded.status, started_at = COALESCE(excluded.started_at, modules.started_at),
      finished_at = excluded.finished_at, stats = excluded.stats, error = excluded.error`),
    call: db.prepare('INSERT INTO calls (module, provider, ok, tokens, cost, ms, note, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    counts: db.prepare('SELECT status, COUNT(*) AS n FROM items GROUP BY status'),
  };

  // 一个模块交回的结果，一次性写入：条目、去向、待写改动、模块状态
  const writeModuleOutput = db.transaction((module, output, stats) => {
    const at = now();
    for (const item of output.items) {
      // 先记下这一条改之前的样子：重跑这个模块时，靠它把条目恢复原状
      const before = st.item.get(item.key);
      st.upsertItem.run({ key: item.key, kind: item.kind, status: item.status, stage: module, data: JSON.stringify(item.data), at });
      st.trail.run(item.key, module, item.status, item.result || item.status, item.reason || '', at,
        before?.stage ?? null, before?.status ?? null, before?.kind ?? null, before?.data ?? null);
    }
    for (const c of output.changes) {
      st.change.run(module, c.itemKey ?? null, c.table, c.key, c.op, JSON.stringify(c.payload), c.baseVersion ?? null, at);
    }
    st.moduleSet.run({ name: module, status: '完成', started_at: null, finished_at: at, stats: JSON.stringify(stats), error: null });
  });

  // 撤销某几个模块写过的全部东西（从后往前撤），用于从中间某个模块重新跑
  const clearModules = db.transaction(names => {
    for (const name of names) {
      for (const row of st.trailByModule.all(name)) {
        if (row.prev_status === null) st.deleteItem.run(row.key);
        else st.restoreItem.run(row.prev_status, row.prev_stage, row.prev_kind, row.prev_data, now(), row.key);
      }
      st.deleteTrail.run(name);
      st.deleteChanges.run(name);
      st.deleteCalls.run(name);
      st.deleteModule.run(name);
    }
  });

  // 删除（标成已丢弃）、标记线索：一批条目改状态，一个事务，有一条不对就一条都不改。经过里记下改之前的样子，撤销这个模块时恢复
  const 改状态 = (名, status) => db.transaction((module, 列表) => {
    const at = now();
    for (const { key, 原因 } of 列表) {
      if (!原因) throw new Error(`${名} ${key} 要写原因`);
      const before = st.item.get(key);
      if (!before) throw new Error(`${名}：找不到条目 ${key}`);
      if (before.status !== '进行中') throw new Error(`${名}：条目 ${key} 不是进行中（现在是${before.status}）`);
      st.setStatus.run(status, module, at, key);
      st.trail.run(key, module, status, status, 原因, at, before.stage, before.status, before.kind, before.data);
    }
    return { [名]: 列表.length };
  });
  const 删除 = 改状态('删除', '已丢弃');
  const 标记线索 = 改状态('线索', '线索');

  // 对外的写入接口：格式检查 → 统计 → 一次写入。格式不对抛错，一条都不写
  function 写入结果(module, output) {
    const checked = checkModuleOutput(output, { module, knownKey: key => Boolean(st.item.get(key)) });
    const stats = summarize(checked);
    writeModuleOutput(module, checked, stats);
    return stats;
  }

  return {
    db,
    file,
    clearModules,
    写入结果,
    删除,
    标记线索,
    // 查找当晚的条目：默认找进行中的，可以按种类、状态找
    查找: ({ kind, status = '进行中' } = {}) => st.items.all(status).map(parse).filter(item => !kind || item.kind === kind),
    已写入: module => st.moduleGet.get(module)?.status === '完成',
    // 记下当晚的运行信息（例如搜索词数量、额度分配）；可以重复调用，只更新这一项
    创建当晚: 信息 => setMeta.run('当晚信息', JSON.stringify(信息 ?? {})),
    meta: key => getMeta.get(key)?.value,
    item: key => parse(st.item.get(key)),
    // 默认只取“进行中”的条目：已丢弃、顺延、失败的不再交给后面的模块
    activeItems: ({ kind } = {}) => st.items.all('进行中').map(parse).filter(item => !kind || item.kind === kind),
    trailOf: key => st.trailOf.all(key),
    statusCounts: () => Object.fromEntries(st.counts.all().map(row => [row.status, row.n])),
    writeModuleOutput,
    changes: () => st.changes.all().map(row => ({ ...row, payload: JSON.parse(row.payload) })),
    pendingChangesFor: (table, key) => st.pendingFor.all(table, key).map(row => ({ ...row, payload: JSON.parse(row.payload) })),
    markChange: (id, result, reason = '') => st.markChange.run(result, reason, id),
    putBlob(body, kind = 'text') {
      const text = String(body);
      const hash = crypto.createHash('sha256').update(text).digest('hex');
      st.blobPut.run(hash, kind, text.length, text);
      return hash;
    },
    getBlob: hash => st.blobGet.get(hash)?.body ?? null,
    moduleState: name => st.moduleGet.get(name) || null,
    moduleStates: () => st.moduleAll.all().map(row => ({ ...row, stats: row.stats ? JSON.parse(row.stats) : null })),
    markModule: (name, status, { error = null, stats = null } = {}) => st.moduleSet.run({
      name, status, started_at: status === '运行中' ? now() : null, finished_at: status === '运行中' ? null : now(),
      stats: stats ? JSON.stringify(stats) : null, error }),
    recordCall: ({ module = null, provider, ok, tokens = null, cost = null, ms = null, note = '' }) =>
      st.call.run(module, provider, ok ? 1 : 0, tokens, cost, ms, note, now()),
    close: () => db.close(),
  };
}
