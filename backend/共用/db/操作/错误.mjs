// 数据库总管报错的统一类型。调用方按 kind 处理，例如流程提交时遇到“版本冲突”就跳过这一条。
export const DB_ERROR_KINDS = ['校验不通过', '版本冲突', '找不到', '已存在', '指向的记录不存在', '不能删除', '只读副本', '请求有误'];

export class DbError extends Error {
  constructor(kind, message, { table = null, id = null, problems = null } = {}) {
    if (!DB_ERROR_KINDS.includes(kind)) throw new Error(`未知的数据库报错类型：${kind}`);
    super(message);
    this.name = 'DbError';
    this.kind = kind;
    this.table = table;
    this.id = id;
    this.problems = problems;   // 校验不通过时：[{ field, rule, message }]
  }
}

// SQLite 的约束报错转成统一类型
export function fromSqliteError(error, { table, id } = {}) {
  const code = String(error?.code || '');
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return new DbError('指向的记录不存在', `${table || ''} 指向的记录不存在`, { table, id });
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return new DbError('已存在', `${table || ''} 已有相同的记录：${error.message}`, { table, id });
  return error;
}
