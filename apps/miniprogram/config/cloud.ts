// 登录、用户数据、公开赛事和异常日志走北京正式域名。
// 微信小程序的 request 合法域名须包含该域名。
export const BEIJING_BACKEND_ENABLED: boolean = true;
export const BEIJING_API_BASE_URL = 'https://xiaohuiworks.cn';
export const USE_SELF_HOSTED_BACKEND = true;

export const API_BASE_URL = BEIJING_BACKEND_ENABLED ? BEIJING_API_BASE_URL : 'https://107-175-111-18.sslip.io';
// 赛事助手、信息纠错和意见反馈使用美国后端的独立会话。
export const FEEDBACK_API_BASE_URL = 'https://107-175-111-18.sslip.io';

// —— 以下是 CloudBase 时期的配置，迁移完成前保留，方便随时切回 ——

export const CLOUD_ENV_ID = 'daily-contest-dev-d8dbbhc653e221';

// 关闭北京开关时，登录、收藏和提醒使用上海云开发。
export const USER_DATA_ON_CLOUD = !BEIJING_BACKEND_ENABLED;

// 在微信公众平台「订阅消息」中申请模板后填写。
export const REMINDER_TEMPLATE_ID = 'Hdc1YLawcLjHfgiAjZYF6fJMkAMTwcPCHZYqLyvo2mY';
