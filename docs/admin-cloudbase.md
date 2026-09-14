# 管理后台 CloudBase 配置

管理后台不再把浏览器 `localStorage` 作为主数据库。当前数据流为：

`React 管理后台 → adminData 管理云函数 → CloudBase 云数据库`

浏览器缓存只用于网络异常时保留当前页面数据，云端写入失败会在后台左下角显示错误。

## 已完成

- CloudBase Web SDK 已接入管理后台。
- `adminData` 普通云函数已部署到 `daily-contest-dev-d8dbbhc653e221`。
- 赛事、纠错、AI任务和操作日志均已接入云端读写队列。
- 管理员口令只由云函数环境变量校验，不打包进网页。

## 控制台只需配置一次

1. 在“文档型数据库”创建集合 `admin_state`。
2. `admin_state` 权限选择“无权限（仅管理员/云函数可读写）”。
3. 打开“云函数/托管 → adminData → 函数配置 → 环境变量”。
4. 新增变量名 `ADMIN_TOKEN`，值复制项目根目录 `.admin-token.local` 中等号后的内容。
5. 为 Kimi Code 赛事审核增加云函数环境变量：`AI_PROVIDER=kimi-code`、`AI_BASE_URL=https://api.kimi.com/coding/v1`、`AI_MODEL=kimi-for-coding` 和 `AI_API_KEY`。密钥只能保存在云函数中。该接入消耗 Kimi Code 会员额度；若改用产品级开放平台，只需替换这四个环境变量。
6. 在“身份认证 → 登录方式”开启“匿名登录”，供网页获取调用云函数所需的临时用户会话；匿名用户不能直接读写管理集合。
7. 在 Web 安全域名中加入后台正式域名。开发期间按 CloudBase 控制台要求配置 localhost/本地调试来源。

完成后，启动后台，在登录页输入同一个 `ADMIN_TOKEN`。首次登录会把30场种子赛事初始化到 `admin_state/competitions`，以后所有修改均写入云端。

登录成功后，长期 `ADMIN_TOKEN` 不再随每次请求发送；`adminData` 返回有效期8小时的 HMAC 签名会话令牌，浏览器仅在当前页面内存中保存。会话到期后需重新登录。部署或轮换口令后可在项目根目录运行 `pnpm admin:verify:cloud`，脚本只输出会话有效期和各集合记录数量，不输出长期口令、短期令牌或业务数据。

发布操作要求系统验证通过、人工审核通过，并至少有一个 `valid` 的官方来源。满足门槛的记录会与管理状态在同一事务内写入 `event_edition_public_cache`；下架时同一事务删除缓存。公开读取使用 `publicData`，应用函数权限规则后可运行 `pnpm public:verify:cloud` 验证只读契约。

“审核发布”页面的“运行 Kimi 审核”会由 `adminData` 云函数读取赛事来源：普通网页提取正文，图片链接直接作为视觉输入。返回的结构化建议会写入赛事 `aiReview` 字段及操作日志，但不会自动把来源设为有效、不会代替人工审核，也不会自动发布。

赛事、纠错和 AI 任务状态都带独立版本号。后台保存时必须携带启动数据返回的版本，并在云数据库事务内核对；缺少版本的旧客户端会被拒绝。若另一个页面已经先保存，当前写入会被拒绝并提示刷新，避免整组数据被旧页面静默覆盖。需要在线验证此保护时，可在 `apps/admin` 下运行 `node scripts/verify-admin-cloud.mjs --write-check`；该检查会用当前赛事记录做一次同值写入，再确认旧版本请求被拒绝，只会推进状态版本和更新时间，不会改变赛事内容。

## 安全边界

- 不要把 `ADMIN_TOKEN` 改成 `VITE_ADMIN_TOKEN`，`VITE_` 变量会进入前端构建产物。
- 不要把 `.admin-token.local` 上传到 Git；仓库已通过 `*.local` 忽略该文件。
- `audit_log` 由 `adminData` 云函数写入，前端不直接写数据库。
- 正式上线前应定期轮换管理员口令。
