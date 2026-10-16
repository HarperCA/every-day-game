// 后端已迁到自有服务器（见 docs/migration-to-self-hosted.md）。
//
// 这个开关控制小程序走哪条路。默认仍然是 false（走 CloudBase），
// 因为切过去之前必须先在微信公众平台做两件事，代码解决不了：
//
//   1. 在「开发管理 → 开发设置 → 服务器域名」里，把 API_BASE_URL 的域名
//      加进 request 合法域名。必须 HTTPS、必须是域名（IP 不行），
//      而且修改次数每月有限。
//   2. 在「开发设置 → IP 白名单」里加上服务器 IP，否则服务器换不到
//      access_token，订阅消息发不出去。
//
// 这两步做完、真机验证通过之后，再把这里改成 true。
// 在开发者工具里可以先勾选「不校验合法域名」提前联调。
//
// 2026-09-18：服务器域名 + IP 白名单已配置，AppSecret 已写入服务器，
// 服务器换取 access_token 已验证成功（jscode2session 能正常联系到微信）。
// 最终替代上海的总开关；北京证书、域名白名单、数据核对、真机联调完成后才开启。
// 开启后登录、用户数据、公开赛事、异常日志均直连北京，不回落上海。
// 信息纠错/意见反馈属于美国主库业务，始终使用独立美国接口和会话。
export const BEIJING_BACKEND_ENABLED: boolean = false;
// 候选地址，须由部署环节验证 HTTPS 和微信合法请求域名后使用。
export const BEIJING_API_BASE_URL = 'https://154-8-197-241.sslip.io';
export const USE_SELF_HOSTED_BACKEND = true;

// 自有后端地址。sslip.io 是免费的「把 IP 编进域名」服务，解析回服务器 IP，
// 已配好 Let's Encrypt 证书，浏览器和微信都认这个 HTTPS。
// 将来买了正式域名，改这一行即可。
export const API_BASE_URL = BEIJING_BACKEND_ENABLED ? BEIJING_API_BASE_URL : 'https://107-175-111-18.sslip.io';
export const FEEDBACK_API_BASE_URL = 'https://107-175-111-18.sslip.io';

// —— 以下是 CloudBase 时期的配置，迁移完成前保留，方便随时切回 ——

export const CLOUD_ENV_ID = 'daily-contest-dev-d8dbbhc653e221';

// 2026-10-01 起：登录、收藏、提醒改由腾讯云开发上海环境处理（login、userData 云函数），走微信内网，不再跨境到美国服务器
// （实测从上海连美国服务器一次 3～8.6 秒）。身份由微信云开发直接给出，不再由请求自带。
// 纠错反馈仍走美国服务器：管理员在那边的后台审核。改回 false 即全部回到美国服务器。
export const USER_DATA_ON_CLOUD = !BEIJING_BACKEND_ENABLED;

// 在微信公众平台「订阅消息」中申请模板后填写。
export const REMINDER_TEMPLATE_ID = 'Hdc1YLawcLjHfgiAjZYF6fJMkAMTwcPCHZYqLyvo2mY';
