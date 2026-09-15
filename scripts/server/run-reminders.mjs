// 服务器侧定时触发用户提醒推送。
//
// 云开发的定时触发器在本环境不执行（见 docs/admin-cloudbase.md）。
// sendReminders 不接受匿名调用（平台返回 EXCEED_AUTHORITY），因此这里调用
// adminData 的 dispatchReminders，由它以内部调用转发，并带上共享密钥。
//
// 部署位置：/opt/daily-contest/run-reminders.mjs
// 口令：/opt/daily-contest/.admin-token（与 AI 审核脚本共用）
//
// 注意：这个调用会真实给用户发送微信订阅消息。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cloudbase from '@cloudbase/js-sdk';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(HERE, '.admin-token');
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'daily-contest-dev-d8dbbhc653e221';
const CALL_TIMEOUT_MS = 60000;

function readToken() {
  if (!fs.existsSync(TOKEN_FILE)) throw new Error(`缺少口令文件 ${TOKEN_FILE}`);
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  if (!token) throw new Error(`口令文件 ${TOKEN_FILE} 是空的`);
  return token;
}

function withTimeout(promise, label, ms) {
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
  const dispatched = await call({ action: 'dispatchReminders', sessionToken: login.sessionToken }, CALL_TIMEOUT_MS);
  console.log(JSON.stringify({ at: new Date().toISOString(), ...(dispatched || { status: 'empty_result' }) }));
}

main().then(() => process.exit(0)).catch(error => {
  console.log(JSON.stringify({ at: new Date().toISOString(), status: 'script_error', error: String(error?.message || error) }));
  process.exit(1);
});
