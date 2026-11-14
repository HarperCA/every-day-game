# 用户数据（北京/服务/用户数据）

收藏和取消、设和取消提醒、偏好、提交纠错和意见反馈、查自己的记录。收藏、提醒用主数据库核对比赛和届次在不在。

- **接替**：上海云函数 userData
- **读写的数据**：副数据库：user_account（含 11-09 加的昵称、头像）、favorite、reminder、general_feedback、feedback、user_preference；主数据库（只读，核对比赛和届次在不在）
- **现在的状态**：能用，有测试（2026-11-02）。搬自上海 userData，去掉云函数的兼容外壳：14 个动作、校验（`*.js` 原样）、交回格式同上海，存取改调副数据库的工具。
- **和上海不同的三处**：身份由入口校验令牌后交进 openid；收藏挂比赛（小程序照旧传届次，按主数据库换成比赛，列出时交回最新一届）；纠错限频改成数最近 24 小时交了几条（每人每天 20 条，同上海）。
- **2026-11-09 加的（上海没有）**：昵称头像 `getProfile {}`、`saveProfile { nickname?, avatarUrl? }` → `{ nickname, avatarUrl }`，组队里给队友看。只改给了的那一项，空字符串清掉；昵称最多 30 字；头像只收 https 网址、最长 500。存在 user_account 的 nickname、avatar_url（`副数据库/结构/004-用户昵称头像.sql`），不同步到美国。
- **2026-11-12 加上传头像（小程序组队用）**：见下面“上传头像”。
- **不搬的**：把快到期的提醒推给美国（reminderPush），北京的发提醒服务自己读到期的提醒。

## 上传头像（2026-11-12）

小程序 `chooseAvatar` 给的是本地临时文件，先传到北京换成 https 网址。代码在 `头像.mjs`（不走 `handle`，正文是图片），入口 `POST /api/uploadAvatar`。

- **调用**：`wx.uploadFile({ url: 'https://xiaohuiworks.cn/api/uploadAvatar', filePath, name: 'file', header: { Authorization: 'Bearer <令牌>' } })`。令牌**只认请求头**（multipart 正文里不放）。
- **交回**（JSON 文字，`wx.uploadFile` 的 `res.data` 要自己 `JSON.parse`）：成功 `{ ok: true, data: { avatarUrl } }`，同时已经把 `avatarUrl` 写进这个用户的资料（user_account.avatar_url），不用再调 `saveProfile`。
  失败 `{ ok: false, message }`（HTTP 200）：`avatar_too_large`（图超过 1 MB）、`unsupported_image_type`（不是 jpeg/png/webp）、`invalid_upload`（不是 multipart、没有 `file` 文件字段）、`avatar_upload_unavailable`（服务器没配头像地址）、`unauthenticated`、`user_account_disabled`。
  入口层：没令牌、签名不对 401 `unauthenticated`，过期 401 `user_session_expired`（同别的接口）；正文超过 1 MB + 64 KB 回 413 `request_too_large`。
- **只收的图**：1 MB 以内的 jpeg、png、webp。看文件头（`共用/工具/图片.mjs` 的 `图片大小`，读得出格式和宽高才算），不信扩展名和 Content-Type；存的扩展名按文件头定。不缩放、不转码。
- **存哪**：`AVATAR_DIR`（默认 `DB_DIR/头像/`；正式部署放 `/opt/competition-radar/avatars/`，和海报一样单独放，nginx 能读）。
  文件名 `<用户标记>-<随机 32 位十六进制>.<jpg|png|webp>`，用户标记 = HMAC(SESSION_SIGNING_KEY, 用户编号) 前 16 位，不带 openid 和用户编号。
  同一用户只留最新一张：新图存好、资料改好后，按用户标记删掉这个人的旧文件。不按资料里的旧网址删（资料网址用户能经 saveProfile 改成别人的文件）。
- **对外网址**：`AVATAR_BASE_URL`（必须 https，例如 `https://xiaohuiworks.cn/avatars`）+ `/` + 文件名。照海报：nginx 直接给头像文件夹，入口不读文件。没配 `AVATAR_BASE_URL` 上传回 `avatar_upload_unavailable`。
- **部署要做**（还没做）：
  1. `beijing.env` 加 `AVATAR_DIR=/opt/competition-radar/avatars`、`AVATAR_BASE_URL=https://xiaohuiworks.cn/avatars`；建目录（ubuntu 可写、755，nginx 能读）。入口服务是 `UMask=0077`，代码写完文件会显式改成 644，不用改 service。
  2. nginx（`部署/nginx-competition-radar.conf` 已写好）：加 `location = /api/uploadAvatar`（`client_max_body_size 2m`，原来 `/api/` 只放 128k）和 `location /avatars/`（alias 到头像目录）。
  3. 小程序后台“服务器域名”的 uploadFile 合法域名加 `https://xiaohuiworks.cn`（request 域名有了，uploadFile 是单独一栏）。
- **没做的**：注销账号（`用户.删除`）不删头像文件；用户经 `saveProfile` 把头像改成别的网址后，原来上传的文件留在文件夹里，下次上传时才删。

## 要搬过来的

- 上海云函数 userData（favoriteValidation、reminderValidation、reminderWritePolicy、preferenceValidation、feedbackValidation、feedbackRateLimit、generalFeedback）

## 规矩

- 只通过 `index.mjs` 里的 `handle(request, ctx)` 和 `上传头像(请求, ctx)`（index.mjs 转出 头像.mjs 的）和外面打交道。
- 读写数据库只经 `../../主数据库/index.mjs`（公开副本）、`../../副数据库/index.mjs`（用户管理中心）；不直接引用美国的代码。
- 不收、不存客户端传来的 openid，身份一律由服务端核验。

保存昵称前调用微信文本内容安全检查。微信明确判定违规时返回 `content_not_allowed` 并保留原昵称，接口异常记日志后继续处理。
