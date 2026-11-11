# 部署（北京/部署）

北京服务器（腾讯云轻量 154.8.197.241，域名 xiaohuiworks.cn）上跑新后端要的 systemd、nginx 配置（2026-11-03 第一次部署）。

## 放在哪

```
/opt/competition-radar/
  releases/<时间>/     每次上传一份代码（backend/ 里的 北京、共用、沟通、Environment），装好依赖
  backend -> releases/<时间>   当前用的那份；回退就把链接指回上一份，重启服务
  data/                主数据库、用户管理中心、报错日志三个库，同步状态（700，只有 ubuntu 能读）
  posters/             海报（nginx 直接给，所以单独放、755）
  secrets/             session.env（SESSION_SIGNING_KEY）、sync-secret、wechat-appsecret（700）
  beijing.env          其余环境变量，见 beijing.env.example
```

服务的启动命令都带 `--preserve-symlinks-main`：`backend` 是软链接，不带的话 Node 把入口解析成真实路径，和命令行给的对不上，“直接运行”那段不执行，服务一启动就退出（2026-11-03 第一次部署时遇到）。

10-13 演练留下的 `/opt/daily-contest/` 和 `beijing-user-api`（8787）不动。

## 服务

| 文件 | 做什么 | 端口 |
|---|---|---|
| competition-radar-beijing.service | 小程序入口（登录、用户数据、首页和详情、收报错）+ 发提醒调度 | 4330 |
| competition-radar-public-sync-receiver.service | 收美国推来的公开比赛和海报 | 4331 |
| competition-radar-review-receiver.service | 收美国后台的审核结果 | 4333 |
| competition-radar-user-sync.service / .timer | 每分钟把用户数据推到美国（2026-11-06 用户定） | — |
| nginx-competition-radar.conf | `/api/` → 4330；`/sync/public`、`/sync/review` 只放美国 IP；`/posters/` 给海报 | — |

## 更新代码

1. 本机按下面“打包”的命令打包，传到 `releases/<时间>/`。
2. 在那份里 `cd Environment && npm install --omit=dev`。
3. `ln -sfn releases/<时间> /opt/competition-radar/backend`，重启三个服务，看日志、用 curl 测一遍。

## 打包（别按文件夹名排除）

按 git 的文件清单打包：`.gitignore` 已经把运行数据（`数据/`、流程和维护的 `日志/`、库文件）排除了，代码文件夹不会被误伤。
2026-11-03 第一次部署时按文件夹名排除了 `日志`，把后台的代码文件夹 `美国/后台/功能/日志/`（失败任务、操作记录、访问异常）也漏了。

```bash
cd backend
git -c core.quotepath=false ls-files --cached --others --exclude-standard -- 北京 共用 沟通 Environment/package.json Environment/README.md Environment/env.example | grep -v '/test/' | tar -czf /tmp/release.tar.gz -T -
```
