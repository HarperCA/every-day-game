#!/bin/bash
# 定时 AI 审核（替代原 CloudBase 定时触发器 competition-ai-review-batch，
# 原来是每 5 分钟跑一次，这里用 systemd timer 复刻同样的节奏）。
# 直接打本机端口，不走 nginx/公网，避免给这个内部调用暴露额外攻击面。
set -euo pipefail

TOKEN="$(cat /opt/daily-contest/.admin-token)"

curl -s -X POST http://127.0.0.1:8787/api/adminData \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"runScheduledAiReview\",\"adminToken\":\"${TOKEN}\"}"
echo
