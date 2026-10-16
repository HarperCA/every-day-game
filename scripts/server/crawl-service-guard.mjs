// systemd 抓取服务的前后置保障。保持为独立模块，避免调度故障影响主流水线。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPipelineLedger } from './pipeline-ledger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLANS = path.join(HERE, 'plans');
const START_FILE = path.join(PLANS, 'crawl-service-start.json');

export const beijingDate = (now = new Date()) => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
export const planIsUsable = plan => Boolean(plan && Array.isArray(plan.search) && plan.trace && typeof plan.trace === 'object');
export const runDate = name => {
  const match = String(name).match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3})Z$/);
  return match ? new Date(match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})$/, 'T$1:$2:$3.$4Z')) : new Date(NaN);
};

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

async function postLedger(ledger) {
  const token = fs.readFileSync(path.join(HERE, '.admin-token'), 'utf8').trim();
  const response = await fetch(`${process.env.API_BASE || 'http://127.0.0.1:8787'}/api/adminData`, {
    method:'POST', headers:{ 'content-type':'application/json' },
    body:JSON.stringify({ adminToken:token, action:'savePipelineRun', run:ledger }),
    signal:AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!result?.ok) throw new Error(result?.message || `HTTP ${response.status}`);
}

export async function preflight({ here = HERE, now = new Date(), spawn = spawnSync, log = console.log } = {}) {
  const plans = path.join(here, 'plans');
  fs.mkdirSync(plans, { recursive:true });
  const startedAt = now.toISOString();
  fs.writeFileSync(path.join(plans, 'crawl-service-start.json'), JSON.stringify({ startedAt, pid:process.pid }));
  const date = beijingDate(now);
  const planFile = path.join(plans, `search-plan-${date}.json`);
  let plan = readJson(planFile);
  let attempted = false;
  let error = '';
  if (!planIsUsable(plan)) {
    attempted = true;
    log(`当日搜索计划缺失或无效：${planFile}；现在补生成。`);
    const result = spawn(process.execPath, [path.join(here, 'search-plan.mjs'), '--date', date],
      { cwd:here, stdio:'inherit', timeout:120000 });
    if (result.error) error = result.error.message;
    else if (result.status !== 0) error = `搜索计划退出码 ${result.status ?? 'unknown'}`;
    plan = readJson(planFile);
  }
  const usable = planIsUsable(plan);
  const status = { startedAt, date, planFile, usable, attempted, error:error || (usable ? '' : '补生成后仍无有效计划，抓取将使用默认搜索配置') };
  fs.writeFileSync(path.join(plans, 'crawl-plan-preflight.json'), JSON.stringify(status, null, 2));
  log(usable ? `当日搜索计划已就绪：${planFile}` : `警告：${status.error}。本轮仍继续抓取。`);
  return status;
}

export function selectServiceRun(runsDir, startedAt) {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start) || !fs.existsSync(runsDir)) return '';
  const candidates = fs.readdirSync(runsDir).map(name => ({ name, time:runDate(name).getTime() }))
    .filter(item => Number.isFinite(item.time) && item.time >= start - 5000 && item.time <= Date.now() + 5000)
    .sort((a, b) => a.time - b.time);
  return candidates[0]?.name || '';
}

export async function recordFailure({ here = HERE, result = process.env.SERVICE_RESULT, exitCode = process.env.EXIT_CODE,
  exitStatus = process.env.EXIT_STATUS, now = new Date(), post = postLedger, log = console.log } = {}) {
  if (result === 'success') return { skipped:'service_success' };
  const marker = readJson(path.join(here, 'plans', 'crawl-service-start.json'));
  const runName = selectServiceRun(path.join(here, 'runs'), marker?.startedAt);
  const runId = runName || now.toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(here, 'runs', runId);
  fs.mkdirSync(runDir, { recursive:true });
  const ledgerFile = path.join(runDir, 'result-ledger.json');
  if (fs.existsSync(ledgerFile)) return { skipped:'pipeline_already_recorded', runId };
  const error = `抓取服务异常结束：${result || 'unknown'}；${exitCode || 'unknown'}=${exitStatus || 'unknown'}`;
  const ledger = buildPipelineLedger(runDir, { startedAt:marker?.startedAt || now.toISOString(), error, at:now.toISOString() });
  fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
  fs.appendFileSync(path.join(here, 'pipeline.log'), JSON.stringify({ at:now.toISOString(), error, serviceResult:result, runId }) + '\n');
  try { await post(ledger); log(`异常抓取已写入后台结果账：${runId}`); }
  catch (caught) { log(`异常抓取已保存在 ${ledgerFile}，后台写入失败：${caught.message}`); }
  return { runId, ledger, error };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const action = process.argv[2];
  (action === 'preflight' ? preflight() : action === 'record-failure' ? recordFailure() : Promise.reject(new Error('未知操作')))
    .catch(error => { console.error('抓取服务保障失败：', error); process.exitCode = 1; });
}
