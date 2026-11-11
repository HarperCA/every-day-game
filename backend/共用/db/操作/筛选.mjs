// 把筛选条件转成 SQL。字段名只能是 描述/ 里有的（拼进 SQL 前先核对），值一律走参数，不拼进 SQL。
//
// 条件的写法：
//   { level: '国家级' }                              等于；值是 null 表示“没填”
//   { status: { in: ['已发布', '已归档'] } }          在其中（还有 notIn）
//   { registration_end: { gte: '2026-10-29T00:00:00+08:00' } }  比较（gt、gte、lt、lte）；时间字段按实际时刻比，不受时区写法影响
//   { name: { like: '数学' } }                       包含这段文字
//   { professions: { contains: '计算机类' } }         列表里有这一项
//   { organizer: { isNull: true } }                  没填 / 填了
//   { or: [条件, 条件] }                              任一满足；同一层的多个字段是“并且”
import { DbError } from './错误.mjs';
import { encodeValue } from './编码.mjs';

const COMPARE = { gt: '>', gte: '>=', lt: '<', lte: '<=' };
const escapeLike = text => String(text).replace(/[\\%_]/g, ch => `\\${ch}`);

export function buildWhere(table, filter = {}, alias = '') {
  const params = [];
  const prefix = alias ? `${alias}.` : '';
  const fieldOf = name => {
    const field = table.字段[name];
    if (!field) throw new DbError('请求有误', `${table.表名} 没有字段 ${name}，不能按它筛选`, { table: table.表名 });
    return field;
  };

  const clause = condition => {
    const parts = [];
    for (const [name, cond] of Object.entries(condition || {})) {
      if (name === 'or') {
        if (!Array.isArray(cond) || !cond.length) throw new DbError('请求有误', 'or 要给一组条件', { table: table.表名 });
        parts.push(`(${cond.map(sub => `(${clause(sub) || '1'})`).join(' OR ')})`);
        continue;
      }
      const field = fieldOf(name);
      const isTime = field.类型 === '时间' || field.类型 === '日期或时间';
      const col = isTime ? `julianday(${prefix}${name})` : `${prefix}${name}`;
      const slot = isTime ? 'julianday(?)' : '?';
      const ops = cond !== null && typeof cond === 'object' && !Array.isArray(cond) ? cond : { eq: cond };
      for (const [op, value] of Object.entries(ops)) {
        if (op === 'eq') {
          if (value === null) parts.push(`${prefix}${name} IS NULL`);
          else { parts.push(`${col} = ${slot}`); params.push(encodeValue(field, value)); }
        } else if (op === 'in' || op === 'notIn') {
          if (!Array.isArray(value)) throw new DbError('请求有误', `${name}.${op} 要给一组值`, { table: table.表名 });
          if (!value.length) parts.push(op === 'in' ? '0' : '1');
          else {
            parts.push(`${col} ${op === 'in' ? 'IN' : 'NOT IN'} (${value.map(() => slot).join(', ')})`);
            params.push(...value.map(item => encodeValue(field, item)));
          }
        } else if (COMPARE[op]) {
          parts.push(`${col} ${COMPARE[op]} ${slot}`); params.push(encodeValue(field, value));
        } else if (op === 'like') {
          parts.push(`${prefix}${name} LIKE ? ESCAPE '\\'`); params.push(`%${escapeLike(value)}%`);
        } else if (op === 'contains') {
          if (field.类型 !== '列表') throw new DbError('请求有误', `${name} 不是列表，不能用 contains`, { table: table.表名 });
          parts.push(`EXISTS (SELECT 1 FROM json_each(${prefix}${name}) WHERE value = ?)`); params.push(value);
        } else if (op === 'isNull') {
          parts.push(`${prefix}${name} IS ${value ? '' : 'NOT '}NULL`);
        } else {
          throw new DbError('请求有误', `不认识的筛选写法 ${name}.${op}`, { table: table.表名 });
        }
      }
    }
    return parts.join(' AND ');
  };

  const sql = clause(filter);
  return { sql: sql ? `WHERE ${sql}` : '', params };
}

// 排序：'registration_end' 从早到晚，'-registration_end' 从晚到早；可以给一组。没填的排最后。
export function buildOrder(table, orderBy, alias = '') {
  if (!orderBy) return '';
  const prefix = alias ? `${alias}.` : '';
  const items = (Array.isArray(orderBy) ? orderBy : [orderBy]).map(item => {
    const desc = item.startsWith('-');
    const name = desc ? item.slice(1) : item;
    const field = table.字段[name];
    if (!field) throw new DbError('请求有误', `${table.表名} 没有字段 ${name}，不能按它排序`, { table: table.表名 });
    const col = field.类型 === '时间' || field.类型 === '日期或时间' ? `julianday(${prefix}${name})` : `${prefix}${name}`;
    return `${prefix}${name} IS NULL, ${col} ${desc ? 'DESC' : 'ASC'}`;
  });
  return `ORDER BY ${items.join(', ')}`;
}
