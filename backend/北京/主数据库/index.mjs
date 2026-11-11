// 北京主数据库的唯一入口：美国比赛库里已公开比赛、届次的只读副本（正本在美国）。读写方法和美国共用一套（backend/共用/db）。
//
//   openMainDb({ file, readOnly })   打开主数据库（默认 DB_DIR/主数据库.db），补执行 结构/ 里没执行过的文件
//   同步.收下(db, 批次)               收下美国推来的一批：版本号更大才覆盖，下架的删掉（同步/）
//   公开.*                           读取工具：全部条目（比赛和届次合成一条，给排序用）、按编号取一届或一个比赛（操作/）
//   海报.*                           海报文件（收、有、缺的），放在 DB_DIR/海报/，届次里只记文件名（操作/海报.mjs）
//   TABLES                           主数据库的表
// 只有同步能写；服务（首页、详情、收藏核对）只读。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../共用/db/index.mjs';
import { TABLES } from './描述/index.mjs';
import * as 公开 from './操作/公开.mjs';
import * as 同步 from './同步/index.mjs';
import * as 海报 from './操作/海报.mjs';

export { TABLES, 公开, 同步, 海报 };

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STRUCTURE_DIR = path.join(HERE, '结构');
export const defaultMainDbFile = () => path.join(process.env.DB_DIR || path.join(HERE, '数据'), '主数据库.db');

export function openMainDb({ file = defaultMainDbFile(), readOnly = false, now } = {}) {
  return openDb({ file, tables: TABLES, structureDir: STRUCTURE_DIR, readOnly, now });
}
