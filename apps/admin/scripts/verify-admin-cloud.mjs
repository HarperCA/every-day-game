import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cloudbase from '@cloudbase/js-sdk';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const tokenFile = path.join(root, '.admin-token.local');
const tokenLine = fs.readFileSync(tokenFile, 'utf8').split(/\r?\n/).find(line => /^\s*ADMIN_TOKEN\s*=/.test(line));
const adminToken = tokenLine?.replace(/^\s*ADMIN_TOKEN\s*=\s*/, '').trim();
if (!adminToken) throw new Error('missing ADMIN_TOKEN in .admin-token.local');

const env = process.env.VITE_CLOUDBASE_ENV_ID || 'daily-contest-dev-d8dbbhc653e221';
const writeCheck = process.argv.includes('--write-check');
const app = cloudbase.init({ env });
const auth = app.auth();

function withTimeout(promise, label, timeoutMs = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)),
  ]);
}

console.error('[verify-admin-cloud] checking anonymous CloudBase session');
if (!await withTimeout(auth.getLoginState(), 'getLoginState')) {
  await withTimeout(auth.signInAnonymously(), 'signInAnonymously');
}
console.error('[verify-admin-cloud] requesting short-lived admin session');

async function call(data) {
  const response = await withTimeout(app.callFunction({ name:'adminData', data, parse:true }), `adminData:${data.action}`);
  const result = typeof response?.result === 'string' ? JSON.parse(response.result) : response?.result;
  if (!result?.ok) throw new Error(result?.message || 'adminData returned an invalid response');
  return result.data;
}

const login = await call({ action:'login', adminToken });
if (!login?.sessionToken) throw new Error('adminData login did not return a session token');
const bootstrap = await call({ action:'bootstrap', sessionToken:login.sessionToken });
let optimisticLock;
if (writeCheck) {
  const expectedVersion = bootstrap.stateVersions?.records;
  if (!Number.isInteger(expectedVersion)) throw new Error('bootstrap did not return a records state version');
  const saved = await call({
    action:'saveRecords',
    sessionToken:login.sessionToken,
    records:bootstrap.records,
    expectedVersion,
  });
  let conflictRejected = false;
  try {
    await call({
      action:'saveRecords',
      sessionToken:login.sessionToken,
      records:bootstrap.records,
      expectedVersion,
    });
  } catch (error) {
    conflictRejected = error instanceof Error && error.message.includes('state_version_conflict:competitions:');
    if (!conflictRejected) throw error;
  }
  let missingVersionRejected = false;
  try {
    await call({ action:'saveRecords', sessionToken:login.sessionToken, records:bootstrap.records });
  } catch (error) {
    missingVersionRejected = error instanceof Error && error.message.includes('invalid_expected_version');
    if (!missingVersionRejected) throw error;
  }
  optimisticLock = {
    verified:conflictRejected,
    missingVersionRejected,
    contentPreserved:saved.saved === bootstrap.records.length,
    versionAdvanced:saved.version === expectedVersion + 1,
  };
}

console.log(JSON.stringify({
  ok:true,
  environment:env,
  sessionExpiresInSeconds:login.expiresInSeconds,
  counts:{
    records:Array.isArray(bootstrap.records) ? bootstrap.records.length : -1,
    feedbacks:Array.isArray(bootstrap.feedbacks) ? bootstrap.feedbacks.length : -1,
    aiJobs:Array.isArray(bootstrap.aiJobs) ? bootstrap.aiJobs.length : -1,
    audits:Array.isArray(bootstrap.audits) ? bootstrap.audits.length : -1,
  },
  ...(optimisticLock ? { optimisticLock } : {}),
}, null, 2));
process.exit(0);
