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
| 问答记录.mjs | 新，替换 conversationLog.js | 存在 `数据/问答记录.db`（不进 git），规则照旧：上下文最近 6 轮，保存 180 天；读写表的语句都在这里，`打开问答记录(file, { 只读: true })` 给后台用 |
| 聊天记录.mjs | 新（2026-11-12） | 给后台看聊天记录的接口：按天归档、按人分组，交回打码账号、用户输入和助手的回答，见下面“给后台的接口” |
| index.mjs | 新，替换 index.js | `回答(event, { openid, 比赛库, 问答记录, ai, 微信 })`：审查 → 准备工具 → assistantCore 回答；返回格式同旧云函数 |
| 审查.mjs | 新（旧 index.js 开头的三步合成一个） | 有没有 openid → 动作是不是 ask → 提问和参数合不合格（调 askValidation.js）；不合格交回和旧云函数一样的错误 |
| 工具.mjs | 新（旧 index.js 传给 assistantCore 的五个依赖合成一个） | `准备工具()` 交回 chat（经 AI 总管对话）、secCheck（微信内容检查）、loadRecords（读比赛）、loadHistory（读聊天历史）、saveLog（保存问答） |
| 接口.mjs | 新 | `POST /api/assistant` 的处理：验北京签的令牌（正文的 `userSessionToken`，小程序这样发；也认 `Authorization: Bearer`），openid 只认令牌里的；没令牌或签名不对 401 `unauthenticated`，过期 401 `user_session_expired`（小程序收到会重新登录再试），没配密钥 500 |
| 服务.mjs | 新 | 只接 `/api/assistant` 的小服务器，听本机 4320，由 nginx 转发；正式的美国后端建好后挂 接口.mjs，可以不用它 |

## 给后台的接口：聊天记录（2026-11-12 用户定）

后台“赛事助手 / 聊天记录”页只调 `聊天记录.mjs` 的这几个函数，不自己读 assistant_log 表。线上问答记录库在 `DB_DIR/问答记录.db`（美国 `/opt/competition-radar/data/`），和后台在同一台机器，后台只读打开。

| 函数 | 交回 |
| --- | --- |
| `打开聊天记录(file = DB_DIR/问答记录.db)` | 只读的记录库；库文件不存在或还没有表时是 `null`（不建文件） |
| `聊天日期们(记录库, { 页 = 1, 每页 = 30 })` | `{ 日期们: [{ 日期: 'YYYY-MM-DD', 人数, 条数 }], 总天数, 页, 每页 }`：有记录的日子，新的在前；每页最多 100 天 |
| `某天聊天(记录库, 'YYYY-MM-DD', { 账号备注 })` | `[{ 账号, 条数, 输入们: [{ 时间: 'HH:MM', 内容, 回答, 状态 }] }]`：这一天每人一块，人按这一天第一次说话的先后，每人的句子按时间先后，每句带着它自己那一轮的回答；日期写错了抛错。有备注的账号写成 `打码账号（备注）`，见下面“账号备注” |
| `读账号备注(file = 默认备注文件())` | `Map(openid → 备注)`；文件不存在、读不了、不是 JSON 对象时是空的，不报错 |
| `打码账号(openid)` | 前 6 位 + `…` + 后 4 位（openid 一般 28 位）；不到 13 位的只留头尾各 2 位，不到 6 位的全打掉，空的写“未知” |

- 日期、时间都是北京时间（created_at 是 UTC，加 8 小时）。一轮问答算一条，`内容` 是那一轮用户的输入（data 的 `message`），不管这轮答成没答成。
- `回答` 是这一轮给用户的回复文字（data 的 `reply`，assistantCore 存的，最多 600 字），2026-11-12 用户要求加上（之前特意不带）。`状态` 按 data 的 `status`（和 `replyViolations`）写一句短说明，正常回答是空字符串：
  - `answered` / `empty` / `clarify` / `chat`：`''`；但 `replyViolations` 不空（回答里有网址或对不上的日期，给用户的换成了固定句子）时写“原回答有网址或对不上的日期，换成了固定句子”
  - `blocked`（输入或回答被内容安全拦下）：“被内容安全拦下，回的是固定句子”，`回答` 照实交回用户看到的那句固定句子
  - `assistant_timeout` / `assistant_ai_failed` / `assistant_check_failed`：`回答` 是 `''`，状态“没有回答（超时 / AI 出错 / 内容安全检测出错）”；其他没有回答的写“没有回答（出错）”
- 只从 data 里取 `message`、`reply`、`replyViolations` 的条数和 `status`；不带完整 openid、会话编号，也不带模型原始输出、工具调用等别的字段。
- 记录库是 `null` 时两个函数都交回空的，后台显示“还没有聊天记录”。

### 账号备注（2026-11-12 用户定）

后台认得出某个账号是谁（比如用户本人），在打码账号后面写备注：`osMF63…Fa1w（管理员）`。备注直接拼进 `账号` 字段，不另加字段，页面不用改；仍然不交完整 openid。

- 备注文件：默认 `DB_DIR/账号备注.json`（和 `问答记录.db` 同一个目录；美国线上是 `/opt/competition-radar/data/账号备注.json`，root 所有、权限 600）；环境变量 `ASSISTANT_ACCOUNT_NOTES_FILE` 能指到别的文件。
- 格式：`{ "<完整 openid>": "备注" }`，一个账号一行。openid 只写在服务器上的这个文件里，不写进代码、不进 git。
- `某天聊天` 没给 `账号备注` 时每次现读这个文件，改了不用重启后台；文件不存在、不是 JSON 对象时当没有备注，不报错。
- 备注当文字处理：去掉控制字符（含换行）和 `< > & " '`、反引号，像 openid 的长串（13 个以上字母数字）打码，最多 20 个字；空的、不是字符串的不要。页面用文字节点显示，不当 HTML。

## 还没做

- 北京登录时签发令牌：北京登录服务还是占位，建好后调 `签发令牌(openid, 密钥)` 一行，随登录结果给小程序。
- 小程序改调用：小程序已有的自有服务器模式会先到助手所在的服务器调 `/api/login` 取令牌，美国没有登录；改成用北京登录拿到的令牌（两台共用密钥，美国能验）。
- 已部署（2026-11-04）：美国 nginx 把 `/new-api/assistant` 转进来，两台配同一个 SESSION_SIGNING_KEY。旧路径 `/api/assistant` 还归旧服务器。

## 测试

`test/单独/`：旧测试原样（assistant-*、wechat-msg-sec-check），加 `对接.test.mjs` 测三处对接和入口，`接口.test.mjs`、`服务.test.mjs` 测令牌校验和 HTTP 入口，`聊天记录.test.mjs` 测给后台的接口（按北京日期分天、按人分组、打码、回答和问题配对、没有回答时的状态说明、不带完整 openid、只读、账号备注：有备注写“（备注）”、没备注不变、文件不存在或坏了不报错、默认文件和环境变量、备注清洗）。在 `backend/Environment` 下 `npx vitest run --config vitest.config.mjs ../美国/赛事助手`。
