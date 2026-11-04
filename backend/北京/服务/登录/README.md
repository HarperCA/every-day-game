# 登录（北京/服务/登录）

小程序登录：用 wx.login 拿到的 code 向微信换 openid，没有账号就建一个，交回签名的会话。

- **接替**：上海云函数 login
- **读写的数据**：副数据库：user_account
- **现在的状态**：能用，有测试（2026-11-02）。搬自上海 login，去掉云函数的兼容外壳：code 向微信换 openid（`共用/工具/微信.mjs`），账号用副数据库的 `用户.新建或登录`，交回令牌（`共用/工具/令牌.mjs`）。
- **交回**：`{ ok, data: { userId, isNewUser, openid, userSessionToken, userSessionExpiresAt } }`（令牌字段名照小程序已写好的自有服务器模式）；换不到身份 `无法取得微信用户身份`，停用 `user_account_disabled`（同上海）。

## 要搬过来的

- 上海云函数 login（已搬）
- 旧服务器 apps/server/src/userSession.mjs 的签名会话：改用 `共用/工具/令牌.mjs`（北京签、美国验，同一个密钥 SESSION_SIGNING_KEY）
- 旧服务器 wechat.mjs：已挪到 `共用/工具/微信.mjs`

## 规矩

- 只通过 `index.mjs` 里的 `handle(request, ctx)` 和外面打交道。
- 读写数据库只经 `../../主数据库/index.mjs`（公开副本）、`../../副数据库/index.mjs`（用户管理中心）；不直接引用美国的代码。
- 不收、不存客户端传来的 openid，身份一律由服务端核验。
