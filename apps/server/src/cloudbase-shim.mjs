// 一层 CloudBase 兼容外壳，让云函数代码原样跑在 SQLite 上。
//
// 为什么用这个办法而不是重写：后端 3757 行里只有约 60 行是 CloudBase 专有的，
// 剩下全是业务逻辑。重写等于把 98% 没问题的代码也放进风险里。写一层外壳，
// 业务代码一行不改，出错面只剩这个文件本身——而这个文件有测试兜着。
//
// 实测云函数只用到这些：
//   collection / doc / where / orderBy / limit / skip / get / set / add / update / remove
//   command.in / command.inc / command.lte
//   runTransaction
// 只实现这些，不实现没人用的功能——没被用到的兼容代码是没被验证过的代码。
//
// 一个刻意保留的行为：文档不存在时 doc().get() 抛 errCode -1 的错。
// 云函数里好几处靠捕获这个错来判断「还没建过」，改成返回 null 会让那些
// 分支静默失效。
import { getDoc, putDoc, deleteDoc, listDocs, nextSeq } from './db.mjs';

const COMMAND = Symbol('cloudbase-command');

function notFound(collection, id) {
  const error = new Error(`document not exist: ${collection}/${id}`);
  error.errCode = -1;
  return error;
}

// —— 查询操作符 ——

export const command = {
  in: values => ({ [COMMAND]: 'in', values }),
  inc: amount => ({ [COMMAND]: 'inc', amount }),
  lte: value => ({ [COMMAND]: 'lte', value }),
};

function matchesCondition(actual, expected) {
  if (expected && typeof expected === 'object' && expected[COMMAND]) {
    switch (expected[COMMAND]) {
      case 'in': return Array.isArray(expected.values) && expected.values.includes(actual);
      case 'lte': return actual !== undefined && actual !== null && actual <= expected.value;
      default: throw new Error(`unsupported_query_command:${expected[COMMAND]}`);
    }
  }
  return actual === expected;
}

function matchesWhere(doc, where) {
  return Object.entries(where || {}).every(([field, expected]) => matchesCondition(doc[field], expected));
}

// update 里可能带 command.inc：{ count: _.inc(1) }
function applyUpdate(existing, patch) {
  const next = { ...existing };
  for (const [field, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && value[COMMAND] === 'inc') {
      next[field] = (Number(next[field]) || 0) + Number(value.amount || 0);
    } else {
      next[field] = value;
    }
  }
  return next;
}

// —— 集合 / 文档引用 ——

class DocumentRef {
  constructor(db, collection, id) {
    this.db = db;
    this.collection = collection;
    this.id = id;
  }

  async get() {
    const data = getDoc(this.db, this.collection, this.id);
    // 刻意抛错而不是返回 null：云函数里多处靠捕获 errCode -1 判断「集合/文档还没建」。
    if (!data) throw notFound(this.collection, this.id);
    return { data: { ...data, _id: this.id } };
  }

  async set({ data }) {
    putDoc(this.db, this.collection, this.id, data);
    return { updated: 1 };
  }

  async update({ data }) {
    const existing = getDoc(this.db, this.collection, this.id);
    if (!existing) throw notFound(this.collection, this.id);
    putDoc(this.db, this.collection, this.id, applyUpdate(existing, data));
    return { updated: 1 };
  }

  async remove() {
    return { deleted: deleteDoc(this.db, this.collection, this.id) };
  }
}

class Query {
  constructor(db, collection, state = {}) {
    this.db = db;
    this.collection = collection;
    this.state = { where: null, orderBy: [], limit: null, skip: 0, ...state };
  }

