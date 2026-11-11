// 北京主数据库的全部表（美国比赛库的公开副本），按表名查。顺序就是建表顺序（被指向的表在前）。
// 字段类型、长度上限和美国共用，在 backend/共用/db/字段类型.mjs。
import 公开比赛 from './表/公开比赛.mjs';
import 公开届次 from './表/公开届次.mjs';

export const TABLES = Object.fromEntries([公开比赛, 公开届次].map(t => [t.表名, t]));
