// 每轮抓取的业务结果。金额只记录供应商实际返回的费用；未知保持 null。
import fs from 'node:fs';
import path from 'node:path';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function buildPipelineLedger(runDir, entry) {
  const extracted = readJson(path.join(runDir, 'combined-extracted.json'));
  const ingest = readJson(path.join(runDir, 'ingest-report.json'));
  const scope = readJson(path.join(runDir, 'combined-candidates.json.scope-review.json'));
  const jev = readJson(path.join(runDir, 'jev-filter-report.json'));
  const followup = readJson(path.join(runDir, 'notice-followup-filter-report.json'));
  const failures = [];
  if (entry.error) failures.push({ stage:'pipeline', reason:String(entry.error).slice(0, 300), count:1 });
  for (const [reason, count] of Object.entries(ingest?.failureReasons || {})) {
    failures.push({ stage:'admission', reason, count });
  }
  if (!ingest?.failureReasons && Array.isArray(scope?.held)) {
    const reasons = new Map();
    for (const item of scope.held) {
      const reason = String(item.scope?.reason || '范围未通过');
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
    }
    for (const [reason, count] of reasons) failures.push({ stage:'scope', reason, count });
  }
  if (Array.isArray(jev?.decisions)) {
    const reasons = new Map();
    for (const decision of jev.decisions) {
      if (decision.action === 'fetch') continue;
      const reason = `${decision.action === 'reject' ? '拦截' : '保留线索'}：${decision.kind || '未分类'}`;
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
    }
    for (const [reason, count] of reasons) failures.push({ stage:'pre_filter', reason, count });
  }
  for (const [reason, count] of Object.entries(extracted?.failureReasons || {})) {
    failures.push({ stage:'extraction', reason, count });
  }
  if (extracted && !extracted.failureReasons) {
    const counts = new Map();
    for (const item of extracted.results || []) {
      if (item.ok) continue;
      const reason = String(item.status || 'unknown');
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
    for (const [reason, count] of counts) failures.push({ stage:'extraction', reason, count });
  }
  const sources = Array.isArray(entry.summary) ? entry.summary : [];
  const total = field => sources.reduce((sum, item) => sum + (Number(item[field]) || 0), 0);
  const firstCost = jev?.costUsd;
  const followupCost = followup?.costUsd;
  return {
    id:path.basename(runDir), startedAt:entry.startedAt || null, finishedAt:entry.at || new Date().toISOString(),
    status:entry.error ? 'failed' : entry.filterOnly ? 'filter_only' : entry.dryRun ? 'dry_run' : 'completed',
    sources:sources.map(item => ({ source:item.source, fetched:item.fetched, new:item.new,
      duplicate:item.duplicate, likelyDuplicate:item.likely_duplicate, uncertain:item.uncertain })),
    searchResults:total('fetched'), newLeads:total('new'),
    eligibleDiscovered:ingest?.eligibleDiscovered ?? null,
    newRecords:ingest?.added ?? null,
    qualifiedNew:ingest?.qualifiedNew ?? null,
    publishedNew:ingest?.publishedNew ?? null,
    publishedExisting:ingest?.publishedExisting ?? null,
    publishedTotal:ingest?.publishedNew == null || ingest?.publishedExisting == null
      ? null : ingest.publishedNew + ingest.publishedExisting,
    existingEnriched:ingest?.enriched ?? null,
    existingUpdated:ingest?.updated ?? null,
    extractionAttempted:extracted?.total ?? (entry.extracted || 0),
    extractionSucceeded:extracted?.succeeded ?? null,
    jev:{ reviewed:jev?.total ?? null, fetch:jev?.fetch ?? null, leads:jev?.leads ?? null,
      rejected:jev?.rejected ?? null, followupFetch:followup?.fetch ?? null },
    costsUsd:{ jev:firstCost == null ? null : Number(firstCost) + (followupCost == null ? 0 : Number(followupCost)),
      extraction:null, admission:null, baidu:null },
    failures:failures.sort((a,b)=>b.count-a.count),
    recordIds:{ added:ingest?.addedIds || [], published:ingest?.publishedIds || [], updated:ingest?.updatedIds || [], enriched:ingest?.enrichedIds || [] },
    measured:{ eligibility:!!ingest, publishing:!!ingest, costComplete:false },
  };
}
