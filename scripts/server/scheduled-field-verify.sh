#!/bin/bash
# 已发布赛事的三项核验（名称/报名时间/链接）：报名已截止的先归档，
# 剩下的按"每条大约一周核一次"的节奏抽查，核出的问题能自动改的直接改，
# 改不了的转人工。每 5 分钟触发一次，每次只处理一条（跟 AI 复核同一个
# 云函数 60 秒预算），量不大所以靠触发频率而不是并发把队列跑完。
# 直接打本机端口，不走公网。
set -euo pipefail

TOKEN="$(cat /opt/daily-contest/.admin-token)"

curl -s -m 90 -X POST http://127.0.0.1:8787/api/adminData \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"runScheduledFieldVerification\",\"trigger\":\"timer\",\"adminToken\":\"${TOKEN}\"}"
echo
