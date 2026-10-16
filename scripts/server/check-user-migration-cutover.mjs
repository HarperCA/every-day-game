// Offline, read-only migration gate. Never calls a dispatch or WeChat API.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DELIVERY = new Set(['pending', 'queued', 'sent', 'failed', 'manual_required', 'expired', 'cancelled']);
const AUTHORIZATION = new Set(['accepted', 'rejected', 'not_requested', 'unavailable']);
const SCHEDULE = new Set(['normal', 'time_updated', 'postponed', 'cancelled']);
const AMBIGUOUS_ERROR = /timeout|timed.?out|ECONNRESET|socket.?hang.?up|fetch.?failed|AbortError|delivery.?unknown|sent_but_state_update_failed/i;
export const REQUIRED_EVIDENCE = [
  'usTimerDisabled', 'usServiceInactive', 'shanghaiTimerDisabled', 'shanghaiDispatchRevoked',
  'beijingTimerDisabledDuringCheck', 'singleWriteDestination', 'accountMappingVerified',
  'templatesVerified', 'realDeviceNotificationVerified', 'logImportVerified',
];

export function assessReminder(row, accountIds, now) {
  const reasons = [];
  const id = String(row?._id || row?.id || '');
  if (!id) reasons.push('missing_record_id');
  if (!accountIds.has(String(row.user_id || ''))) reasons.push('account_missing');
  if (!Number.isFinite(Date.parse(row.remind_at))) reasons.push('invalid_remind_at');
  if (!DELIVERY.has(row.delivery_status)) reasons.push('unknown_delivery_status');
  if (!AUTHORIZATION.has(row.authorization_status)) reasons.push('unknown_authorization_status');
  if (!SCHEDULE.has(row.schedule_change_status)) reasons.push('unknown_schedule_status');
  if (!Number.isInteger(Number(row.retry_count || 0)) || Number(row.retry_count || 0) < 0) reasons.push('invalid_retry_count');
  if (row.delivery_status === 'queued') reasons.push('delivery_result_unknown');
  if (row.delivery_status !== 'sent' && row.sent_at) reasons.push('sent_timestamp_status_conflict');
  if (row.delivery_status === 'failed' && AMBIGUOUS_ERROR.test(String(row.last_error || ''))) {
    reasons.push('network_failure_delivery_unknown');
  }
  if (row.authorization_status === 'accepted' && ['pending', 'failed', 'queued'].includes(row.delivery_status)
    && !row.subscription_template_id) reasons.push('accepted_without_template');
  const due = row.authorization_status === 'accepted' && ['pending', 'failed'].includes(row.delivery_status)
    && Date.parse(row.remind_at) <= now;
  return { id, reasons, due, canDispatch: due && reasons.length === 0
    && ['normal', 'time_updated', 'postponed'].includes(row.schedule_change_status)
    && Number(row.retry_count || 0) < 3 && now - Date.parse(row.remind_at) <= 86400000 };
}

export function auditCutover(collections, evidence = {}, now = Date.now()) {
  const blockers = [];
  for (const name of ['user_account', 'reminder', 'client_issues', 'client_stats']) {
    if (!Array.isArray(collections[name])) blockers.push(`collection_missing:${name}`);
  }
  const accountIds = new Set((collections.user_account || []).map(row => String(row._id || row.id || '')));
  const seen = new Set();
  const reminders = (collections.reminder || []).map(row => {
    const result = assessReminder(row, accountIds, now);
    if (seen.has(result.id)) result.reasons.push('duplicate_record_id');
    seen.add(result.id);
    return result;
  });
  for (const result of reminders) if (result.reasons.length) blockers.push(`reminder:${result.id}:${result.reasons.join(',')}`);
  for (const field of REQUIRED_EVIDENCE) if (evidence[field] !== true) blockers.push(`evidence_missing:${field}`);
  for (const name of ['client_issues', 'client_stats']) {
    const ids = new Set();
    for (const row of collections[name] || []) {
      const id = String(row._id || row.id || '');
      if (!id || ids.has(id)) blockers.push(`invalid_log_identity:${name}`);
      ids.add(id);
    }
  }
  return {
    checkedAt: new Date(now).toISOString(), dryRun: true, sends: 0, writes: 0,
    dispatchAllowed: blockers.length === 0, blockers,
    reminders: { count: reminders.length, due: reminders.filter(row => row.due).length,
      dispatchCandidates: reminders.filter(row => row.canDispatch).length,
      requiresReview: reminders.filter(row => row.reasons.length) },
    logs: { issues: (collections.client_issues || []).length, stats: (collections.client_stats || []).length,
      policy: 'Preserve source document IDs; import full snapshots before switching. Do not sum daily snapshots or resume from a timestamp-only cursor.' },
  };
}

function main(argv) {
  const index = argv.indexOf('--source');
  if (index < 0 || !argv[index + 1]) throw new Error('Usage: node check-user-migration-cutover.mjs --source EXPORT_DIR [--evidence evidence.json]');
  const source = path.resolve(argv[index + 1]);
  const collections = {};
  for (const name of ['user_account', 'reminder', 'client_issues', 'client_stats']) {
    const file = path.join(source, `${name}.json`);
    if (fs.existsSync(file)) collections[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const evidenceIndex = argv.indexOf('--evidence');
  const evidence = evidenceIndex >= 0 ? JSON.parse(fs.readFileSync(path.resolve(argv[evidenceIndex + 1]), 'utf8')) : {};
  const report = auditCutover(collections, evidence);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.dispatchAllowed) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
