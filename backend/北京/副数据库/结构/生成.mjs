// 按 副数据库/描述/ 生成北京副数据库（用户管理中心）的建表语句。生成方法和美国共用（共用/db 的 buildCreateSql）。
//   node backend/北京/副数据库/结构/生成.mjs      重新生成 001-建表.sql 和后来新增的编号文件
// 上线前 001 可以重新生成；上线后改表只新增编号文件。测试会核对每个文件和生成结果一致。
// 上线后新增的表在描述里写 结构文件（例如 '003-校赛.sql'），只进那个文件；没写的进 001。
// 上线后给已有的表加字段（2026-11-09）：在字段描述里写 结构文件（例如 '004-用户昵称头像.sql'），这个字段不进建表块，
// 在那个文件里生成 ALTER TABLE … ADD COLUMN。SQLite 加列不能是 NOT NULL（旧行没有值），也不加外键，所以这种字段只能是选填、不写“指向”。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCreateSql } from '../../../共用/db/index.mjs';
import { TABLES } from '../描述/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIRST_FILE = path.join(HERE, '001-建表.sql');
const 第一个文件名 = '001-建表.sql';
const 文件名 = table => table.结构文件 || 第一个文件名;
// 和 共用/db/结构/生成.mjs 的类型对应一致：整数、时间戳、是否存成 INTEGER，其余存成 TEXT
const SQL_TYPE = { 整数: 'INTEGER', 时间戳: 'INTEGER', 是否: 'INTEGER' };

// 后加的字段：字段自己写了 结构文件，并且和表的不是同一个文件
const 后加的 = (table, field) => Boolean(field.结构文件) && field.结构文件 !== 文件名(table);
const 去掉后加的字段 = tables => Object.fromEntries(Object.entries(tables).map(([key, table]) =>
  [key, { ...table, 字段: Object.fromEntries(Object.entries(table.字段).filter(([, field]) => !后加的(table, field))) }]));

// 一张表在这个文件里加的列：每张表一块（说明一行 + 每列一句）
function 加列块(table, name) {
  const 列们 = Object.entries(table.字段).filter(([, field]) => 后加的(table, field) && field.结构文件 === name);
  if (!列们.length) return null;
  for (const [col, field] of 列们) {
    if (field.必填 || field.指向 || col === table.主键) throw new Error(`${table.表名}.${col}：后加的字段只能是选填、不写指向`);
  }
  return [`-- ${table.说明}：加 ${列们.map(([col]) => col).join('、')}`,
    ...列们.map(([col, field]) => `ALTER TABLE ${table.表名} ADD COLUMN ${col} ${SQL_TYPE[field.类型] || 'TEXT'};`)].join('\n');
}

// 整体生成一遍（“指向”要在全部表里查主键），再按 结构文件 挑出各自的建表块：每张表一块，块与块之间空一行，块里没有空行；
// 后加的字段不进建表块，在它自己的文件里接在建表块后面生成加列块
export function buildFileSql(name = 第一个文件名) {
  const [head, ...blocks] = buildCreateSql(去掉后加的字段(TABLES)).trimEnd().split('\n\n');
  const 这些 = Object.values(TABLES).map((table, i) => [table, blocks[i]]).filter(([table]) => 文件名(table) === name).map(([, block]) => block);
  const 加列 = Object.values(TABLES).map(table => 加列块(table, name)).filter(Boolean);
  return [head, ...这些, ...加列].join('\n\n') + '\n';
}
export const buildUserSql = () => buildFileSql(第一个文件名);
export const 文件们 = () => [...new Set(Object.values(TABLES).flatMap(table =>
  [文件名(table), ...Object.values(table.字段).filter(field => 后加的(table, field)).map(field => field.结构文件)]))].sort();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const name of 文件们()) {
    fs.writeFileSync(path.join(HERE, name), buildFileSql(name), 'utf8');
    console.log(`已生成 ${path.join(HERE, name)}`);
  }
}
