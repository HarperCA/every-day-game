// 搬旧数据 · 转换（纯计算，2026-11-02）：上海云开发导出的用户数据 → 北京副数据库的行、报错库的行，每个不搬的都记一条原因。
// 输入是 scripts/server/export-shanghai-users.py 导出的文件夹读进来的 { 集合名: [文档] }；字段名新旧一样（副数据库的表照旧上海集合建的）。
// 规则：
//   - 账号：编号（_id）原样保留，北京签的令牌、提醒、收藏都按它对上；没有 openid 的不搬
//   - 收藏：旧的挂届次，新的挂比赛（届次对照：届次编号 → 比赛编号，美国 建库/届次对照.mjs 导出）；同一人收藏同一比赛的几届合成一条，留最早的
//   - 提醒、偏好、纠错、意见反馈：照旧字段搬，去掉 _id、data_version；必填缺了、取值不在名单里的不搬（按副数据库表的描述检查）
//   - 挂在不存在的账号下的都不搬；选填的空字符串存成空（null）；时间统一成 ISO 文字（云开发导出偶尔是 { $date }）
//   - 报错日志按时间先后、去掉 _id；加载统计照搬
//   转换(旧, { 届次对照 }) → { 新: { 表: [行] }, 报错: { issues, stats }, 问题们: [{ 表, 编号, 原因 }] }
import { TABLES } from '../副数据库/index.mjs';

export const 表们 = ['user_account', 'favorite', 'reminder', 'user_preference', 'feedback', 'general_feedback'];

function 时间(值) {
  if (值 == null || 值 === '') return null;
  const 原 = typeof 值 === 'object' && 值.$date != null ? 值.$date : 值;
  const t = new Date(原);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

// 按表的描述只留认识的字段，规整时间和空值；交回 [行, 不对的原因]
function 规整(表, 文档, 主键值) {
  const 描述 = TABLES[表];
  const 行 = {};
  for (const [字段, 定义] of Object.entries(描述.字段)) {
    let 值 = 字段 === 描述.主键 ? 主键值 : 文档[字段];
    if (定义.类型 === '时间') 值 = 时间(值);
    if (值 === '' && !定义.必填) 值 = null;
    if (值 === undefined || 值 === null) {
      if ('默认' in 定义) continue;   // 交给数据库补默认值
      if (定义.必填) return [null, `缺 ${字段}`];
      值 = null;
    }
    if (定义.可选值 && 值 != null && !定义.可选值.includes(值)) return [null, `${字段} 的值 ${值} 不在名单里`];
    行[字段] = 值;
  }
  return [行, null];
}

const 编号 = 文档 => String(文档._id ?? 文档.id ?? '');

export function 转换(旧, { 届次对照 = {} } = {}) {
  const 问题们 = [];
  const 记 = (表, 号, 原因) => 问题们.push({ 表, 编号: 号, 原因 });
  const 新 = Object.fromEntries(表们.map(表 => [表, []]));

  for (const 文档 of 旧.user_account || []) {
    if (!文档.openid) { 记('user_account', 编号(文档), '没有 openid'); continue; }
    const [行, 错] = 规整('user_account', 文档, 编号(文档));
    if (错) 记('user_account', 编号(文档), 错); else 新.user_account.push(行);
  }
  const 账号们 = new Set(新.user_account.map(x => x.id));
  const 有账号 = (表, 号, 用户) => { if (账号们.has(用户)) return true; 记(表, 号, `账号 ${用户} 不在`); return false; };

  // 收藏：最早的在前，同一人同一比赛只留第一条
  const 收藏们 = [...(旧.favorite || [])].sort((a, b) => String(时间(a.created_at)).localeCompare(String(时间(b.created_at))));
  const 已收 = new Set();
  for (const 文档 of 收藏们) {
    const 号 = 编号(文档);
    if (!有账号('favorite', 号, 文档.user_id)) continue;
    const 比赛 = 届次对照[文档.edition_id];
    if (!比赛) { 记('favorite', 号, `届次 ${文档.edition_id} 对不上比赛`); continue; }
    if (已收.has(`${文档.user_id}|${比赛}`)) { 记('favorite', 号, '同一个比赛已有更早的收藏，合并'); continue; }
    已收.add(`${文档.user_id}|${比赛}`);
    const [行, 错] = 规整('favorite', { ...文档, competition_id: 比赛 }, 号);
    if (错) 记('favorite', 号, 错); else 新.favorite.push(行);
  }

  for (const 表 of ['reminder', 'user_preference', 'feedback', 'general_feedback']) {
    for (const 文档 of 旧[表] || []) {
      const 号 = 表 === 'user_preference' ? String(文档.user_id ?? 文档._id) : 编号(文档);
      if (!有账号(表, 号, 表 === 'user_preference' ? 号 : 文档.user_id)) continue;
      const [行, 错] = 规整(表, 文档, 号);
      if (错) 记(表, 号, 错); else 新[表].push(行);
    }
  }

  const issues = [...(旧.client_issues || [])]
    .map(({ _id: _编号, ...行 }) => 行)
    .sort((a, b) => String(a.at || a.received_at || '').localeCompare(String(b.at || b.received_at || '')));
  const stats = (旧.client_stats || []).map(x => ({ date: x.date ?? x._id, list: Number(x.list) || 0, get: Number(x.get) || 0 }));
  return { 新, 报错: { issues, stats }, 问题们 };
}
