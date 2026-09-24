#!/bin/bash
# 定时派发提醒推送（替代失效的 CloudBase 定时触发器 send-reminders-every-5-minutes）。
# 直接打本机端口，不走公网。dispatchSecret 走 sendReminders 自己的鉴权
# （见 reminderDelivery.js 的 isAuthorizedDispatch），跟 ADMIN_TOKEN 是两套密钥。
set -euo pipefail

SECRET="$(cat /opt/daily-contest/.dispatch-secret)"

curl -s -m 60 -X POST http://127.0.0.1:8787/api/sendReminders \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"dispatch\",\"dispatchSecret\":\"${SECRET}\"}"
echo
