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
export const USE_SELF_HOSTED_BACKEND = true;

// 自有后端地址。sslip.io 是免费的「把 IP 编进域名」服务，解析回服务器 IP，
// 已配好 Let's Encrypt 证书，浏览器和微信都认这个 HTTPS。
// 将来买了正式域名，改这一行即可。
export const API_BASE_URL = 'https://107-175-111-18.sslip.io';

// —— 以下是 CloudBase 时期的配置，迁移完成前保留，方便随时切回 ——

export const CLOUD_ENV_ID = 'daily-contest-dev-d8dbbhc653e221';

// 在微信公众平台「订阅消息」中申请模板后填写。
export const REMINDER_TEMPLATE_ID = '1-cgPt-WP5tLOUwCNBhr5YMtEIQ-SneYzQbWTURiTCo';
