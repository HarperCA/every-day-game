# 服务器端说明（/opt/daily-contest）

这份说明同时放在仓库 `scripts/server/README.md` 和服务器 `/opt/daily-contest/README.md`。
**改代码在本地仓库改，再同步到服务器**；不要直接在服务器上改（以 root 身份改的文件立刻影响线上）。

看不懂 JavaScript 写法时，对照 [给 Python 使用者的 JavaScript 速查](../../docs/js-for-python.md)
（服务器上是同目录的 `JS速查.md`）。

---

## 一、目录一览

```
/opt/daily-contest/
├── server/            后端程序（Node，端口 8787，只对本机开放；nginx 把 /api/ 转过来）
│   └── data/app.db    ★ 赛事数据库（SQLite）
├── functions/         后端的业务函数：adminData（后台）、publicData（小程序读数据）、
│                      userData、login、sendReminders
├── cjs/               adminData 部分模块的副本，给下面的脚本直接调用（抽字段、判范围、打分）
├── crawler/           抓取层：统一网页抓取器（遵守 robots.txt、同站限速）、天池抓取器
│   └── cache/         网页缓存，可随时删
├── README.md          本文件
├── *.mjs / *.sh       定时任务脚本（见第二节，每个都有用）
├── pipeline.log       每轮抓取流水线的一行摘要
├── plans/             搜索计划、草稿追溯、主办方监测的每日报告和状态
├── runs/              每晚抓取流水线的完整运行记录，一晚一个文件夹
├── reports/           路线台账、发布验收的每日报告
├── backups/           改动前的备份（见第五节）
└── .admin-token 等    ★ 密钥文件，不要打开、不要外传（见第六节）
```

## 二、每个脚本是干什么的

时间都是**北京时间**。日志都在 `/var/log/daily-contest-<名字>.log`。

### 每 5 分钟

| 脚本 | 做什么 |
|---|---|
| `scheduled-ai-review.sh` | AI 审核：拿待审记录去读来源网页，让 AI 核对字段，结果写进审核意见 |
| `scheduled-field-verify.sh` | 已发布赛事的三项核验（名称、报名时间、链接）；已截止的先归档，其余每周核一遍 |
| `scheduled-reminders.sh` | 给订阅了的用户发报名截止提醒 |
| `pull-client-logs.mjs` | 把小程序上报的访问异常（加载失败、加载慢、退回美国、登录收藏提醒失败、程序报错）和每日成功加载次数，从上海拉回本地，后台“访问异常”页显示。2026-10-01 起 |
| `sync-public-cache.mjs` | 把有变化的公开赛事数据推到腾讯云开发上海环境（`publicSync` 云函数），小程序浏览赛事先读上海那份；没变化不发请求，每天整体核对一次。2026-10-01 起，原因：国内手机跨境访问美国服务器又慢又时常连不上 |

### 每天凌晨

| 时间 | 脚本 | 做什么 |
|---|---|---|
| 00:50 | `search-plan.mjs` | 排好当晚的搜索计划：额度按 追溯 60% / 覆盖空白 25% / 新词试探 15% 分配 |
| 01:00 | `run-crawl-pipeline.mjs` | **抓取流水线**，依次调用下面这些： |
| | 　`search-baidu.mjs` | 　调百度搜索找候选；丢弃的结果逐条留档 |
| | 　`crawler/crawl-tianchi.mjs` | 　抓天池平台 |
| | 　`platforms/upln.py` | 　抓辽宁省大学生创新创业平台（经上海中转，读附件正文） |
| | 　`crawler/lib/jevCandidateFilter.mjs` | 　AI 前置筛选：官方通知、官网放行，转载、校赛、新闻拦下 |
| | 　`resolve-notice-leads.mjs` | 　正式通知转去找赛事官网 |
| | 　`run-extract.mjs` | 　读详情页，AI 抽字段 |
| | 　`ingest-candidates.mjs` | 　过三道闸后写成草稿 |
| | 　`discovery.mjs`、`pipeline-ledger.mjs` | 　记来源链、记每轮结果 |
| 02:00 | `scheduled-archive.sh` | 报名已截止的已发布赛事转为已归档 |
| 02:15 | `trace-drafts.mjs` | 给信息不全的草稿搜补充线索（只记线索，不改字段） |
| 02:30 | `scheduled-rescore-review-drafts.sh` → `rescore-review-drafts.mjs` | 给待审草稿重新打分 |
| 02:40 | `draft-triage-expire-trace.mjs` | 追溯到期仍没结果的草稿转入隔离 |
| 03:00 | `scheduled-stale-draft-check.sh` | 标出超过 3 天没处理的草稿 |
| 03:20 | `route-ledger.mjs` | 统计每条搜索路线产出了多少合格赛事 |
| 03:40 | `verify-public-cache.mjs` | 发布验收：小程序看到的数据和库里是否一致 |
| 03:50 | `organizer-watch.mjs` | 打开已知主办方的通知栏目，看有没有新通知 |
| 12:17 | `backup-db.sh` | ★ 数据库每日备份到 `backups/app-日期.db.gz`，保留 14 天（crontab） |

