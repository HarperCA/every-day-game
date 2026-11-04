# 赛事助手

小程序里的对话助手。2026-11-01 用户定：放美国服务器，**照搬旧代码，不重构**，只换三处对接。

旧代码来源：`每日竞赛/apps/miniprogram/cloudfunctions/assistant/`（上海云函数）。

## 文件

| 文件 | 来源 | 说明 |
| --- | --- | --- |
| assistantCore.js、tools.js、prompt.js、askValidation.js、publicQuery.js、competitionRanking.js、competitionValue.js、majorKeywords.js、undergraduateMajors2026.json、secCheck.js | 旧云函数，原样 | 流程、提示词、工具、筛选排序、内容安全 |
| （微信接口） | 旧服务器 `apps/server/src/wechat.mjs`，原样 | 微信 access_token 和 msgSecCheck；2026-11-02 挪到 `共用/工具/微信.mjs`，北京登录、发提醒也用 |
| AI总管对话.mjs | 新，替换 deepseek.js | 经 AI 总管调 DeepSeek（用途 assistant，实时车道），用量统一记账 |
| 读比赛.mjs | 新，替换 publicRecords.js | 用比赛库工具读已发布、已归档的届次，整理成旧公开缓存的字段 |
| 问答记录.mjs | 新，替换 conversationLog.js | 存在 `数据/问答记录.db`（不进 git），规则照旧：上下文最近 6 轮，保存 180 天 |
| index.mjs | 新，替换 index.js | `回答(event, { openid, 比赛库, 问答记录, ai, 微信 })`：审查 → 准备工具 → assistantCore 回答；返回格式同旧云函数 |
| 审查.mjs | 新（旧 index.js 开头的三步合成一个） | 有没有 openid → 动作是不是 ask → 提问和参数合不合格（调 askValidation.js）；不合格交回和旧云函数一样的错误 |
| 工具.mjs | 新（旧 index.js 传给 assistantCore 的五个依赖合成一个） | `准备工具()` 交回 chat（经 AI 总管对话）、secCheck（微信内容检查）、loadRecords（读比赛）、loadHistory（读聊天历史）、saveLog（保存问答） |
| 接口.mjs | 新 | `POST /api/assistant` 的处理：验北京签的令牌（正文的 `userSessionToken`，小程序这样发；也认 `Authorization: Bearer`），openid 只认令牌里的；没令牌或签名不对 401 `unauthenticated`，过期 401 `user_session_expired`（小程序收到会重新登录再试），没配密钥 500 |
| 服务.mjs | 新 | 只接 `/api/assistant` 的小服务器，听本机 4320，由 nginx 转发；正式的美国后端建好后挂 接口.mjs，可以不用它 |

## 还没做

- 北京登录时签发令牌：北京登录服务还是占位，建好后调 `签发令牌(openid, 密钥)` 一行，随登录结果给小程序。
- 小程序改调用：小程序已有的自有服务器模式会先到助手所在的服务器调 `/api/login` 取令牌，美国没有登录；改成用北京登录拿到的令牌（两台共用密钥，美国能验）。
- 已部署（2026-11-04）：美国 nginx 把 `/new-api/assistant` 转进来，两台配同一个 SESSION_SIGNING_KEY。旧路径 `/api/assistant` 还归旧服务器。

## 测试

`test/单独/`：旧测试原样（assistant-*、wechat-msg-sec-check），加 `对接.test.mjs` 测三处对接和入口，`接口.test.mjs`、`服务.test.mjs` 测令牌校验和 HTTP 入口。在 `backend/Environment` 下 `npx vitest run --config vitest.config.mjs ../美国/赛事助手`。
