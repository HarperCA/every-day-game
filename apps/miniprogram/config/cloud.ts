// 在微信开发者工具“云开发”中创建环境后填写环境 ID。
// 留空时使用开发者工具当前选择的默认云环境，正式上传前必须改为明确的环境 ID。
export const CLOUD_ENV_ID = 'daily-contest-dev-d8dbbhc653e221';

// 已切换为读取云端公开缓存。
// 前置条件：云函数权限规则已应用（否则 publicData 返回 EXCEED_AUTHORITY），
// 且 event_edition_public_cache 中已有通过全部发布门槛的数据。
// 任一条件未满足时，小程序列表会显示错误或空结果——此时可临时改回 false 用本地种子数据。
export const USE_CLOUD_PUBLIC_DATA = true;

// 在微信公众平台“订阅消息”中申请模板后填写。
export const REMINDER_TEMPLATE_ID = '1-cgPt-WP5tLOUwCNBhr5YMtEIQ-SneYzQbWTURiTCo';
