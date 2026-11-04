// 按 副数据库/描述/ 生成北京副数据库（用户管理中心）的建表语句。生成方法和美国共用（共用/db 的 buildCreateSql）。
//   node backend/北京/副数据库/结构/生成.mjs      重新生成 001-建表.sql
// 上线前 001 可以重新生成；上线后改表只新增编号文件。测试会核对 001 和生成结果一致。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCreateSql } from '../../../共用/db/index.mjs';
import { TABLES } from '../描述/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIRST_FILE = path.join(HERE, '001-建表.sql');
export const buildUserSql = () => buildCreateSql(TABLES);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(FIRST_FILE, buildUserSql(), 'utf8');
  console.log(`已生成 ${FIRST_FILE}`);
}
