// 美国比赛库的唯一入口：比赛、届次、来源、处理记录、后台记录、拒过的网址。读写方法是 共用/db 的，这里只给出美国的表和结构。
//   openDb({ file, readOnly })   打开比赛库（默认 DB_DIR/比赛库.db），补执行 结构/ 里没执行过的文件
//   比赛.*、届次.*、拒过的网址.*  常用查询
//   屏蔽网站.*                     百度搜索的屏蔽名单（内置 + 后台确认的，存在 后台状态 表）
//   TABLES                       美国的表
//   图片总库.*                    海报和候选图的文件（存、读、有）；届次里只记文件名
//   用户反馈.*                    纠错采纳后届次转审核、处理纠错和意见反馈的后台记录（正本在北京，结果经 沟通/审核结果回传 写回）
//   用户副本.*                    北京用户数据的只读副本（另一个库文件 DB_DIR/用户副本.db，只有用户数据同步写；后台只读）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb as openDatabase } from '../../共用/db/index.mjs';
import { TABLES } from './描述/index.mjs';
import * as 比赛 from './操作/比赛.mjs';
import * as 届次 from './操作/届次.mjs';
import * as 拒过的网址 from './操作/拒过的网址.mjs';
import * as 屏蔽网站 from './操作/屏蔽网站.mjs';
import * as 图片总库 from './图片总库/index.mjs';
import * as 用户副本 from './用户副本/index.mjs';
import * as 用户反馈 from './操作/用户反馈.mjs';

export { TABLES, 比赛, 届次, 拒过的网址, 屏蔽网站, 图片总库, 用户副本, 用户反馈 };
export { DbError, DB_ERROR_KINDS, validate, buildCreateSql, FIELD_TYPES, LIMITS } from '../../共用/db/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STRUCTURE_DIR = path.join(HERE, '结构');
export const defaultDbFile = () => path.join(process.env.DB_DIR || path.join(HERE, '数据'), '比赛库.db');

export function openDb({ file = defaultDbFile(), readOnly = false, now } = {}) {
  return openDatabase({ file, tables: TABLES, structureDir: STRUCTURE_DIR, readOnly, now });
}
