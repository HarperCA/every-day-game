# 网页测试版

地址：https://107-175-111-18.sslip.io/app/

用来验证学生需不需要这个产品：把链接发给同学，不用加体验成员、不用登录就能用。
**小程序是正式阵地，这里只是临时测试工具**，测试结束可以直接撤掉。

## 和小程序的关系

- 页面照小程序复刻：找比赛（搜索、筛选、更多筛选）、赛事详情、我的收藏、信息纠错、我的、说明页。
- 去掉了登录和截止提醒；收藏存在浏览器里；详情页多一个“打开官方报名页面”。
- 筛选项、字段转换、说明文案直接引用小程序的代码（`apps/miniprogram/services/` 下的
  `filterOptions.ts`、`publicRecord.ts`、`infoContent.ts`），两边口径一致。
- 数据读的是小程序同一个公开接口，显示的是后台里已发布的赛事。

## 匿名使用统计

页面会记下：打开、搜索词、筛选、看了哪些赛事、点官方报名页、复制链接、收藏、纠错。
不收集个人信息（每个浏览器一个随机编号，不记 IP）。在管理后台“测试版统计”里看汇总。

- 发送：`src/track.ts` → `publicData` 的 `track`（校验和限流在 `cloudfunctions/publicData/webEvents.js`）
- 存储：数据库 `web_events` 集合
- 汇总：`cloudfunctions/adminData/webStats.js`，后台页面 `apps/admin/src/WebStatsModule.tsx`

## 构建与部署

本目录没有自己的依赖，借用管理后台装好的 vite：

```bash
node apps/admin/node_modules/vite/bin/vite.js build apps/web
scp -r apps/web/dist/* root@107.175.111.18:/var/www/web-test/
```

本地预览：`node apps/admin/node_modules/vite/bin/vite.js apps/web --port 5174`，
打开 http://localhost:5174/app/ （接口转发到线上；本地不上报统计）。

## 撤掉

删除服务器上的 `/var/www/web-test/`，以及 nginx 配置（`scripts/server/admin-dashboard.nginx.conf`）
里 `location /app/` 那一段，`nginx -t && systemctl reload nginx`。统计数据在 `web_events`，不删也不影响别的功能。
