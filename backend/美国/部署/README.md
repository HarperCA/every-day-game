# 部署（美国/部署）

美国服务器（107.175.111.18，`ssh daily-contest`）上新系统的常驻服务和 nginx 配置（2026-11-03 第一次部署）。定时任务的配置在 `../定时/`。

**新旧并行**：新系统装在 `/opt/competition-radar/`，自带 Node 22，独立运行；旧系统（`/opt/daily-contest/`、`daily-contest-*` 服务和定时器、系统的 Node 20）照旧对外服务，不切换。新的验证完全可用后再定切换（用户 11-03 定）。

## 新旧并行期间（2026-11-03 起）

- **百度每天新旧各 15 次**（用户定）：新系统在 `/etc/competition-radar/env` 设 `BAIDU_DAILY_LIMIT=15`；旧系统给 17 个定时任务各加了附加配置
  `/etc/systemd/system/daily-contest-*.service.d/baidu-limit.conf`（旧后端 `daily-contest-api`、发提醒服务没加，没重启）。改前备份在 `/root/backup/systemd-daily-contest-before-baidu15-*.tar.gz`。
  切换后：删掉旧的附加配置（旧系统停了也就不用了），新系统删掉 `BAIDU_DAILY_LIMIT` 回到 30。
- **开着的定时器**：每晚流程（1:00，和旧系统的抓取同一时间）、每日归档（2:00，和旧系统同时）、公开比赛同步、回收站清理、建议屏蔽网站。
- **维护先关着**：五项审计和“查找”还没写（`美国/db/维护/审计/*`），跑起来什么都不做，却会把比赛记成“已维护”、之后 7 天跳过。写好再开：`systemctl enable --now competition-radar-maintain.timer`。

## 放在哪

```
/opt/competition-radar/
  node/                Node 22（官方安装包解压，只给新系统用）
  releases/<时间>/     每次上传一份代码（backend/ 的 美国、共用、沟通、Environment），装好依赖
  backend -> releases/<时间>
  data/                比赛库.db（从旧系统 app.db 只读导出后建库）、用户副本.db、AI 用量库、同步状态
  posters/             图片总库（海报、候选图）
  logs/                每晚流程、维护的日志
  secrets/             session.env（和北京同一把 SESSION_SIGNING_KEY）、sync-secret（和北京同一把）、
                       ai/（deepseek.key、kimi.key、baidu.key、jev.key）、wechat-appsecret、admin-token（2026-11-05 起都是新系统自己的文件，权限 600，不再依赖旧目录）
/etc/competition-radar/env   环境变量，见 env.example
```

## 服务

| 文件 | 做什么 | 端口 |
|---|---|---|
| competition-radar-admin.service | 新后台；只听本机，nginx 转 https://107-175-111-18.sslip.io/new-admin/（要口令登录，和旧后台同一个口令） | 4318 |
| competition-radar-assistant.service | 新赛事助手；只听本机，nginx 转 `/new-api/assistant` | 4320 |
| competition-radar-user-sync-receiver.service | 收北京推来的用户数据 | 4332 |
| nginx-sync-user.conf | `/sync/user` 只放北京 IP | — |
| nginx-new-admin.conf | `/new-admin/` 转新后台 | — |
| nginx-new-assistant.conf | `/new-api/assistant` 转新赛事助手（小程序直连，带北京签的令牌；旧路径 `/api/assistant` 还归旧服务器） | — |
| ../定时/ 的五个 | 每晚流程、维护、回收站清理、建议屏蔽网站、公开比赛同步 | — |

都以 root 运行（旧系统也是 root，AI 密钥文件、Codex 的登录都在 root 下）。

## 看新后台

浏览器开 https://107-175-111-18.sslip.io/new-admin/ ，输口令（和旧后台一样）。登录后 12 小时内不用再输；口令连错 5 次，10 分钟内不让再试。
口令文件：`/opt/competition-radar/secrets/admin-token`（2026-11-05 起是自己的文件，内容和旧后台口令相同），`/etc/competition-radar/env` 里 `ADMIN_TOKEN_FILE` 指向它。

## 打包（别按文件夹名排除）

按 git 的文件清单打包：`.gitignore` 已经把运行数据（`数据/`、流程和维护的 `日志/`、库文件）排除了，代码文件夹不会被误伤。
2026-11-03 第一次部署时按文件夹名排除了 `日志`，把后台的代码文件夹 `美国/后台/功能/日志/`（失败任务、操作记录、访问异常）也漏了。

```bash
cd backend
git -c core.quotepath=false ls-files --cached --others --exclude-standard -- 美国 共用 沟通 Environment/package.json Environment/README.md Environment/env.example | grep -v '/test/' | tar -czf /tmp/release.tar.gz -T -
```
