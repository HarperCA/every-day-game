#!/bin/bash
# 草稿超时兜底：扫描全部记录，把超过3天还没自动发布/归档的草稿标出来并附上原因，
# 让人工审核知道该优先看哪些。hold（半年以外故意先放着）的草稿会被自动跳过。
# 直接打本机端口，不走公网。
set -euo pipefail

TOKEN="$(cat /opt/daily-contest/.admin-token)"

curl -s -m 60 -X POST http://127.0.0.1:8787/api/adminData \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"flagStaleDrafts\",\"trigger\":\"timer\",\"adminToken\":\"${TOKEN}\"}"
echo
