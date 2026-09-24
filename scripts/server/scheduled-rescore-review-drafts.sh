#!/bin/bash
# review 档草稿定期复检：先不重新抓取、只用库里已有数据重新打一次收录分；
# 还是不够门槛的，再送 DeepSeek 判断一次（关键词认不出的知名企业/技术平台
# 主办方，AI 读得懂）。够门槛的会自动走三项核验/归档流程，真通过核验的
# 这里会真的调用 Kimi。
set -euo pipefail

cd /opt/daily-contest
node rescore-review-drafts.mjs
