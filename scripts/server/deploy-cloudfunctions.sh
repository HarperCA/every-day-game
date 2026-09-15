#!/usr/bin/env bash
# 把本地云函数源码同步到服务器并更新云端代码。
#
# 为什么用 `tcb fn code update` 而不是 `tcb fn deploy`：
# deploy 会套用 cloudbaserc.json 里的 functions[].envVariables，
# 配置里没写全的话会把云端已有的环境变量清掉 —— AI_API_KEY、ADMIN_TOKEN、
# DISPATCH_SECRET 都在那里，清掉就等于 AI 审核和提醒推送同时停摆。
# code update 只替换代码包，环境变量、超时、内存、权限规则一概不动。
#
# 前置：服务器上已 `tcb login`（凭证留在服务器，本脚本不接触任何密钥）。
# 用法：bash scripts/server/deploy-cloudfunctions.sh [函数名...]
#       不带参数则同步全部四个函数。
set -euo pipefail

SERVER="${DEPLOY_SERVER:-root@107.175.111.18}"
ENV_ID="${CLOUDBASE_ENV_ID:-daily-contest-dev-d8dbbhc653e221}"
REMOTE_ROOT="/opt/daily-contest/deploy"
LOCAL_ROOT="apps/miniprogram/cloudfunctions"

FUNCTIONS=("$@")
if [ ${#FUNCTIONS[@]} -eq 0 ]; then
  FUNCTIONS=(adminData publicData sendReminders userData)
fi

for name in "${FUNCTIONS[@]}"; do
  if [ ! -d "$LOCAL_ROOT/$name" ]; then
    echo "找不到云函数目录：$LOCAL_ROOT/$name" >&2
    exit 1
  fi
done

echo "环境：$ENV_ID"
echo "函数：${FUNCTIONS[*]}"

ssh "$SERVER" "mkdir -p $REMOTE_ROOT/functions"

for name in "${FUNCTIONS[@]}"; do
  echo "--- 同步 $name ---"
  # node_modules 不上传：云端按 package.json 自行安装，传上去只会让代码包超限
  tar -czf - -C "$LOCAL_ROOT" --exclude=node_modules "$name" \
    | ssh "$SERVER" "rm -rf $REMOTE_ROOT/functions/$name && tar -xzf - -C $REMOTE_ROOT/functions"
done

# cloudbaserc.json 只声明 envId 和 functionRoot。
# 刻意不写 envVariables —— 见文件头的说明。
ssh "$SERVER" "cat > $REMOTE_ROOT/cloudbaserc.json <<'JSON'
{
  \"version\": \"2.0\",
  \"envId\": \"$ENV_ID\",
  \"functionRoot\": \"./functions\",
  \"functions\": []
}
JSON"

for name in "${FUNCTIONS[@]}"; do
  echo "--- 更新云端代码 $name ---"
  ssh "$SERVER" "cd $REMOTE_ROOT && tcb fn code update $name --dir ./functions/$name --env-id $ENV_ID"
done

echo "完成。环境变量与权限规则未被修改。"
