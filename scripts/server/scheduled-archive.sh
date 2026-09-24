#!/bin/bash
# 每月扫描一次：把报名已截止的已发布赛事归档（从公开缓存撤下，记录保留），
# 并附上"下一届大概什么时候开始报名"的粗略估算。直接打本机端口，不走公网。
set -euo pipefail

TOKEN="$(cat /opt/daily-contest/.admin-token)"

curl -s -m 120 -X POST http://127.0.0.1:8787/api/adminData \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"archiveExpiredRegistrations\",\"adminToken\":\"${TOKEN}\"}"
echo