  #derive(patch) {
    return new Query(this.db, this.collection, { ...this.state, ...patch });
  }

  where(condition) { return this.#derive({ where: { ...(this.state.where || {}), ...condition } }); }
  orderBy(field, direction = 'asc') { return this.#derive({ orderBy: [...this.state.orderBy, { field, direction }] }); }
  limit(n) { return this.#derive({ limit: n }); }
  skip(n) { return this.#derive({ skip: n }); }

  async get() {
    let rows = listDocs(this.db, this.collection);
    if (this.state.where) rows = rows.filter(row => matchesWhere(row, this.state.where));
    for (const { field, direction } of [...this.state.orderBy].reverse()) {
      const sign = String(direction).toLowerCase() === 'desc' ? -1 : 1;
      rows = rows.slice().sort((a, b) => {
        const left = a[field];
        const right = b[field];
        if (left === right) return 0;
        if (left === undefined || left === null) return 1;   // 空值永远排在后面
        if (right === undefined || right === null) return -1;
        return left < right ? -sign : sign;
      });
    }
    if (this.state.skip) rows = rows.slice(this.state.skip);
    if (this.state.limit !== null) rows = rows.slice(0, this.state.limit);
    return { data: rows };
  }

  async count() {
    const { data } = await new Query(this.db, this.collection, { ...this.state, limit: null, skip: 0 }).get();
    return { total: data.length };
  }

  // CloudBase 的 where().update() 是"按条件批量改"，跟 orderBy/limit/skip 无关——
  // 官方 SDK 里这几个也确实对 update 不生效，只有 where 起作用。
  // sendReminders 用这个做"认领"（where 里带上当前状态，返回 updated 数判断
  // 抢到没抢到）和批量恢复超时认领，之前没人真正触发过这条路径，漏了没实现。
  async update({ data } = {}) {
    const rows = listDocs(this.db, this.collection).filter(row => matchesWhere(row, this.state.where));
    for (const row of rows) putDoc(this.db, this.collection, row._id, applyUpdate(row, data));
    return { stats: { updated: rows.length } };
  }
}

class CollectionRef extends Query {
  doc(id) { return new DocumentRef(this.db, this.collection, String(id)); }

  async add({ data }) {
    // CloudBase 不给 _id 时自己生成一个；这里用递增序号，保持插入顺序可判定。
    const id = data._id || data.id || `auto-${nextSeq(this.db)}-${Math.random().toString(36).slice(2, 8)}`;
    if (getDoc(this.db, this.collection, id)) {
      // 复刻唯一键冲突：login 云函数靠捕获这个错处理并发首次登录。
      const error = new Error(`duplicate key: ${this.collection}/${id}`);
      error.errCode = -502001;
      throw error;
    }
    putDoc(this.db, this.collection, id, data);
    return { _id: id, id };
  }
}

// —— 数据库门面 ——

class DatabaseFacade {
  constructor(db) {
    this.db = db;
    this.command = command;
  }

  collection(name) { return new CollectionRef(this.db, name); }

  // CloudBase 的 runTransaction 给回调一个 transaction 对象，用法和 db 一样。
  // better-sqlite3 的事务是同步的，而回调是 async——所以这里不用它的
  // transaction()，改成手动 BEGIN/COMMIT，失败回滚。语义上一致：
  // 要么全成，要么全不成。
  async runTransaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await work(this);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_ignored) { /* 已经回滚过就忽略 */ }
      throw error;
    }
  }
}

// 云函数里 require('wx-server-sdk') 拿到的就是这个形状。
export function createCloudShim(db) {
  const facade = new DatabaseFacade(db);
  return {
    DYNAMIC_CURRENT_ENV: 'self-hosted',
    init() { /* 自托管没有环境概念，留空 */ },
    database: () => facade,
    // getWXContext / openapi 由调用方注入：身份和订阅消息要真的对接微信，
    // 不能在这里假装成功——假装成功等于把「消息没发出去」藏起来。
    getWXContext: () => { throw new Error('wx_context_not_available:请由 HTTP 层注入用户身份'); },
    get openapi() { throw new Error('wx_openapi_not_available:订阅消息要走微信接口，见 src/wechat.mjs'); },
  };
}
