#!/usr/bin/env bash
# 把批量抽取需要的文件同步到服务器。
#
# 抽取模块是云函数那几个 CJS 文件的副本。服务器的 package.json 是
# "type": "module"，所以它们必须放在带自己 package.json 的 cjs/ 子目录里，
# 否则 Node 会按 ESM 解析，第一行 require 就报错。
#
# 不碰 .extract-key：密钥由你在服务器上自己写入，本脚本从不接触。
# 用法：bash scripts/server/sync-extract.sh [候选文件...]
set -euo pipefail

SERVER="${DEPLOY_SERVER:-root@107.175.111.18}"
REMOTE="/opt/daily-contest"
LOCAL_FN="apps/miniprogram/cloudfunctions/adminData"

MODULES=(competitionExtract.js competitionAiReview.js kimiResolutionAgent.js kimiReviewDisposition.js fieldVerificationIssues.js competitionValue.js competitionAdmission.js competitionAdmissionAi.js candidateToRecord.js noticeResolution.js competitionScope.js intakeSchedule.js registrationSchedule.js httpClient.js robots.js aiReasoning.js pageRelayClient.js editionTitle.js publicCache.js dedupeArbitrationAi.js)

echo "--- 同步抽取模块到 $REMOTE/cjs ---"
ssh "$SERVER" "mkdir -p $REMOTE/cjs && printf '%s' '{\"type\":\"commonjs\"}' > $REMOTE/cjs/package.json"
for module in "${MODULES[@]}"; do
  scp -q "$LOCAL_FN/$module" "$SERVER:$REMOTE/cjs/$module"
  echo "  $module"
done

echo "--- 同步批量抽取脚本 ---"
scp -q scripts/server/run-extract.mjs "$SERVER:$REMOTE/run-extract.mjs"
scp -q scripts/server/ingest-candidates.mjs "$SERVER:$REMOTE/ingest-candidates.mjs"
scp -q scripts/server/rescore-review-drafts.mjs "$SERVER:$REMOTE/rescore-review-drafts.mjs"
scp -q scripts/server/arbitrate-dedupe.mjs "$SERVER:$REMOTE/arbitrate-dedupe.mjs"
scp -q scripts/server/search-engines.mjs "$SERVER:$REMOTE/search-engines.mjs"

for candidates in "$@"; do
  echo "--- 同步候选文件 $(basename "$candidates") ---"
  scp -q "$candidates" "$SERVER:$REMOTE/$(basename "$candidates")"
done

# 只报告密钥文件是否就绪，不读取内容
ssh "$SERVER" "if [ -s $REMOTE/.extract-key ]; then echo '密钥文件已就绪（内容未读取）'; else echo '⚠ .extract-key 还是空的，抽取会拒绝运行'; fi"