定时配置在 `/etc/systemd/system/daily-contest-*.timer` 和 `.service`，仓库里是 `scripts/server/daily-contest-*`。
（timer 文件里写的是 UTC 时间，加 8 小时是北京时间。）

### 只在本地电脑上用的（仓库里有，服务器上没有）

| 脚本 | 做什么 |
|---|---|
| `deploy-selfhosted.sh` | 部署后端程序、后台网页、nginx 配置 |
| `sync-crawler.sh` | 把抓取相关脚本同步到服务器 |
| `sync-extract.sh` | 把抽取相关模块（cjs/）同步到服务器 |
| `admin-dashboard.nginx.conf` | nginx 配置 |

## 三、常用操作

```bash
# 看所有定时任务下次什么时候跑
systemctl list-timers "daily-contest-*"

# 看某个任务的最近日志
tail -50 /var/log/daily-contest-crawl.log

# 手动跑一次某个任务
systemctl start daily-contest-crawl

# 暂停 / 恢复某个定时任务
systemctl disable --now daily-contest-crawl.timer
systemctl enable --now daily-contest-crawl.timer

# 后端程序状态 / 重启
systemctl status daily-contest-api
systemctl restart daily-contest-api
```

## 四、改代码的流程

1. 在本地仓库改（`scripts/server/`、`scripts/crawler/`、`apps/miniprogram/cloudfunctions/`、`apps/server/`）；
2. 跑测试：`npx vitest run`；
3. 先备份服务器上要替换的文件到 `backups/<改动名-日期>/`；
4. 同步到服务器（对应关系见下表），需要时 `systemctl daemon-reload` 或重启后端；
5. 提交到 git。

| 仓库里 | 服务器上 |
|---|---|
| `scripts/server/*.mjs`、`*.sh` | `/opt/daily-contest/` |
| `scripts/server/daily-contest-*.service/.timer` | `/etc/systemd/system/` |
| `scripts/crawler/` | `/opt/daily-contest/crawler/` |
| `apps/miniprogram/cloudfunctions/<函数>/` | `/opt/daily-contest/functions/<函数>/` |
| `apps/miniprogram/cloudfunctions/adminData/` 部分模块 | `/opt/daily-contest/cjs/`（`sync-extract.sh`） |
| `apps/server/` | `/opt/daily-contest/server/` |
| `apps/admin/` 构建产物 | `/var/www/admin-dashboard/` |

## 五、备份

- `backups/app-*.db.gz`：数据库每日自动备份，保留 14 天。
- `backups/<改动名-日期>/`：改代码前留的旧版文件。
- `backups/<操作名-时间戳>/records-before.json`：批量改数据前的整库快照；同目录的 manifest、removed 文件列出这次动了哪几条。时间戳是 UTC。
- `backups/before-tidy-20260926.tar.gz`：2026-09-26 整理目录前的完整快照（不含依赖库）。

一次性脚本（批量导入、修补、删除、检查用的）跑完就不留在这里了，都在 git 历史里能找回。

## 六、密钥文件

| 文件 | 用途 |
|---|---|
| `.admin-token` | 管理后台口令，脚本调 adminData 用 |
| `.ai-key` | Kimi，AI 审核 |
| `.extract-key` | DeepSeek，抽字段 |
| `.sync-endpoint`、`.sync-secret` | 推送公开数据到上海 `publicSync` 云函数的地址和密钥（密钥同时配在该云函数的环境变量 SYNC_SECRET 里） |
| `.openrouter-key` | AI 前置筛选用的模型 |
| `.baidu-search-key` | 百度搜索接口 |
| `.wechat-appsecret` | 微信小程序 |
| `.dispatch-secret` | 定时任务调后端的内部口令 |

不要打开、截图、提交到 git 或发给别人。
