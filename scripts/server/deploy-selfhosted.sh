#!/usr/bin/env bash
# 把自有服务器后端部署上去：Node 服务 + systemd + nginx 反代。
#
# 部署布局（刻意让公开目录和密钥目录分开）：
#   /opt/daily-contest/server/        Node 服务源码 + node_modules
#   /opt/daily-contest/server/data/   SQLite 数据库（只有 root 能读）
#   /opt/daily-contest/functions/     云函数源码副本（业务逻辑，原样跑）
#   /var/www/admin-dashboard/         后台前端静态文件（nginx 读）
#
# nginx 把 /api/ 转给本机 8787，静态文件直接发——浏览器眼里只有一个域名，
# 没有跨域。Node 服务只监听本机，不对外暴露端口。
#
# 用法：bash scripts/server/deploy-selfhosted.sh
set -euo pipefail

SERVER="${DEPLOY_SERVER:-root@107.175.111.18}"
REMOTE="/opt/daily-contest"

echo "--- 同步后端源码 ---"
ssh "$SERVER" "mkdir -p $REMOTE/server/src $REMOTE/server/migrate $REMOTE/server/vendor/wx-server-sdk $REMOTE/server/data"
scp -q apps/server/package.json "$SERVER:$REMOTE/server/package.json"
scp -q apps/server/src/*.mjs "$SERVER:$REMOTE/server/src/"
scp -q apps/server/migrate/*.mjs "$SERVER:$REMOTE/server/migrate/"
scp -q apps/server/vendor/wx-server-sdk/* "$SERVER:$REMOTE/server/vendor/wx-server-sdk/"
echo "  src/ migrate/ vendor/ package.json"

echo "--- 同步云函数源码（业务逻辑，原样跑） ---"
ssh "$SERVER" "mkdir -p $REMOTE/functions"
for fn in adminData publicData userData login sendReminders; do
  # node_modules 不传：服务器上统一由 server/node_modules 提供依赖
  tar -czf - -C apps/miniprogram/cloudfunctions --exclude=node_modules "$fn" \
    | ssh "$SERVER" "rm -rf $REMOTE/functions/$fn && tar -xzf - -C $REMOTE/functions"
  echo "  functions/$fn"
done

echo "--- 安装依赖（better-sqlite3 要编译，首次会慢） ---"
ssh "$SERVER" "cd $REMOTE/server && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3"

echo "--- 安装 systemd 服务 ---"
scp -q scripts/server/daily-contest-api.service "$SERVER:/etc/systemd/system/daily-contest-api.service"
ssh "$SERVER" "systemctl daemon-reload && systemctl enable daily-contest-api"

echo "--- 部署后台前端静态文件 ---"
ssh "$SERVER" "mkdir -p /var/www/admin-dashboard"
scp -q -r apps/admin/dist/* "$SERVER:/var/www/admin-dashboard/"
ssh "$SERVER" "chown -R www-data:www-data /var/www/admin-dashboard"

echo "--- 更新 nginx 配置 ---"
scp -q scripts/server/admin-dashboard.nginx.conf "$SERVER:/etc/nginx/sites-available/admin-dashboard"
ssh "$SERVER" "nginx -t && systemctl reload nginx"

echo "--- 重启 API 服务 ---"
ssh "$SERVER" "systemctl restart daily-contest-api && sleep 2 && systemctl is-active daily-contest-api"

echo "完成。密钥文件未被本脚本触碰。"
