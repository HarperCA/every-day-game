# 基础工具（backend/共用/工具）

美国（AI 总管、每晚流程）、北京、沟通都要用的基础工具，全后端只放这一份。
这里的文件**不引用 backend 里任何别的文件夹**，可以单独拿去别的项目用。

| 文件 | 作用 | 用法 |
|---|---|---|
| `concurrency.mjs` | 并发池：限制同时请求数、请求间隔、同一网站间隔，失败按次数重试、等待时间翻倍 | `createPool({ limit: 8, perHostGapMs: 1500, retries: 2 })`，再 `pool.map(items, fn, { hostOf })` |
| `budget.mjs` | 额度：每家接口能用多少，用完就不再派发 | `createBudget({ deepseek: 1000 })`，`budget.use('deepseek')` 返回 `false` 表示用完 |
| `提示词.mjs` | 读文件夹里的 prompt.md：第一行是版本号，把 {{变量}} 换成实际内容 | `loadPrompt(new URL('./prompt.md', import.meta.url), { 候选: '…' })` → `{ version, text }` |
| `log.mjs` | 统一日志：每行带时间、模块名、级别 | `createLogger(file).child('04-extract').info('…')` |
| `sqlite.mjs` | 打开 SQLite（better-sqlite3） | `openSqlite(file)`；库装在 `backend/Environment/` |
| `微信.mjs` | 直接对接微信接口：小程序 code 换 openid、access_token（缓存复用）、订阅消息、内容安全；搬自旧服务器 apps/server/src/wechat.mjs，原样 | `new WeChatClient(readWeChatConfig())`，`.exchangeCode(code)` → `{ openid, unionid }` |
| `令牌.mjs` | 登录令牌：北京登录时签发，美国收到请求时校验，两边共用密钥 SESSION_SIGNING_KEY；默认 2 小时有效 | `签发令牌(openid, 密钥)`；`校验令牌(令牌, 密钥)` → `{ ok, openid }` 或 `{ ok:false, 原因 }` |

| `请求正文.mjs` | 小服务器读请求正文：先收齐字节再一次转文字，上限按字节算（2026-11-03：原来逐块转文字，汉字切在两块之间成乱码，同步签名对不上） | `读正文(req, 上限字节)` → `{ 正文 }` 或 `{ 太大: true }` |

规矩：不引用 `美国/`、`北京/`、`沟通/` 等任何别的文件夹；不写死路径；出错不悄悄吞掉。
