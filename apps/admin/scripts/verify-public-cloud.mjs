import cloudbase from '@cloudbase/js-sdk';

const env = process.env.VITE_CLOUDBASE_ENV_ID || 'daily-contest-dev-d8dbbhc653e221';
const app = cloudbase.init({ env });
const auth = app.auth();

function withTimeout(promise, label, timeoutMs = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)),
  ]);
}

if (!await withTimeout(auth.getLoginState(), 'getLoginState')) await withTimeout(auth.signInAnonymously(), 'signInAnonymously');
const response = await withTimeout(app.callFunction({ name:'publicData', data:{ action:'list', query:{ page:1, pageSize:1 } }, parse:true }), 'publicData:list');
if (response?.error) throw new Error(`publicData call failed: ${response.error.code || 'unknown'}: ${response.error.message || 'unknown error'}`);
if (response?.code) throw new Error(`publicData call failed: ${response.code}: ${response.message || 'unknown error'}`);
const result = typeof response?.result === 'string' ? JSON.parse(response.result) : response?.result;
if (!result?.ok) throw new Error(result?.message || `publicData returned an invalid response (${Object.keys(response || {}).join(',') || 'empty response'})`);
if (!Array.isArray(result.data?.items) || !Number.isInteger(result.data?.total) || result.data?.preview !== false) throw new Error('publicData response contract mismatch');
console.log(JSON.stringify({ ok:true, environment:env, publicRecords:result.data.total, preview:result.data.preview }, null, 2));
process.exit(0);
