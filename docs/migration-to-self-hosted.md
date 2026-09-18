# 从 CloudBase 迁移到自有服务器

## 为什么做这件事

不是因为 CloudBase 坏了，是因为架构已经在裂：

- 云函数 60 秒硬上限撑不住批量抽取，重活早就搬到服务器上跑了
- `sync-extract.sh` 现在同步 7 个模块到服务器，**同一份代码维护两份拷贝**
- 云函数运行时锁在 Node 16.13（已 EOL），服务器是 Node 20
- 浏览器访问 CloudBase 要配「安全来源」白名单，纯 IP 不被接受

实际耦合程度很低——后端 3757 行代码里只有约 60 行是 CloudBase 专有的：

| 云函数 | 总行数 | CloudBase 专有 |
|---|---|---|
| adminData | 2605 | 13 |
| publicData | 515 | 5 |
| userData | 423 | 22 |
| login | 41 | 5 |
| sendReminders | 173 | 15 |

98.4% 是纯业务逻辑，放哪都能跑。

## 搬不走的部分

微信对三件事有绝对控制权，跟后端放哪无关：

1. **用户身份**——`cloud.getWXContext()` 一行拿到 openid，是微信和腾讯云之间的内建信任通道。搬走后要自己用 AppSecret 调 `jscode2session` 换 openid。
2. **订阅消息**——`cloud.openapi.subscribeMessage.send()` 现在帮我们管 access_token。搬走后要自己换 token（2 小时有效，要缓存刷新），并且**服务器 IP 要加进微信公众平台的 IP 白名单**。
3. **能连哪个服务器**——`wx.request()` 的目标域名必须在微信公众平台登记，必须 HTTPS + 真域名，修改次数有限制。

所以域名这件事，迁不迁都躲不掉。

## 要迁的东西

**7 个集合：**

| 集合 | 用途 | 形态 |
|---|---|---|
| `admin_state` | records / feedbacks / ai_jobs / 运行日志 | 整表 JSON + 版本号乐观锁 |
| `event_edition_public_cache` | 已发布赛事（小程序读这个） | 每条一个文档 |
| `audit_log` | 审计记录 | 追加 |
| `user_account` | openid → userId | 每用户一行 |
| `favorite` | 收藏 | 每用户多行 |
| `reminder` | 提醒 | 每用户多行 |
| `feedback` | 用户纠错提交 | 追加 |

**27 个接口：**

- `adminData` 13 个：bootstrap / saveRecords / saveFeedbacks / saveAiJobs / syncFeedbacks / appendAudit / aiReviewConfig / aiImageProbe / extractFromDetailPage / runCompetitionAiReview / runScheduledAiReview / dispatchReminders / reminderInvocationLog
- `userData` 11 个：listFavorites / setFavorite / mergeFavorites / listReminders / upsertReminders / removeReminder / removeRemindersForEdition / replaceReminderEvent / mergeReminders / listFeedback / submitFeedback
- `publicData` 2 个：list / get
- `login` 1 个

## 技术选型

- **数据库：SQLite**（`better-sqlite3`）。数据量是 58 条记录级别，单文件、ACID 事务、备份就是复制文件。`admin_state` 那套「整表替换 + 版本号」映射成 JSON 列几乎 1:1；`favorite`/`reminder` 这类要真查询的，SQLite 也扛得住。
- **HTTP 层：Express**。够用，不引入没必要的框架。
- **业务模块：原样复用**。`competitionValue` / `competitionAdmission` / `competitionExtract` / `competitionAiReview` / `candidateToRecord` / `publicCache` / `publicQuery` / `adminAuth` 这些都是纯 JS，不用改。

## 分阶段

每一步都要能独立验证、能回退，不能一次性切换。

### 阶段 1：服务端 API + SQLite ✅ 已完成
- [x] `apps/server/` Express 应用
- [x] SQLite 通用文档存储（不是 7 张带字段的表——字段映射就有丢字段的机会）
- [x] **不重写业务逻辑**：写 CloudBase 兼容外壳，5 个云函数原样加载
- [x] 数据导出 + 导入 + 逐表哈希校验（93 条记录全部一致）
- [x] 验证：bootstrap 返回 58 条记录、乐观锁冲突被正确拒绝、写入事务正常

### 阶段 2：后台前端切过来 ✅ 已完成
- [x] admin 前端改调自有 API（只动了 adminCloud.ts 里四处）
- [x] **「安全来源」CORS 问题随之消失**——浏览器实测拿到正常业务响应而不是 Failed to fetch
- [x] 附带：前端产物少了 753KB（CloudBase SDK 整个移除）

### 阶段 3：域名 + HTTPS ✅ 已完成（没花钱）
- [x] 用 sslip.io 免费域名 `107-175-111-18.sslip.io`，不用买
- [x] Let's Encrypt 证书已签发并安装，HTTP 自动跳 HTTPS
- [x] 证书自动续期（certbot 已配置定时任务）
- 将来买正式域名的话，改 `apps/miniprogram/config/cloud.ts` 的 `API_BASE_URL` 再签一次证书即可

### 阶段 4：微信集成 ⚠️ 代码完成，等配置
- [x] `jscode2session` 换 openid（`src/wechat.mjs`）
- [x] access_token 缓存 + 提前 5 分钟续期 + 并发只换一次
- [x] 订阅消息发送，字段形状和 `cloud.openapi.subscribeMessage.send` 一致，sendReminders 不用改
- [x] 11 个测试覆盖（含 40164 IP 白名单错误的可读提示）
- [ ] **需要你做**：微信公众平台「开发设置 → IP 白名单」加上 `107.175.111.18`
- [ ] **需要你做**：AppSecret 写进服务器 `/opt/daily-contest/.wechat-appsecret`（和其它密钥同一套约定，不经过聊天）

### 阶段 5：小程序切过来 ⚠️ 代码完成，等配置
- [x] `wx.cloud.callFunction` → `wx.request`（3 处调用点都改好了）
- [x] 用开关 `USE_SELF_HOSTED_BACKEND` 控制走哪条路，**默认仍为 false**，
      配置没做完之前不会切过去，小程序保持现状可用
- [ ] **需要你做**：微信公众平台「开发管理 → 开发设置 → 服务器域名」把
      `https://107-175-111-18.sslip.io` 加进 request 合法域名（每月修改次数有限）
- [ ] 配好后把开关改成 true，真机验证

### 阶段 6：下线 CloudBase
- [ ] 观察期（双写/双跑一段时间）
- [ ] 确认无回流后停用云函数

## 风险与对策

| 风险 | 对策 |
|---|---|
| 数据迁移丢失/错位 | 迁移后逐表比对条数与内容哈希；CloudBase 侧保留不删，随时可回退 |
| 单点故障（一台 VPS 挂了全挂） | 每日 SQLite 文件备份 + 异地留存；这是自托管的固有代价，接受它 |
| 微信登录写错导致用户登不进 | 阶段 4 先在测试环境验证，阶段 5 灰度切换 |
| AppSecret 泄露 | 和现有密钥同一套约定：单行文件、chmod 600、不进代码、不进聊天 |
