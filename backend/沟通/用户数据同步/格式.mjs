// 用户数据同步的格式（北京 → 美国，2026-11-02）。北京端、美国端共用这一份；签名和时效用公开比赛同步那一套（../公开比赛同步/格式.mjs）。
//
// 同步哪些表：北京副数据库的六张（账号、收藏、提醒、意见反馈、纠错、偏好）和收集报错库的两张（加载统计、报错日志）。
// 和美国 美国/db/用户副本/描述/北京副本.mjs 的 同步来的表 一致（美国收到不认识的表整批不收）。
// 账号去掉 openid、appid、unionid（用户 11-02 同意）：后台审查用不到，发提醒只在北京发，少一份身份信息出境。
//
// 一批的格式：{ 写们: [{ 表, 编号, data }], 删们: [{ 表, 编号 }], 轮次?, 收尾? }
//   轮次：整体重推时每批都带同一个；收尾：整体重推的最后一批带，美国清掉这一轮没写到的
export { 签名, 验签, 时间头, 签名头 } from '../公开比赛同步/格式.mjs';

export const 同步的表 = [
  { 表: 'user_account', 主键: 'id', 去掉: ['openid', 'appid', 'unionid'] },
  { 表: 'favorite', 主键: 'id' },
  { 表: 'reminder', 主键: 'id' },
  { 表: 'general_feedback', 主键: 'id' },
  { 表: 'feedback', 主键: 'id' },
  { 表: 'user_preference', 主键: 'user_id' },
  { 表: 'client_stats', 主键: 'date' },
  { 表: 'client_issues', 主键: 'id' },   // 只增不改，按编号接着推
];
const 按表 = new Map(同步的表.map(t => [t.表, t]));

export function 整理行(表, 行) {
  const 去掉 = 按表.get(表)?.去掉 || [];
  return Object.fromEntries(Object.entries(行).filter(([k]) => !去掉.includes(k)));
}
