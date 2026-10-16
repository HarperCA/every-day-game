// Apply genuine user-authorized multi-agent official evidence reviews; never fabricate Kimi approval.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const cjs = fs.existsSync(path.join(HERE, 'cjs/publicCache.js')) ? path.join(HERE, 'cjs') : path.resolve(HERE, '../../apps/miniprogram/cloudfunctions/adminData');
const { requirePublishGate, toPublicCache } = require(path.join(cjs, 'publicCache.js'));
const { unresolvedRegistrationQualityIssues, registrationInstant } = require(path.join(cjs, 'registrationSchedule.js'));
const METHOD = 'user_authorized_multiagent_official_evidence_review';
const HTTP_OFFICIAL_HOSTS = new Set(['www.gcxl.edu.cn', 'js.robot12360.com', 'www.lalavision.com', 'match.xmkeyun.com.cn', 'rgzn.52jingsai.com', 'chuangxin.52jingsai.com', 'www.brskills.com']);
const bookkeeping = new Set(['aiReviewFailure', 'fieldVerificationFailure', 'updatedAt', 'updatedBy']);
export function factualIdentity(record) {
  if (!record) return null;
  return Object.fromEntries(Object.entries(record).filter(([key]) => !bookkeeping.has(key)));
}
export function loadProposals(directory) {
  const baselines = new Map(), proposals = [];
  for (let i = 1; i <= 3; i++) {
    const group = JSON.parse(fs.readFileSync(path.join(directory, `group-${i}.json`), 'utf8'));
    const result = JSON.parse(fs.readFileSync(path.join(directory, `results-${i}.json`), 'utf8'));
    for (const record of Array.isArray(group) ? group : group.records || group.results || []) {
      if (baselines.has(record.id)) throw new Error(`duplicate_baseline:${record.id}`);
      baselines.set(record.id, record);
    }
    proposals.push(...(Array.isArray(result) ? result : result.results || result.records || []));
  }
  const ids = new Set();
  for (const proposal of proposals) {
    if (ids.has(proposal.id) || !baselines.has(proposal.id)) throw new Error(`duplicate_or_missing_baseline:${proposal.id}`);
    ids.add(proposal.id);
  }
  return { baselines, proposals };
}
export function validateEvidence(proposal) {
  if (!proposal.reason?.trim()) throw new Error('missing_reason');
  const sources = proposal.sources?.length ? proposal.sources : proposal.recordPatch?.sources || [];
  for (const source of sources) {
    const url = new URL(source.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('invalid_source_protocol');
    if (url.protocol === 'http:' && !HTTP_OFFICIAL_HOSTS.has(url.hostname)) throw new Error(`http_source_not_allowlisted:${url.hostname}`);
    if (!source.evidence_excerpt?.trim() || !proposal.evidence?.some(e => e.url === source.url && e.status === 'reachable' && typeof e.text === 'string' && e.text.includes(source.evidence_excerpt))) throw new Error(`source_excerpt_not_actual_evidence:${source.url}`);
  }
  if (['published', 'archived'].includes(proposal.outcome) && !sources.some(s => s.is_official === true && s.validity_status === 'valid')) throw new Error('reviewed_official_source_required');
  if (proposal.outcome === 'delete' && !/重复|汇总|合集|非独立|不是独立|不属于|不符合|非赛事|非比赛/.test(proposal.reason)) throw new Error('deletion_reason_not_supported');
  return sources;
}
export function buildCandidate(before, proposal, now = new Date()) {
  const sources = validateEvidence(proposal);
  if (proposal.outcome === 'blocked' || proposal.outcome === 'delete') return null;
  if (!['published', 'archived'].includes(proposal.outcome)) throw new Error('invalid_outcome');
  const at = now.toISOString(), patch = proposal.recordPatch || {};
  const record = { ...before, ...patch, id:before.id, schedule:{ ...before.schedule, ...patch.schedule }, dataStatus:proposal.outcome,
    systemValidation:'passed', manualReview:'passed', needsManualReview:false, reviewedAt:at, updatedAt:at, updatedBy:'system:official-evidence-review',
    aiReview:before.aiReview, aiResolution:{ reviewed_at:at, reason:proposal.reason, outcome:proposal.outcome, review_method:METHOD, initial_review:before.aiReview, evidence:proposal.evidence },
    sources:sources.map((s, i) => ({ ...s, id:s.id || `source-${before.id}-multiagent-${i + 1}`, edition_id:before.id, last_verified_at:s.last_verified_at || s.fetched_at || at,
      title:s.title || patch.name || before.name, content_summary:s.content_summary || proposal.reason, review_reason:s.review_reason || proposal.reason })) };
  record.qualityIssues = unresolvedRegistrationQualityIssues(record).filter(issue => !/^周检：|^ai_review_/.test(issue));
  delete record.aiReviewFailure;
  delete record.fieldVerificationFailure;
  if (proposal.outcome === 'published') requirePublishGate(record);
  else {
    const end = registrationInstant(record.schedule?.registration_end, 'end');
    const text = sources.filter(s => s.is_official).map(s => s.evidence_excerpt).join('\n');
    // A past date must be present in reviewed official text; otherwise require actual completed-stage evidence.
    const dateParts = String(record.schedule?.registration_end || '').slice(0,10).split('-');
    const datePattern = dateParts.length === 3 ? new RegExp(`${dateParts[0]}\\D{0,6}0?${Number(dateParts[1])}\\D{0,6}0?${Number(dateParts[2])}(?:\\D|$)`) : null;
    const dateEvidence = Number.isFinite(end) && now.getTime() > end && datePattern?.test(text);
    const completedEvidence = /公示期限已圆满结束|获奖名单|获奖结果|比赛[^\n]{0,30}结束|竞赛[^\n]{0,30}结束|报名[^\n]{0,20}已结束/.test(text);
    // Official month-only initial entry window, not a later qualified-team round.
    const monthWindowEnded = now.getUTCFullYear() === Number(record.editionYear) && now.getUTCMonth() + 1 > 6
      && /报名[^\n]{0,50}(?:4|４)\s*(?:月)?\s*[-—–至~～]\s*(?:6|６)\s*月/.test(text)
      && /晋级|复赛|初赛/.test(proposal.reason);
    if (!dateEvidence && !completedEvidence && !monthWindowEnded) throw new Error('archive_official_completion_evidence_required');
  }
  toPublicCache(record, now);
  return record;
}
export async function main(args = process.argv.slice(2)) {
  const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
  const directory = path.resolve(option('--dir', path.resolve(HERE, '../../reports/kimi-resolution-review')));
  const apply = args.includes('--apply');
  const token = fs.readFileSync(option('--token-file', path.join(HERE, '.admin-token')), 'utf8').trim();
  const api = option('--api', process.env.API_BASE || 'http://127.0.0.1:8787');
  const { baselines, proposals } = loadProposals(directory);
  async function call(action, extra = {}) {
    const response = await fetch(`${api}/api/adminData`, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, action, ...extra }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || `http_${response.status}`);
    return result.data;
  }
  const snapshot = await call('bootstrap');
  if (!Array.isArray(snapshot.records) || !snapshot.records.length) throw new Error('missing_or_empty_records_refusing_replace');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDirectory = path.join(directory, `apply-${stamp}`);
  fs.mkdirSync(backupDirectory, { recursive:true });
  fs.writeFileSync(path.join(backupDirectory, 'before.json'), JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(path.join(backupDirectory, 'results.json'), JSON.stringify(proposals, null, 2));
  fs.writeFileSync(path.join(backupDirectory, 'deleted.json'), JSON.stringify(proposals.filter(p => p.outcome === 'delete').map(p => ({ proposal:p, record:snapshot.records.find(r => r.id === p.id) })), null, 2));
  const receipts = [];
  const receipt = value => { receipts.push(value); fs.appendFileSync(path.join(backupDirectory, 'receipts.jsonl'), JSON.stringify(value) + '\n'); console.log(JSON.stringify(value)); };
  for (const proposal of proposals) {
    if (proposal.outcome === 'blocked') { receipt({ id:proposal.id, status:'blocked', reason:proposal.reason }); continue; }
    try {
      let saved = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const fresh = apply ? await call('bootstrap') : snapshot;
        const before = fresh.records.find(r => r.id === proposal.id);
        if (!before) { receipt({ id:proposal.id, status:'skip_missing' }); saved = true; break; }
        if (!isDeepStrictEqual(factualIdentity(before), factualIdentity(baselines.get(proposal.id)))) { receipt({ id:proposal.id, status:'skip_concurrent_fact_change' }); saved = true; break; }
        validateEvidence(proposal);
        const candidate = buildCandidate(before, proposal);
        if (!apply) { receipt({ id:proposal.id, status:'dry_run_valid', outcome:proposal.outcome }); saved = true; break; }
        const records = proposal.outcome === 'delete' ? fresh.records.filter(r => r.id !== proposal.id) : fresh.records.map(r => r.id === proposal.id ? candidate : r);
        fs.writeFileSync(path.join(backupDirectory, `${proposal.id}-before.json`), JSON.stringify(before, null, 2));
        try {
          const response = await call('saveRecords', { records, expectedVersion:fresh.stateVersions.records, auditEntry:{ id:`multiagent-${proposal.id}-${Date.now()}`, action:proposal.outcome === 'delete' ? 'delete' : 'update', objectType:'competition', recordId:proposal.id, recordName:before.name, createdAt:new Date().toISOString(), reason:`${proposal.reason}；用户授权多智能体官方证据复核；完整备份：${backupDirectory}`, review_method:METHOD, backupPath:backupDirectory } });
          receipt({ id:proposal.id, status:'saved', outcome:proposal.outcome, previousVersion:fresh.stateVersions.records, response }); saved = true; break;
        } catch (error) { if (!/version|conflict|版本|冲突/i.test(error.message)) throw error; }
      }
      if (!saved) receipt({ id:proposal.id, status:'conflict_retries_exhausted' });
    } catch (error) { receipt({ id:proposal.id, status:'validation_or_save_failed', error:error.message }); }
  }
  fs.writeFileSync(path.join(backupDirectory, 'summary.json'), JSON.stringify({ apply, backupDirectory, counts:receipts.reduce((out, r) => ({ ...out, [r.status]:(out[r.status] || 0) + 1 }), {}), receipts }, null, 2));
  if (receipts.some(r => ['validation_or_save_failed', 'conflict_retries_exhausted'].includes(r.status))) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
