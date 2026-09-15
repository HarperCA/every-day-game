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
// 真实调用一次 Kimi，会消耗额度，所以默认关闭。只读取赛事，不写回任何数据。
const aiCheck = process.argv.includes('--ai-check');
// 手动触发一次定时批量检测，用于把「触发器没建」和「函数跑不完」区分开。
const scheduledCheck = process.argv.includes('--scheduled-check');
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

async function call(data, timeoutMs = 15000) {
  const response = await withTimeout(app.callFunction({ name:'adminData', data, parse:true }), `adminData:${data.action}`, timeoutMs);
  const result = typeof response?.result === 'string' ? JSON.parse(response.result) : response?.result;
  if (!result?.ok) throw new Error(result?.message || 'adminData returned an invalid response');
  return result.data;
}

const login = await call({ action:'login', adminToken });
if (!login?.sessionToken) throw new Error('adminData login did not return a session token');
const bootstrap = await call({ action:'bootstrap', sessionToken:login.sessionToken });

// 只回报 AI 配置是否存在和运行时能力，云函数不会回传密钥内容。
console.error('[verify-admin-cloud] checking adminData AI review configuration');
let aiReview;
try {
  aiReview = await call({ action:'aiReviewConfig', sessionToken:login.sessionToken });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  aiReview = message.includes('unsupported_action')
    ? { error:'云端 adminData 仍是旧版本，缺少 aiReviewConfig，请重新部署云函数' }
    : { error:message };
}
if (!aiReview.error) {
  aiReview.blockers = [
    !aiReview.apiKeyConfigured && 'AI_API_KEY 未配置：在 adminData 环境变量中添加后重新部署云函数',
    aiReview.apiKeyHasSurroundingWhitespace && 'AI_API_KEY 首尾有空格或换行',
    aiReview.apiKeyLooksQuoted && 'AI_API_KEY 被引号包住了，请只填密钥本身',
  ].filter(Boolean);
}
let scheduledRun;
if (scheduledCheck) {
  console.error('[verify-admin-cloud] manually running one scheduled AI review batch');
  const startedAt = Date.now();
  try {
    scheduledRun = { ...await call({ action:'runScheduledAiReview', sessionToken:login.sessionToken }, 120000), clientElapsedMs:Date.now() - startedAt };
  } catch (error) {
    scheduledRun = { ok:false, clientElapsedMs:Date.now() - startedAt, error:error instanceof Error ? error.message : String(error) };
  }
}

let aiLiveRun;
if (aiCheck) {
  const sample = bootstrap.records[0];
  if (!sample) throw new Error('no competition record available for --ai-check');
  console.error(`[verify-admin-cloud] running one live Kimi review on "${sample.name}"`);
  const startedAt = Date.now();
  try {
    const review = await call({ action:'runCompetitionAiReview', sessionToken:login.sessionToken, recordId:sample.id }, 120000);
    aiLiveRun = {
      ok:true,
      recordName:sample.name,
      elapsedMs:Date.now() - startedAt,
      decision:review.decision,
      riskLevel:review.risk_level,
      responseFormat:review.response_format,
      issueCount:Array.isArray(review.issues) ? review.issues.length : -1,
      evidenceCount:Array.isArray(review.evidence_refs) ? review.evidence_refs.length : -1,
      evidenceStatus:review.evidence_status || null,
      summary:review.summary,
    };
  } catch (error) {
    aiLiveRun = {
      ok:false,
      recordName:sample.name,
      elapsedMs:Date.now() - startedAt,
      error:error instanceof Error ? error.message : String(error),
    };
  }
}

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
  publishState:(() => {
    const records = Array.isArray(bootstrap.records) ? bootstrap.records : [];
    return {
      total:records.length,
      published:records.filter(record => record.dataStatus === 'published').length,
      manualReviewPassed:records.filter(record => record.manualReview === 'passed').length,
      systemValidationPassed:records.filter(record => record.systemValidation === 'passed').length,
      aiReviewed:records.filter(record => record.aiReview).length,
    };
  })(),
  aiReview,
  lastAiReviewRun:bootstrap.lastAiReviewRun ?? null,
  lastReminderInvocation:await call({ action:'reminderInvocationLog', sessionToken:login.sessionToken }).catch(() => null),
  ...(scheduledRun ? { scheduledRun } : {}),
  ...(aiLiveRun ? { aiLiveRun } : {}),
  ...(optimisticLock ? { optimisticLock } : {}),
}, null, 2));
process.exit(0);
