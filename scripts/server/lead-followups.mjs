// 抓取线索的后续任务。只有已经尝试读详情而失败的页面会自动重读；
// Jev 认为“只留线索/人工复核”的页面保留原因，等待新的原文或人工核查。
import fs from 'node:fs';

export const MAX_READ_ATTEMPTS = 3; // 首读 + 最多两次后续重读
const DAY = 86400000;
const PERMANENT_READ_FAILURES = new Set(['blocked_by_robots', 'invalid_url', 'unsupported_protocol', 'too_large']);
export function retryableReadFailure(status) {
  return ['fetch_failed', 'page_is_boilerplate', 'http_408', 'http_429'].includes(status)
    || /^http_5\d\d$/.test(String(status || ''));
}

export function leadKey(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch { return ''; }
}

export function loadLeadFollowups(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value?.version === 1 && value.entries && typeof value.entries === 'object' ? value : { version:1, entries:{} };
  } catch { return { version:1, entries:{} }; }
}

export function saveLeadFollowups(file, state) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
}

function compactCandidate(candidate) {
  const { pageHtml, renderedImages, discoveredEvidence, ...rest } = candidate || {};
  return rest;
}

function followupType(decision) {
  if (decision.kind === 'directory_lead') return 'directory';
  if (['organization_lead', 'column_lead'].includes(decision.kind)) return 'source';
  return 'manual_review';
}

export function recordJevLeads(state, decisions, now = new Date(), runId = '') {
  const entries = { ...state.entries };
  for (const decision of decisions) {
    if (!['lead', 'review'].includes(decision.action)) continue;
    const candidate = decision.candidate;
    const key = leadKey(candidate?.detailUrl);
    if (!key) continue;
    const previous = entries[key];
    if (runId && previous?.observedRuns?.includes(runId)) continue;
    const firstSeenAt = previous?.firstSeenAt && Date.parse(previous.firstSeenAt) < now.getTime() ? previous.firstSeenAt : now.toISOString();
    const lastSeenAt = previous?.lastSeenAt && Date.parse(previous.lastSeenAt) > now.getTime() ? previous.lastSeenAt : now.toISOString();
    entries[key] = {
      candidate:compactCandidate(candidate), status:'manual_review', action:decision.action,
      kind:decision.kind || '', followupType:followupType(decision), reason:decision.reason || '',
      firstSeenAt, lastSeenAt,
      seenCount:(previous?.seenCount || 0) + 1,
      readAttempts:previous?.readAttempts || 0, nextRetryAt:null, readTerminal:false,
      observedRuns:runId ? [...(previous?.observedRuns || []), runId] : (previous?.observedRuns || []),
    };
  }
  return { version:1, entries };
}

// 已排入人工核查的同网址再次被搜索发现时，只更新时间与次数，不重问相同的 Jev。
export function recordRediscoveries(state, candidates, now = new Date(), runId = '') {
  const entries = { ...state.entries };
  for (const candidate of candidates) {
    const key = leadKey(candidate.detailUrl);
    const previous = entries[key];
    if (!previous || previous.status !== 'manual_review') continue;
    if (runId && previous.observedRuns?.includes(runId)) continue;
    entries[key] = { ...previous, lastSeenAt:now.toISOString(), seenCount:(previous.seenCount || 0) + 1,
      observedRuns:runId ? [...(previous.observedRuns || []), runId] : (previous.observedRuns || []) };
  }
  return { version:1, entries };
}

export function dueReadFollowups(state, now = new Date(), limit = 20) {
  return Object.entries(state.entries)
    .filter(([, item]) => item.status === 'retry_read' && item.readAttempts < MAX_READ_ATTEMPTS
      && Date.parse(item.nextRetryAt || '') <= now.getTime())
    .sort((a, b) => Date.parse(a[1].nextRetryAt) - Date.parse(b[1].nextRetryAt))
    .slice(0, limit)
    .map(([key, item]) => ({ key, candidate:item.candidate }));
}

export function recordReadOutcomes(state, candidates, results, now = new Date()) {
  const entries = { ...state.entries };
  const byKey = new Map((results || []).map(item => [leadKey(item.url), item]));
  for (const candidate of candidates) {
    const key = leadKey(candidate.detailUrl);
    const result = byKey.get(key);
    if (!key || !result) continue;
    if (result.ok) { delete entries[key]; continue; }
    const previous = entries[key];
    const readAttempts = (previous?.readAttempts || 0) + 1;
    const retry = readAttempts < MAX_READ_ATTEMPTS && retryableReadFailure(result.status)
      && !PERMANENT_READ_FAILURES.has(result.status);
    entries[key] = {
      candidate:compactCandidate(candidate), status:retry ? 'retry_read' : 'manual_review',
      action:'fetch', kind:result.status || 'read_failed', followupType:'manual_review',
      reason:`详情读取失败：${result.status || 'unknown'}${result.error ? `；${String(result.error).slice(0, 160)}` : ''}`,
      firstSeenAt:previous?.firstSeenAt || now.toISOString(), lastSeenAt:now.toISOString(),
      seenCount:(previous?.seenCount || 0) + 1, readAttempts,
      nextRetryAt:retry ? new Date(now.getTime() + (readAttempts === 1 ? DAY : 2 * DAY)).toISOString() : null,
      readTerminal:!retry,
    };
  }
  return { version:1, entries };
}
