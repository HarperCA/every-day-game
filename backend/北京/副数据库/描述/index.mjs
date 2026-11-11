// 北京副数据库（用户管理中心）的全部表，按表名查。用户是一级，其余五张都挂在用户编号上。顺序就是建表顺序（被指向的表在前）。
// 字段类型、长度上限和美国共用，在 backend/共用/db/字段类型.mjs。
import 用户 from './表/用户.mjs';
import 收藏 from './表/收藏.mjs';
import 提醒 from './表/提醒.mjs';
import 意见反馈 from './表/意见反馈.mjs';
import 纠错 from './表/纠错.mjs';
import 偏好 from './表/偏好.mjs';
// 校赛（2026-11-08）：上线后新增，建表语句在 结构/003-校赛.sql（表描述里写了 结构文件）
import 校赛管理员 from './表/校赛管理员.mjs';
import 校赛学生 from './表/校赛学生.mjs';
import 校赛邀请 from './表/校赛邀请.mjs';
import 校赛 from './表/校赛.mjs';
const 校赛的表 = [校赛管理员, 校赛学生, 校赛邀请, 校赛];
// 组队（2026-11-08）：上线后新增，建表语句在 结构/002-组队.sql（表描述里写了 结构文件）
import 队伍 from './表/队伍.mjs';
import 队员 from './表/队员.mjs';
import 组队申请 from './表/组队申请.mjs';
import 组队通知次数 from './表/组队通知次数.mjs';   // 2026-11-09：订阅消息“有人申请入队”还能发几条
const 组队的表 = [队伍, 队员, 组队申请, 组队通知次数];

export const TABLES = Object.fromEntries([用户, 收藏, 提醒, 意见反馈, 纠错, 偏好, ...校赛的表, ...组队的表].map(t => [t.表名, t]));
