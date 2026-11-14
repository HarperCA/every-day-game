// 北京副数据库（用户管理中心）的唯一入口：北京自己建、自己管。读写方法和美国共用一套（backend/共用/db）。
// 用户是一级，下面五张表都挂在用户编号上：收藏（只存比赛编号）、提醒（挂届次）、意见反馈、纠错（针对某一届）、偏好（每人一条）。
//
//   openUserDb({ file, readOnly })   打开副数据库（默认 DB_DIR/用户管理中心.db），补执行 结构/ 里没执行过的文件
//                                    readOnly：美国那份同步过来的副本用只读方式打开
//   用户.*  收藏.*  提醒.*  意见反馈.*  纠错.*  偏好.*     新建、写入、读取工具（操作/，每张表一个文件）
//   组队.*                           队伍、队员、组队申请（2026-11-08，操作/组队.mjs）
//   校赛.*                           校赛管理员申请、邀请码、本校学生、校赛（2026-11-08，操作/校赛.mjs）
//   TABLES                           副数据库的表
// 只管存取，不做业务判断：身份由服务端核验（不收客户端传的 openid）、提交频率限制、提醒什么时候发，都在 服务/。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../共用/db/index.mjs';
import { TABLES } from './描述/index.mjs';
import * as 用户 from './操作/用户.mjs';
import * as 收藏 from './操作/收藏.mjs';
import * as 提醒 from './操作/提醒.mjs';
import * as 意见反馈 from './操作/意见反馈.mjs';
import * as 纠错 from './操作/纠错.mjs';
import * as 偏好 from './操作/偏好.mjs';

export { TABLES, 用户, 收藏, 提醒, 意见反馈, 纠错, 偏好 };
// 组队（2026-11-08）：队伍、队员、组队申请的存取（操作/组队.mjs）
import * as 组队 from './操作/组队.mjs';
export { 组队 };
// 校赛（2026-11-08）：管理员申请、邀请、本校学生、校赛的存取（操作/校赛.mjs）；处理管理员申请、处理校赛 给美国审核结果回传用
import * as 校赛 from './操作/校赛.mjs';
export { 校赛 };

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STRUCTURE_DIR = path.join(HERE, '结构');
export const defaultUserDbFile = () => path.join(process.env.DB_DIR || path.join(HERE, '数据'), '用户管理中心.db');

export function openUserDb({ file = defaultUserDbFile(), readOnly = false, now } = {}) {
  return openDb({ file, tables: TABLES, structureDir: STRUCTURE_DIR, readOnly, now });
}
