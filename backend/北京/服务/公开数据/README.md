# 公开数据（北京/服务/公开数据）

小程序首页的比赛列表（筛选、排序、分页一次交回）和详情页，从主数据库读。

- **接替**：上海云函数 publicData
- **读写的数据**：主数据库：public_competition、public_edition（只读）
- **现在的状态**：能用，有测试（2026-11-02）。
  - `list`：交给用户呈现模块（按 2026-11-01 定的推荐规则排序，字段名沿用上海的列表）；不搬上海 publicData 的列表代码（用户 11-02 定）
  - `get`：从主数据库读一届，交回全部公开内容，加上上海详情页认的字段名（event_id、event_level、data_status）和算好的报名状态
  - 两个动作都记一次加载成功（收集报错的统计表），记不上不影响返回；登录了的按入口核验的 openid 查用户编号，首页按他的收藏、提醒、偏好排
- **字段核对**（2026-11-02）：按小程序 services/publicRecord.ts hydratePublic 读的字段，用本地真实比赛库同步后的 359 届逐个看过。补了推荐的平铺字段（recommendation_suitable_for 等）和学校报名时间提示（school_timing_dependent、school_timing_note、timing_reliability，照上海 schoolTimingAdvice）。registration_end_note 建库时已并进 time_note；poster_url 详情页不用（上海详情也不给）。其余字段有的届次没有值时不给，小程序那边都有默认值。
- **信息来源（高校转发）**（2026-11-12 用户定）：追不到官方通知的新一届用“高校转发”发布。美国推来的届次 data 里多 `info_source`（`official` / `school_repost`）和 `info_source_url`（转发页网址），整份存在 public_edition.data 里，不用改表。交给小程序时换成 `infoSource`、`infoSourceUrl`（`用户呈现模块` 的 `信息来源()`，列表和详情共用）：
  - 详情：每一届都带；旧数据没有这两个字段、或值不认识的当 `official`，链接为空；转发链接只给 http(s) 的。
  - 列表卡片：只有高校转发的才带这两个字段（官方的卡片不加，和旧样例逐字一致，小程序缺省当 official）。
  - 小程序详情页标“信息来自高校转发，以官方通知为准”并可复制转发链接；首页卡片海报左上角一个小“高校转发”标记。
- **不再需要**：上海的 warm（保持云函数不休眠）、实例缓存——北京是常驻进程。

## 要搬过来的

- 上海云函数 publicData
- 美国首页新版列表（listVersion 2，10-24 起）的筛选和排序

## 规矩

- 只通过 `index.mjs` 里的 `handle(request, ctx)` 和外面打交道。
- 读写数据库只经 `../../主数据库/index.mjs`（公开副本）、`../../副数据库/index.mjs`（用户管理中心）；不直接引用美国的代码。
- 不收、不存客户端传来的 openid，身份一律由服务端核验。
