#!/usr/bin/env bash
# 把「发现新赛事」流水线需要的文件同步到服务器：各来源抓取脚本、
# 判重模块、流水线编排脚本。不碰 .admin-token / .extract-key —— 密钥
# 已经在服务器上，本脚本不接触任何密钥内容，和 sync-extract.sh 一致。
#
# 用法：bash scripts/server/sync-crawler.sh
set -euo pipefail

SERVER="${DEPLOY_SERVER:-root@107.175.111.18}"
REMOTE="/opt/daily-contest"
LOCAL_CRAWLER="scripts/crawler"
LOCAL_SERVER="scripts/server"

echo "--- 同步抓取脚本与判重模块到 $REMOTE/crawler ---"
ssh "$SERVER" "mkdir -p $REMOTE/crawler/lib"
for file in crawl-tianchi.mjs crawl-datafountain.mjs merge-candidates.mjs; do
  scp -q "$LOCAL_CRAWLER/$file" "$SERVER:$REMOTE/crawler/$file"
  echo "  crawler/$file"
done
for file in dedupe.mjs valueSource.mjs masters.mjs; do
  scp -q "$LOCAL_CRAWLER/lib/$file" "$SERVER:$REMOTE/crawler/lib/$file"
  echo "  crawler/lib/$file"
done

echo "--- 同步流水线编排脚本 ---"
scp -q "$LOCAL_SERVER/run-crawl-pipeline.mjs" "$SERVER:$REMOTE/run-crawl-pipeline.mjs"
echo "  run-crawl-pipeline.mjs"

ssh "$SERVER" "mkdir -p $REMOTE/runs"
echo "完成。密钥与 crontab 均未被本脚本修改。"
