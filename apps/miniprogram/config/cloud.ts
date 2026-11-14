// 小程序连哪台服务器。
//
// 登录、用户数据、纠错和意见反馈、公开赛事、异常日志都走北京（2026-11-04 切换，不留回退）。
// 域名要先加进微信公众平台「开发管理 → 开发设置 → 服务器域名」的 request 合法域名，必须 HTTPS。
export const API_BASE_URL = 'https://xiaohuiworks.cn';

// 赛事助手直连美国（2026-11-01 用户定，不经北京转发），带北京登录时签的令牌。
// sslip.io 是把 IP 编进域名的免费服务，解析回美国服务器。
// 新助手走新路径：旧路径 /api/assistant 还归旧服务器，线上旧版小程序在用。
export const ASSISTANT_API_BASE_URL = 'https://107-175-111-18.sslip.io';
export const ASSISTANT_API_PATH = '/new-api/assistant';

// 在微信公众平台「订阅消息」中申请模板后填写。
export const REMINDER_TEMPLATE_ID = 'Hdc1YLawcLjHfgiAjZYF6fJMkAMTwcPCHZYqLyvo2mY';

// 组队：有人申请时通知队长的订阅消息模板（2026-11-12 还没申请）。为空就不弹订阅、不调 addSubscribeQuota。
// 申请到后填这里，北京后端还要配 TEAM_APPLY_TEMPLATE_ID、TEAM_APPLY_TEMPLATE_FIELDS（见 北京/服务/组队/README.md）。
export const TEAM_APPLY_TEMPLATE_ID = '';
