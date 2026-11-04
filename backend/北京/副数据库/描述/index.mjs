// 北京副数据库（用户管理中心）的全部表，按表名查。用户是一级，其余五张都挂在用户编号上。顺序就是建表顺序（被指向的表在前）。
// 字段类型、长度上限和美国共用，在 backend/共用/db/字段类型.mjs。
import 用户 from './表/用户.mjs';
import 收藏 from './表/收藏.mjs';
import 提醒 from './表/提醒.mjs';
import 意见反馈 from './表/意见反馈.mjs';
import 纠错 from './表/纠错.mjs';
import 偏好 from './表/偏好.mjs';

export const TABLES = Object.fromEntries([用户, 收藏, 提醒, 意见反馈, 纠错, 偏好].map(t => [t.表名, t]));
