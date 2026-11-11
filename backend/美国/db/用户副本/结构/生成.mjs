// 按 用户副本/描述/ 生成用户副本的建表语句。生成方法和比赛库共用（共用/db 的 buildCreateSql）。
//   node backend/美国/db/用户副本/结构/生成.mjs      重新生成 001-建表.sql
// 上线前 001 可以重新生成；上线后改表只新增编号文件。测试会核对 001 和生成结果一致。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCreateSql } from '../../../../共用/db/index.mjs';
import 北京副本 from '../描述/北京副本.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIRST_FILE = path.join(HERE, '001-建表.sql');
export const TABLES = { [北京副本.表名]: 北京副本 };
export const buildCopySql = () => buildCreateSql(TABLES);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(FIRST_FILE, buildCopySql(), 'utf8');
  console.log(`已生成 ${FIRST_FILE}`);
}
