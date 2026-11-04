// 美国比赛库的全部表，按表名查。顺序就是建表顺序（被指向的表在前）。
// 用户、收藏、提醒、反馈在北京用户库，见 backend/北京/副数据库/描述/。
import 比赛 from './表/比赛数据/比赛.mjs';
import 届次 from './表/比赛数据/届次.mjs';
import 来源 from './表/比赛数据/来源.mjs';
import 处理记录 from './表/比赛数据/处理记录.mjs';
import 后台记录 from './表/后台/后台记录.mjs';
import 不收录 from './表/后台/不收录.mjs';
import 拒过的网址 from './表/寻找流程/拒过的网址.mjs';
import 后台状态 from './表/后台/后台状态.mjs';

export { FIELD_TYPES, LIMITS } from '../../../共用/db/字段类型.mjs';
export const TABLES = Object.fromEntries([比赛, 届次, 来源, 处理记录, 后台记录, 不收录, 拒过的网址, 后台状态].map(t => [t.表名, t]));
