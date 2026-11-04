# 用户数据（北京/服务/用户数据）

收藏和取消、设和取消提醒、偏好、提交纠错和意见反馈、查自己的记录。收藏、提醒用主数据库核对比赛和届次在不在。

- **接替**：上海云函数 userData
- **读写的数据**：副数据库：user_account、favorite、reminder、general_feedback、feedback、user_preference；主数据库（只读，核对比赛和届次在不在）
- **现在的状态**：能用，有测试（2026-11-02）。搬自上海 userData，去掉云函数的兼容外壳：14 个动作、校验（`*.js` 原样）、交回格式同上海，存取改调副数据库的工具。
- **和上海不同的三处**：身份由入口校验令牌后交进 openid；收藏挂比赛（小程序照旧传届次，按主数据库换成比赛，列出时交回最新一届）；纠错限频改成数最近 24 小时交了几条（每人每天 20 条，同上海）。
- **不搬的**：把快到期的提醒推给美国（reminderPush），北京的发提醒服务自己读到期的提醒。

## 要搬过来的

- 上海云函数 userData（favoriteValidation、reminderValidation、reminderWritePolicy、preferenceValidation、feedbackValidation、feedbackRateLimit、generalFeedback）

## 规矩

- 只通过 `index.mjs` 里的 `handle(request, ctx)` 和外面打交道。
- 读写数据库只经 `../../主数据库/index.mjs`（公开副本）、`../../副数据库/index.mjs`（用户管理中心）；不直接引用美国的代码。
- 不收、不存客户端传来的 openid，身份一律由服务端核验。
