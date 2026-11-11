// 写入前按 描述/ 检查一条完整记录：有没有不认识的字段、必填有没有填、类型对不对、有没有超长、是不是可选值之一。
// 指向的记录在不在由数据库自己检查（事务提交时）。不合格就拒绝写入，报错里写明哪个字段、哪条规则。
import { DbError } from './错误.mjs';

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;   // 秒的小数最多 6 位（旧数据里有）
const PARTIAL_DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isUrl = value => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
};

const CHECKS = {
  编号: v => typeof v === 'string' && v.trim() !== '',
  文字: v => typeof v === 'string',
  长文字: v => typeof v === 'string',
  网址: v => typeof v === 'string' && isUrl(v),
  日期: v => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v)),
  时间: v => typeof v === 'string' && ISO_TIME.test(v) && !Number.isNaN(Date.parse(v)),
  日期或时间: v => typeof v === 'string' && (DATE.test(v) || ISO_TIME.test(v)) && !Number.isNaN(Date.parse(v)),
  不完整日期: v => typeof v === 'string' && PARTIAL_DATE.test(v) && !Number.isNaN(Date.parse(v.length === 4 ? `${v}-01-01` : v.length === 7 ? `${v}-01` : v)),
  时间戳: v => Number.isInteger(v),
  整数: v => Number.isInteger(v),
  是否: v => typeof v === 'boolean',
  列表: v => Array.isArray(v),
  对象: v => typeof v === 'object' && v !== null,
};

// 没填：undefined、null、空字符串（文字类可选字段允许空字符串，旧数据里很多）
const isEmpty = (field, value) => value === undefined || value === null
  || (value === '' && (field.必填 || !['文字', '长文字'].includes(field.类型)));

export function validate(table, data) {
  const problems = [];
  const add = (field, rule, message) => problems.push({ field, rule, message });
  for (const key of Object.keys(data)) {
    if (!table.字段[key]) add(key, '未知字段', `${table.表名} 没有字段 ${key}`);
  }
  for (const [name, field] of Object.entries(table.字段)) {
    const value = data[name];
    if (isEmpty(field, value)) {
      if (field.必填) add(name, '必填', `${name}（${field.说明}）必须填`);
      else if (value === '') add(name, '类型', `${name} 不能是空字符串，没有就填 null`);
      continue;
    }
    if (value === '') continue;
    if (!CHECKS[field.类型](value)) { add(name, '类型', `${name} 应该是${field.类型}`); continue; }
    if (field.最长 && typeof value === 'string' && [...value].length > field.最长) {
      add(name, '太长', `${name} 最长 ${field.最长} 字，现在 ${[...value].length} 字`);
    }
    if (Array.isArray(field.可选值)) {
      const bad = (field.类型 === '列表' ? value : [value]).filter(item => !field.可选值.includes(item));
      if (bad.length) add(name, '可选值', `${name} 只能是 ${field.可选值.join('、')}，不能是 ${bad.join('、')}`);
    }
  }
  return problems;
}

export function assertValid(table, data) {
  const problems = validate(table, data);
  if (problems.length) {
    throw new DbError('校验不通过', `${table.表名}/${data[table.主键] ?? '?'}：${problems.map(p => p.message).join('；')}`,
      { table: table.表名, id: data[table.主键] ?? null, problems });
  }
}
