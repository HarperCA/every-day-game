# 定时（美国/定时）

美国服务器上的 systemd 定时器配置。时间一律按北京时间（服务器系统时区是 UTC，定时器里写明 `Asia/Shanghai`）。2026-11-01 用户定：

| 任务 | 时间 | 跑什么 | 做什么 |
|---|---|---|---|
| 每晚流程 | 每天 1:00 | `美国/pipeline/run.mjs` | 搜索 → 去重 → 筛选 → 读详情和抽取 → 审核 → 入库 |
| 新维护 | 每天 10:00 | `美国/db/新维护/运行.mjs --上限 45 --并发 4` | 按维护调度挑比赛，每次最多 45 场 |
| 旧维护（停用） | 每天 9:00–18:00，每 5 分钟一次（最后一次 17:55） | `美国/db/维护/run.mjs` | 每次挑一个 7 天内没维护过、上次维护最早的比赛，维护完记下时间；上一次没完、或者流程还在跑就跳过这一轮 |
| 每日归档 | 每天 2:00 | `美国/db/维护/归档/run.mjs` | 报名已截止的已发布届次全部归档，算下一届预计（2026-11-03，接替旧系统的 daily-contest-archive.timer，时间一样） |
| AI 审查（自动批量已停用） | 每天 2:00、7:00、12:00、17:00、22:00 | `美国/db/维护/run.mjs --批 100` | 只调 Codex 核对原文：先跑后台队列，再挑 100 个比赛，待人工审核的优先（2026-11-06）；每晚流程开始了就停 |
| 后台多选的 AI 维护 | 每 2 分钟 | `美国/db/维护/run.mjs --队列` | 看后台多选排进来的比赛，有就跑，空的马上退出（2026-11-06）；和 AI 审查共用一把锁 |
| 回收站清理 | 每天 0:30 | `美国/后台/每日清理.mjs` | 彻底删除标记删除超过 30 天的比赛和届次；删掉超过 30 天的拒过的网址 |
| 公开比赛同步 | 每 5 分钟（全天） | `沟通/公开比赛同步/美国端.mjs` | 已公开的比赛、届次和海报推到北京主数据库：只推有变化的，每 24 小时整体重推一次，读到 0 条不推，下架的在北京也删（2026-11-02，接替旧系统的 daily-contest-public-sync.timer） |
| 建议屏蔽的网站 | 每周一 9:00 | `美国/屏蔽网站建议/run.mjs` | 看近 30 天的搜索结果，常出现（15 次以上）却从没被放行读详情、也没追溯出官方来源的网站列为建议，后台“屏蔽网站”页确认后才生效（2026-11-02 搬自旧系统） |

```
定时/
  competition-radar-pipeline.service / .timer
  competition-radar-maintain-new.service / .timer
  competition-radar-maintain.service / .timer
  competition-radar-cleanup.service / .timer
  competition-radar-site-block.service / .timer
  competition-radar-public-sync.service / .timer
  competition-radar-archive.service / .timer
  competition-radar-ai-review.service / .timer
  competition-radar-ai-queue.service / .timer
  test/单独/        检查时间、脚本路径、环境变量文件写得对
```

- 错过了时间不补跑（`Persistent=false`）：服务器关着错过 1:00 的话，不在白天补跑，免得和维护撞在一起。
- 服务从 `/etc/competition-radar/env` 读环境变量（权限 600，只放在服务器上，不进仓库），至少要有：
  - `BACKEND_DIR`：新后端 `backend/` 的目录（`ExecStart` 用它找脚本）
  - `DB_DIR`：比赛库所在目录（建议放在代码目录以外）
  - `AI_KEYS_DIR`：AI 密钥目录
  - `PIPELINE_LOG_DIR`、`MAINTAIN_LOG_DIR`：流程、维护的日志目录
  - 公开比赛同步另外要：`SYNC_ENDPOINT`（北京的 `https://…/sync/public`）、`SYNC_SECRET_FILE`（和北京共用的同步秘钥，不是登录令牌的密钥）、`SYNC_STATE_FILE`（上次推了什么，默认 `DB_DIR/公开比赛同步状态.json`）、`POSTER_DIR`（图片总库，默认 `DB_DIR/海报`）
  - `PATH`：里面要能找到 Node 22（新后端要 Node 22，美国服务器现在是 Node 20）
  各变量的说明见 `backend/Environment/env.example`。

## 装法（部署，要用户同意才做）

```
sudo cp competition-radar-*.service competition-radar-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now competition-radar-pipeline.timer competition-radar-maintain-new.timer competition-radar-ai-queue.timer competition-radar-cleanup.timer competition-radar-site-block.timer competition-radar-public-sync.timer competition-radar-archive.timer
systemctl list-timers 'competition-radar-*'      # 看下一次什么时候跑
```

- 先在临时目录手动跑一遍六个脚本（流程、维护、建议屏蔽的网站、公开比赛同步、每日归档都先带 `--dry-run`），确认能跑通再装定时器。
- 改了时间要重新复制、`daemon-reload`。停用：`sudo systemctl disable --now <名字>.timer`。
