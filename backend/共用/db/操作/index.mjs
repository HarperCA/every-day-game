// 数据库的通用读写，美国的比赛库和北京的用户库共用这一套。接口和 美国/pipeline/总控/零件/maindb.mjs（内存版）一致，流程换过来时不用改。
//
//   openDb({ file, tables, structureDir, readOnly })
//     打开一个库，补执行结构文件夹里没执行过的编号文件。tables（这个库有哪些表）和 structureDir（建表语句在哪）必须给：
//     美国比赛库由 美国/db/index.mjs 给，北京由 北京/主数据库、北京/副数据库 的 index.mjs 给。
//     readOnly 为 true 时只能读，任何写入都报“只读副本”（另一台服务器同步过来的副本用这个打开）。
//
//   读（描述里写了 删除标记 的表，默认读不到已删除的；最后一个参数给 { 包括已删除: true } 才读得到，回收站用）
//     db.get(table, id, { 包括已删除 })       → { version, data } 或 null
//     db.list(table, { 包括已删除 })          → [{ id, key, version, data }]（key 同 id）
//   筛选（条件写法见 筛选.mjs）
//     db.find(table, filter, { orderBy, limit, offset, 包括已删除 })  → [data]
//     db.count(table, filter, { 包括已删除 }) → 条数
//   写（每次写入前按 描述/ 校验；有版本号的表修改时必须带上读到的版本号）
//     db.insert(table, id, data)             新增，补上默认值、版本号 1、建立时间 → { id, version, data }
//     db.update(table, id, changes, version) 修改：changes 合并到原记录，版本号加一 → { id, version, data }
//     db.remove(table, id)                   从库里删掉这一行（只删它自己）
//   删除接口（美国比赛库、北京用户库共用；后台回收站只调这三个，删除的业务规则在后台）
//     db.标记删除(table, id, { by, at })     打删除标记（描述里写了 删除标记 的表才行），记下谁删的；之后默认读不到
//     db.取消删除(table, id)                 清掉删除标记
//     db.彻底删除(table, id)                 按描述里的“指向”连带删：先删指向它的记录（不管标没标删除），指向自己表的改成空，
//                                            再删它自己 → { 连带: { 表: 条数 }, 断开: [{ 表, 编号, 字段 }] }；整个在一个事务里
//     db.transaction(tx => { ... })          tx 上有上面全部读写；fn 抛错时整个撤回
//   db.close()
//
// 报错一律是 DbError（错误.mjs），按 kind 区分：校验不通过、版本冲突、找不到、已存在、指向的记录不存在、不能删除、只读副本、请求有误。
import fs from 'node:fs';
import path from 'node:path';
import { openSqlite } from '../../工具/sqlite.mjs';
import { migrate } from '../结构/升级.mjs';
import { RAW } from './内部.mjs';
import { assertValid, validate } from './校验.mjs';
import { fromRow, toRow } from './编码.mjs';
import { buildOrder, buildWhere } from './筛选.mjs';
import { DbError, fromSqliteError } from './错误.mjs';
export { DbError, validate, RAW };
export { DB_ERROR_KINDS } from './错误.mjs';

