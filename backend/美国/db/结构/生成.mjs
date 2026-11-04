// 按 美国/db/描述/ 生成美国比赛库的建表语句。生成方法和北京共用（共用/db 的 buildCreateSql）。
//   node backend/美国/db/结构/生成.mjs      重新生成 001-建表.sql
// 2026-11-03 起线上有新库：001 不再重新生成，改表只新增编号文件（已有 002 起的文件时这个命令拒绝写，免得 001 和后面的文件重复加列）。
// 测试按顺序执行全部文件建库，和 buildUsSql() 生成的比表和索引。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCreateSql } from '../../../共用/db/index.mjs';
import { TABLES } from '../描述/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIRST_FILE = path.join(HERE, '001-建表.sql');
export const buildUsSql = () => buildCreateSql(TABLES);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const 后来的 = fs.readdirSync(HERE).filter(名 => /^\d{3}-.+\.sql$/.test(名) && !名.startsWith('001-'));
  if (后来的.length) { console.error(`已有 ${后来的.join('、')}：001 不能再重新生成，改表请新增编号文件`); process.exit(1); }
  fs.writeFileSync(FIRST_FILE, buildUsSql(), 'utf8');
  console.log(`已生成 ${FIRST_FILE}`);
}
