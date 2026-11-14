# 定时（美国/定时）

美国服务器上九个 systemd 定时器的配置。时间一律按北京时间（服务器系统时区是 UTC，定时器里写明 `Asia/Shanghai`）。2026-11-01 用户定，之后陆续改：

| 任务 | 时间 | 跑什么 | 做什么 |
|---|---|---|---|
| 每晚流程 | 每天 1:00 | `美国/pipeline/run.mjs` | 搜索 → 去重 → 筛选 → 读详情和抽取 → 审核 → 入库 |
| 每日归档 | 每天 2:00 | `美国/db/维护/归档/run.mjs` | 报名已截止的已发布届次全部归档，算下一届预计（2026-11-03，接替旧系统的 daily-contest-archive.timer，时间一样） |
| 新维护 | 每天 10:00 | `美国/db/新维护/运行.mjs --上限 45 --并发 4 --报告 …` | 按调度挑到期的比赛，最多 45 个、同时 4 个；只改确定事实，其余只补空（2026-11-09 上线，11-12 照线上补进仓库）。拿不到维护锁就等 |
| 后台多选的维护 | 每 2 分钟 | `美国/db/新维护/运行.mjs --队列 --并发 4 --报告 …` | 后台“维护选中”排进维护队列的比赛，由新维护的队列模式处理，数量不限，一直做到队列空；队列空的马上退出；和每日新维护共用一把锁，拿不到（那边在跑）或每晚流程在跑就跳过这一轮；AI 额度用完、余额不足就停批，剩下的留在队列，暂停 2 小时（2026-11-12 用户定，替换旧 AI 审查；名字沿用 `competition-radar-ai-queue`） |
| 找新一届 | 每天 14:00 | `美国/db/新维护/运行.mjs --找新一届 --上限 30 --并发 4 --报告 …` | 已归档、预计报名时间已过或 60 天内、7 天内没找过的比赛，搜有没有新一届，发现就入库发布；追不到官方通知的用高校转发发布、来源标“高校转发”（2026-11-12 用户定，见 `../db/新维护/README.md` 的“找新一届”）。排在每日新维护之后，共用维护锁，那边没跑完就等（**还没部署**） |
| 回收站清理 | 每天 0:30 | `美国/后台/每日清理.mjs` | 彻底删除标记删除超过 30 天的比赛和届次；删掉超过 30 天的拒过的网址 |
| 公开比赛同步 | 每 5 分钟（全天） | `沟通/公开比赛同步/美国端.mjs` | 已公开的比赛、届次和海报推到北京主数据库：只推有变化的，每 24 小时整体重推一次，读到 0 条不推，下架的在北京也删（2026-11-02，接替旧系统的 daily-contest-public-sync.timer） |
| 建议屏蔽的网站 | 每周一 9:00 | `美国/屏蔽网站建议/run.mjs` | 看近 30 天的搜索结果，常出现（15 次以上）却从没被放行读详情、也没追溯出官方来源的网站列为建议，后台“屏蔽网站”页确认后才生效（2026-11-02 搬自旧系统） |

新维护的报告都写在 `/opt/competition-radar/logs/maintain-new/`：每日的叫 `日期-时分.json`，队列的叫 `队列-日期-时分.json`（只在真跑了比赛时写，目录不在会自己建），找新一届的叫 `找新一届-日期-时分.json`。

**已删掉的（2026-11-12 用户定）**：旧 AI 审查 `competition-radar-ai-review`（每 5 小时 100 个比赛，Codex 核对原文）和轮流维护 `competition-radar-maintain`（每 5 分钟一个比赛，早就关着），模板和它们跑的旧入口都删了。线上要手动停用、删掉这两个的 unit 文件，见下面“装法”。

```
定时/
  competition-radar-pipeline.service / .timer
  competition-radar-archive.service / .timer
  competition-radar-maintain-new.service / .timer
  competition-radar-ai-queue.service / .timer
  competition-radar-new-edition.service / .timer
  competition-radar-cleanup.service / .timer
  competition-radar-site-block.service / .timer
  competition-radar-public-sync.service / .timer
  test/单独/        检查时间、脚本路径、环境变量文件写得对
```

- 错过了时间不补跑（`Persistent=false`）：服务器关着错过 1:00 的话，不在白天补跑，免得和维护撞在一起。
- 服务都从 `/etc/competition-radar/env` 读环境变量（权限 600，只放在服务器上，不进仓库），至少要有：
  - `BACKEND_DIR`：新后端 `backend/` 的目录（`ExecStart` 用它找脚本）
  - `DB_DIR`：比赛库所在目录（建议放在代码目录以外）
  - `AI_KEYS_DIR`：AI 密钥目录
  - `PIPELINE_LOG_DIR`、`MAINTAIN_LOG_DIR`：流程的日志目录（放每晚流程的锁）、维护锁所在目录
  - 公开比赛同步另外要：`SYNC_ENDPOINT`（北京的 `https://…/sync/public`）、`SYNC_SECRET_FILE`（和北京共用的同步秘钥，不是登录令牌的密钥）、`SYNC_STATE_FILE`（上次推了什么，默认 `DB_DIR/公开比赛同步状态.json`）、`POSTER_DIR`（图片总库，默认 `DB_DIR/海报`）
  - `PATH`：里面要能找到 Node 22（新后端要 Node 22，美国服务器现在是 Node 20）
  各变量的说明见 `backend/Environment/env.example`。

## 装法（部署，要用户同意才做）

```
sudo cp competition-radar-*.service competition-radar-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now competition-radar-pipeline.timer competition-radar-archive.timer competition-radar-maintain-new.timer competition-radar-ai-queue.timer competition-radar-new-edition.timer competition-radar-cleanup.timer competition-radar-site-block.timer competition-radar-public-sync.timer
systemctl list-timers 'competition-radar-*'      # 看下一次什么时候跑
```

- 先在临时目录手动跑一遍脚本（流程、新维护、建议屏蔽的网站、公开比赛同步、每日归档都先试跑：`--dry-run` 或新维护的 `--试跑`），确认能跑通再装定时器。
- 改了时间要重新复制、`daemon-reload`。停用：`sudo systemctl disable --now <名字>.timer`。
- 找新一届（2026-11-12 写好，还没部署）：先在服务器上 `node 美国/db/新维护/运行.mjs --找新一届 --上限 5 --试跑 --报告 …` 看一遍，再复制 `competition-radar-new-edition.*`、`daemon-reload`、`enable --now competition-radar-new-edition.timer`。
- 2026-11-12 起删掉的定时器，线上要：`sudo systemctl disable --now competition-radar-ai-review.timer competition-radar-maintain.timer`，再删 `/etc/systemd/system/` 里这两组 `.service`、`.timer`，`daemon-reload`。