export function openDb({ file, tables, structureDir, readOnly = false, now = () => new Date() } = {}) {
  if (!file || !tables || !structureDir) throw new DbError('请求有误', '打开库要给 file、tables、structureDir（用 美国/db、北京/主数据库 或 北京/副数据库 的入口打开）');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = openSqlite(file);
  migrate(sqlite, { dir: structureDir, now });

  const writable = tableName => {
    if (readOnly) throw new DbError('只读副本', `这个库是只读副本，不能写 ${tableName}；要改去正本那台服务器`, { table: tableName });
  };
  const tableOf = name => {
    const table = tables[name];
    if (!table) throw new DbError('请求有误', `没有这张表：${name}`);
    return table;
  };
  const rowOf = (table, id) => sqlite.prepare(`SELECT * FROM ${table.表名} WHERE ${table.主键} = ?`).get(id);
  // key 和 id 是同一个值：流程的 ctx.list 按 key 读（和内存版 pipeline/总控/零件/maindb.mjs 一致）
  const wrap = (table, row) => ({ id: row[table.主键], key: row[table.主键], version: row.version ?? null, data: fromRow(table, row) });
  // 删除标记：描述里写了 删除标记（字段名）的表，这个字段有值就算已删除，默认不读出来
  const hidesDeleted = (table, options) => Boolean(table.删除标记) && !options?.包括已删除;
  const whereOf = (table, filter, options) => {
    const where = buildWhere(table, filter);
    if (!hidesDeleted(table, options)) return where;
    const notDeleted = `${table.删除标记} IS NULL`;
    return { sql: where.sql ? `${where.sql} AND ${notDeleted}` : `WHERE ${notDeleted}`, params: where.params };
  };
  const guard = (table, id, fn) => {
    try { return fn(); } catch (error) { throw fromSqliteError(error, { table: table.表名, id }); }
  };

  const api = {
    get(tableName, id, options = {}) {
      const table = tableOf(tableName);
      const row = rowOf(table, id);
      if (!row || (hidesDeleted(table, options) && row[table.删除标记] != null)) return null;
      return { version: row.version ?? null, data: fromRow(table, row) };
    },
    list(tableName, options = {}) {
      const table = tableOf(tableName);
      const where = whereOf(table, {}, options);
      return sqlite.prepare(`SELECT * FROM ${table.表名} ${where.sql} ORDER BY ${table.主键}`).all(...where.params).map(row => wrap(table, row));
    },
    find(tableName, filter = {}, { orderBy = null, limit = null, offset = 0, ...options } = {}) {
      const table = tableOf(tableName);
      const where = whereOf(table, filter, options);
      const page = limit == null ? '' : 'LIMIT ? OFFSET ?';
      const params = limit == null ? where.params : [...where.params, limit, offset];
      return sqlite.prepare(`SELECT * FROM ${table.表名} ${where.sql} ${buildOrder(table, orderBy)} ${page}`)
        .all(...params).map(row => fromRow(table, row));
    },
    count(tableName, filter = {}, options = {}) {
      const table = tableOf(tableName);
      const where = whereOf(table, filter, options);
      return sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table.表名} ${where.sql}`).get(...where.params).n;
    },
    insert(tableName, id, data = {}) {
      writable(tableName);
      const table = tableOf(tableName);
      if (data[table.主键] !== undefined && data[table.主键] !== id) throw new DbError('请求有误', `编号对不上：${id} 和 ${data[table.主键]}`, { table: tableName, id });
      const at = now().toISOString();
      const full = { ...defaultsOf(table), ...data, [table.主键]: id };
      if (table.字段.version) full.version = 1;
      if (table.字段.created_at && full.created_at == null) full.created_at = at;
      if (table.字段.updated_at && full.updated_at == null) full.updated_at = at;
      assertValid(table, full);
      if (rowOf(table, id)) throw new DbError('已存在', `${tableName} 已有 ${id}，不能重复新增`, { table: tableName, id });
      const row = toRow(table, full);
      const cols = Object.keys(row);
      guard(table, id, () => sqlite.prepare(`INSERT INTO ${table.表名} (${cols.join(', ')}) VALUES (${cols.map(c => `@${c}`).join(', ')})`).run(row));
      return wrap(table, rowOf(table, id));
    },
    update(tableName, id, changes = {}, version) {
      writable(tableName);
      const table = tableOf(tableName);
      const row = rowOf(table, id);
      if (!row) throw new DbError('找不到', `${tableName} 没有 ${id}`, { table: tableName, id });
      if (changes[table.主键] !== undefined && changes[table.主键] !== id) throw new DbError('请求有误', '不能改编号', { table: tableName, id });
      if (table.字段.version) {
        if (!Number.isInteger(version)) throw new DbError('请求有误', `改 ${tableName} 要带上读到的版本号`, { table: tableName, id });
        if (row.version !== version) throw new DbError('版本冲突', `${tableName}/${id} 已被改过：读到第 ${version} 版，现在是第 ${row.version} 版`, { table: tableName, id });
      }
      const { version: _v, created_at: _c, ...rest } = changes;
      const merged = { ...fromRow(table, row), ...rest, [table.主键]: id };
      if (table.字段.version) merged.version = row.version + 1;
      if (table.字段.updated_at) merged.updated_at = now().toISOString();
      assertValid(table, merged);
      const next = toRow(table, merged);
      const cols = Object.keys(next).filter(c => c !== table.主键);
      guard(table, id, () => sqlite.prepare(`UPDATE ${table.表名} SET ${cols.map(c => `${c} = @${c}`).join(', ')} WHERE ${table.主键} = @${table.主键}`).run(next));
      return wrap(table, rowOf(table, id));
    },
    remove(tableName, id) {
      writable(tableName);
      const table = tableOf(tableName);
      const result = guard(table, id, () => sqlite.prepare(`DELETE FROM ${table.表名} WHERE ${table.主键} = ?`).run(id));
      if (!result.changes) throw new DbError('找不到', `${tableName} 没有 ${id}`, { table: tableName, id });
    },
    标记删除(tableName, id, { by = null, at = null } = {}) {
      writable(tableName);
      const table = tableOf(tableName);
      if (!table.删除标记) throw new DbError('请求有误', `${table.说明}不能标删除（描述里没写删除标记）`, { table: tableName, id });
      const row = rowOf(table, id);
      if (!row || row[table.删除标记] != null) throw new DbError('找不到', `${tableName} 没有 ${id}，或已经删了`, { table: tableName, id });
      const changes = { [table.删除标记]: at || now().toISOString() };
      if (table.字段.deleted_by) changes.deleted_by = by;
      return api.update(tableName, id, changes, row.version ?? undefined);
    },
    取消删除(tableName, id) {
      writable(tableName);
      const table = tableOf(tableName);
      if (!table.删除标记) throw new DbError('请求有误', `${table.说明}没有删除标记`, { table: tableName, id });
      const row = rowOf(table, id);
      if (!row || row[table.删除标记] == null) throw new DbError('找不到', `${tableName} ${id} 不在删除状态`, { table: tableName, id });
      const changes = { [table.删除标记]: null };
      if (table.字段.deleted_by) changes.deleted_by = null;
      return api.update(tableName, id, changes, row.version ?? undefined);
    },
    彻底删除(tableName, id) {
      writable(tableName);
      const 结果 = { 连带: {}, 断开: [] };
      const 删 = (name, key) => {
        const table = tableOf(name);
        if (!rowOf(table, key)) throw new DbError('找不到', `${name} 没有 ${key}`, { table: name, id: key });
        for (const [otherName, other] of Object.entries(tables)) {
          for (const [field, def] of Object.entries(other.字段)) {
            if (def.指向 !== name) continue;
            const refs = sqlite.prepare(`SELECT ${other.主键} AS id FROM ${other.表名} WHERE ${field} = ?`).all(key).map(r => r.id);
            for (const refId of refs) {
              if (otherName === name) {
                if (refId === key) continue;
                api.update(otherName, refId, { [field]: null }, rowOf(other, refId).version ?? undefined);
                结果.断开.push({ 表: otherName, 编号: refId, 字段: field });
              } else {
                删(otherName, refId);
                结果.连带[otherName] = (结果.连带[otherName] || 0) + 1;
              }
            }
          }
        }
        guard(table, key, () => sqlite.prepare(`DELETE FROM ${table.表名} WHERE ${table.主键} = ?`).run(key));
      };
      api.transaction(() => 删(tableName, id));
      return 结果;
    },
    transaction(fn) {
      try { return sqlite.transaction(() => fn(api))(); } catch (error) { throw fromSqliteError(error); }
    },
  };

  return Object.assign(Object.create(null), api, { close: () => sqlite.close(), [RAW]: sqlite });
}

function defaultsOf(table) {
  return Object.fromEntries(Object.entries(table.字段).filter(([, f]) => '默认' in f).map(([name, f]) => [name, f.默认]));
}
