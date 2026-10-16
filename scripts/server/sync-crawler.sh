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
for file in crawl-tianchi.mjs merge-candidates.mjs; do
  scp -q "$LOCAL_CRAWLER/$file" "$SERVER:$REMOTE/crawler/$file"
  echo "  crawler/$file"
done
for file in dedupe.mjs valueSource.mjs masters.mjs discoveredChannels.mjs fetcher.mjs extract.mjs urlPolicy.mjs jevCandidateFilter.mjs jevLinkRanker.mjs; do
  scp -q "$LOCAL_CRAWLER/lib/$file" "$SERVER:$REMOTE/crawler/lib/$file"
  echo "  crawler/lib/$file"
done

echo "--- 同步百度AI搜索发现脚本（不碰 .baidu-search-key）---"
scp -q "$LOCAL_SERVER/search-baidu.mjs" "$SERVER:$REMOTE/search-baidu.mjs"
echo "  search-baidu.mjs"

echo "--- 同步流水线编排与入库脚本 ---"
scp -q "$LOCAL_SERVER/run-crawl-pipeline.mjs" "$SERVER:$REMOTE/run-crawl-pipeline.mjs"
scp -q "$LOCAL_SERVER/pipeline-lock.mjs" "$SERVER:$REMOTE/pipeline-lock.mjs"
scp -q "$LOCAL_SERVER/crawl-service-guard.mjs" "$SERVER:$REMOTE/crawl-service-guard.mjs"
scp -q "$LOCAL_SERVER/lead-followups.mjs" "$SERVER:$REMOTE/lead-followups.mjs"
scp -q "$LOCAL_SERVER/backfill-lead-followups.mjs" "$SERVER:$REMOTE/backfill-lead-followups.mjs"
scp -q "$LOCAL_SERVER/pipeline-ledger.mjs" "$SERVER:$REMOTE/pipeline-ledger.mjs"
scp -q "$LOCAL_SERVER/ingest-candidates.mjs" "$SERVER:$REMOTE/ingest-candidates.mjs"
scp -q "$LOCAL_SERVER/resolve-notice-leads.mjs" "$SERVER:$REMOTE/resolve-notice-leads.mjs"
for file in notice-agent.mjs codex-agent.mjs beijing-page-reader.mjs page-reader.mjs source-check.mjs; do
  scp -q "$LOCAL_SERVER/$file" "$SERVER:$REMOTE/$file"
done
echo "  run-crawl-pipeline.mjs"
echo "  pipeline-lock.mjs"
echo "  crawl-service-guard.mjs"
echo "  lead-followups.mjs"
echo "  backfill-lead-followups.mjs"
echo "  ingest-candidates.mjs"
echo "  resolve-notice-leads.mjs"

ssh "$SERVER" "mkdir -p $REMOTE/runs"
echo "完成。密钥与 crontab 均未被本脚本修改。"
echo "Jev 启用方式：在服务器创建 $REMOTE/.openrouter-key（单行密钥、chmod 600），或为 systemd 服务配置 OPENROUTER_API_KEY。"
