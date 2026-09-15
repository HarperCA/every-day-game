// 服务器侧定时调度：云开发的定时触发器在本环境不执行
// （见 docs/admin-cloudbase.md 的未决问题），改由服务器 cron 调用云函数。
//
// 部署位置：/opt/daily-contest/run-ai-review.mjs
// 依赖：@cloudbase/js-sdk（装在 /opt/daily-contest）
// 口令：/opt/daily-contest/.admin-token，单行纯文本，chmod 600
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cloudbase from '@cloudbase/js-sdk';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(HERE, '.admin-token');
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'daily-contest-dev-d8dbbhc653e221';
const CALL_TIMEOUT_MS = 120000;

function readToken() {
  if (!fs.existsSync(TOKEN_FILE)) throw new Error(`缺少口令文件 ${TOKEN_FILE}`);
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  if (!token) throw new Error(`口令文件 ${TOKEN_FILE} 是空的`);
  return token;
}

function withTimeout(promise, label, ms = CALL_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)),
  ]);
}

async function main() {
  const adminToken = readToken();
  const app = cloudbase.init({ env: ENV_ID });
  const auth = app.auth();
  if (!await withTimeout(auth.getLoginState(), 'getLoginState', 20000)) {
    await withTimeout(auth.signInAnonymously(), 'signInAnonymously', 20000);
  }

  async function call(data, ms) {
    const response = await withTimeout(app.callFunction({ name: 'adminData', data, parse: true }), `adminData:${data.action}`, ms);
    const result = typeof response?.result === 'string' ? JSON.parse(response.result) : response?.result;
    if (!result?.ok) throw new Error(result?.message || 'adminData 返回异常');
    return result.data;
  }

  const login = await call({ action: 'login', adminToken }, 20000);
  const run = await call({ action: 'runScheduledAiReview', sessionToken: login.sessionToken }, CALL_TIMEOUT_MS);
  // 单行输出，便于 cron 日志按行检索
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    status: run.status,
    selected: run.selected,
    succeeded: run.succeeded,
    failed: run.failed,
    remaining: run.remaining,
    ...(run.error ? { error: run.error } : {}),
    ...(run.failures?.length ? { firstFailure: run.failures[0] } : {}),
  }));
}

main().then(() => process.exit(0)).catch(error => {
  console.log(JSON.stringify({ at: new Date().toISOString(), status: 'script_error', error: String(error?.message || error) }));
  process.exit(1);
});
