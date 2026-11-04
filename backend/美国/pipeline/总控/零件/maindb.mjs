// 总库的接口：流程运行期间只读，最后由提交步骤统一写入。
//
// 总库要提供这几个函数（以后换成北京新表的数据层，接口保持不变）：
//   get(table, key)          → { version, data } 或 null
//   list(table)              → [{ key, version, data }]
//   transaction(fn)          → 在一个事务里执行 fn(tx)，fn 抛错时整个撤回
//     tx.get(table, key)     → 同上
//     tx.insert(table, key, data)          → 新增，版本号从 1 开始
//     tx.update(table, key, data, version) → 修改，版本号加一；version 和现在的对不上就抛错
//     tx.transaction(fn)     → 事务里再开一层（06 写入主库一条候选一组用），fn 抛错时只撤回这一层
//
// 骨架阶段先用内存版本，测试和本地试跑都用它；它不连任何真实数据库。

export function createMemoryMainDb(seed = {}) {
  const tables = new Map();
  for (const [table, rows] of Object.entries(seed)) {
    tables.set(table, new Map(Object.entries(rows).map(([key, data]) => [key, { version: 1, data: structuredClone(data) }])));
  }
  const tableOf = name => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name); };
  const read = (table, key) => { const row = tableOf(table).get(key); return row ? structuredClone(row) : null; };

  return {
    kind: 'memory',
    get: read,
    list: table => [...tableOf(table).entries()].map(([key, row]) => ({ key, ...structuredClone(row) })),
    // 测试里模拟“有人在后台改了这一条”
    touch(table, key, data) {
      const row = tableOf(table).get(key);
      tableOf(table).set(key, { version: (row?.version || 0) + 1, data: structuredClone(data ?? row?.data ?? {}) });
    },
    transaction(fn) {
      const tx = {
        get: read,
        insert(table, key, data) {
          if (tableOf(table).has(key)) throw new Error(`总库 ${table} 已有 ${key}，不能重复新增`);
          tableOf(table).set(key, { version: 1, data: structuredClone(data) });
        },
        update(table, key, data, version) {
          const row = tableOf(table).get(key);
          if (!row) throw new Error(`总库 ${table} 没有 ${key}`);
          if (row.version !== version) throw new Error(`总库 ${table}/${key} 的版本已变`);
          tableOf(table).set(key, { version: row.version + 1, data: structuredClone(data) });
        },
        // 事务里再开一层：在调用它的这个对象上接着做（外面套了一层的也照样经过外面那层），出错只撤回这一层
        transaction(inner) { return 撤回式(() => inner(this)); },
      };
      return 撤回式(() => fn(tx));
    },
  };

  function 撤回式(run) {
    const snapshot = new Map([...tables].map(([name, rows]) => [name, new Map([...rows].map(([k, v]) => [k, structuredClone(v)]))]));
    try {
      return run();
    } catch (error) {
      tables.clear();
      for (const [name, rows] of snapshot) tables.set(name, rows);
      throw error;
    }
  }
}
