#!/bin/bash
# 定时派发提醒推送（替代失效的 CloudBase 定时触发器 send-reminders-every-5-minutes），每 5 分钟一次。
#
# 2026-10-01 起提醒数据搬到了腾讯云开发上海（登录、收藏、提醒走微信内网，不再跨境）：
#   ① 上海：经 HTTP 访问服务调 sendReminders（/send-reminders），密钥 .dispatch-secret-shanghai；
#   ② 本机：美国服务器上那份旧数据。新版小程序发布前，老版本仍把提醒写在这边，所以两边都派发。
#      两边的提醒是不同的记录，不会重复推送。新版小程序发布、把美国这边剩下的提醒补迁到上海那一刻，
#      要同时把 ② 停掉（设 SKIP_LOCAL_REMINDERS=1 或删掉下面那段），否则补迁过去的提醒会被两边各推一次。
# dispatchSecret 走 sendReminders 自己的鉴权（见 reminderDelivery.js 的 isAuthorizedDispatch），跟 ADMIN_TOKEN 是两套密钥。
set -uo pipefail

SHANGHAI_ENDPOINT="https://daily-contest-dev-d8dbbhc653e221-1428353397.ap-shanghai.app.tcloudbase.com/send-reminders"
SHANGHAI_SECRET="$(cat /opt/daily-contest/.dispatch-secret-shanghai)"
printf '上海：'
curl -s -m 60 -X POST "$SHANGHAI_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"dispatch\",\"dispatchSecret\":\"${SHANGHAI_SECRET}\"}"
echo

if [ "${SKIP_LOCAL_REMINDERS:-0}" != "1" ] && [ ! -f /opt/daily-contest/.reminders-local-off ]; then
  SECRET="$(cat /opt/daily-contest/.dispatch-secret)"
  printf '本机：'
  curl -s -m 60 -X POST http://127.0.0.1:8787/api/sendReminders \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"dispatch\",\"dispatchSecret\":\"${SECRET}\"}"
  echo
fi
