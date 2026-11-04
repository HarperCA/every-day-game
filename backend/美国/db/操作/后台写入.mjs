// 比赛.mjs、届次.mjs 的后台写入共用的几个小件：只放行可改字段、找出真正变了的字段、记 manual_fields、留后台记录、生成编号。
// 只给本文件夹用，外面经 db/index.mjs 的 比赛.*、届次.* 调。
import { randomUUID } from 'node:crypto';
import { DbError } from '../../../共用/db/index.mjs';

export const 全部 = { 包括已删除: true };

export function 只许可改字段(表名, 改动, 可改字段) {
  const 不许 = Object.keys(改动 || {}).filter(字段 => !可改字段.includes(字段));
  if (不许.length) throw new DbError('请求有误', `${不许.join('、')} 不能在后台改`, { table: 表名 });
}

// 值不一样才算改了（列表、对象按内容比）
const 一样 = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const 变了的字段 = (原, 改动) => Object.keys(改动).filter(字段 => !一样(原[字段], 改动[字段]));

export const 并进人工字段 = (原有, 字段们) => [...new Set([...(原有 || []), ...字段们])];

export function 记日志(tx, action, table_name, record_id, detail, at) {
  tx.insert('audit_log', randomUUID(), { created_at: at, action, table_name, record_id, detail });
}

export const 新编号 = 前缀 => `${前缀}-manual-${randomUUID().replace(/-/g, '').slice(0, 16)}`;

// 读一条没删的记录，读不到报“找不到”
export function 现有(tx, 表名, id, 说明) {
  const 行 = tx.get(表名, id);
  if (!行) throw new DbError('找不到', `没有${说明} ${id}（不存在或已经删了）`, { table: 表名, id });
  return 行;
}
