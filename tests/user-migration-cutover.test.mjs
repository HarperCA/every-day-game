import { describe, it, expect } from 'vitest';
import { assessReminder, auditCutover, REQUIRED_EVIDENCE } from '../scripts/server/check-user-migration-cutover.mjs';
const now = Date.parse('2026-10-13T04:00:00Z');
const row = { _id: 'r1', user_id: 'u1', authorization_status: 'accepted', delivery_status: 'pending',
  subscription_template_id: 'template', remind_at: '2026-10-13T03:59:00Z', schedule_change_status: 'normal', retry_count: 0 };
const accounts = new Set(['u1']);
const dump = reminders => ({ user_account: [{ _id: 'u1' }], reminder: reminders, client_issues: [], client_stats: [] });
const verified = Object.fromEntries(REQUIRED_EVIDENCE.map(name => [name, true]));
describe('offline user migration dispatch gate', () => {
  it('blocks unknown send results even when all deployment evidence passes', () => {
    const report = auditCutover(dump([{ ...row, delivery_status: 'queued' }]), verified, now);
    expect(report.dispatchAllowed).toBe(false);
    expect(report.reminders.requiresReview[0].reasons).toContain('delivery_result_unknown');
    expect(report.sends).toBe(0);
  });
  it('blocks timeout failures instead of approving automatic duplicate sends', () => {
    expect(assessReminder({ ...row, delivery_status: 'failed', last_error: 'ECONNRESET' }, accounts, now).canDispatch).toBe(false);
  });
  it('never treats sent or unauthorized reminders as dispatch candidates', () => {
    expect(assessReminder({ ...row, delivery_status: 'sent' }, accounts, now).canDispatch).toBe(false);
    expect(assessReminder({ ...row, authorization_status: 'not_requested' }, accounts, now).canDispatch).toBe(false);
  });
  it('blocks missing log snapshots and incomplete cutover evidence', () => {
    expect(auditCutover({ user_account: [], reminder: [] }, {}, now).blockers).toContain('collection_missing:client_issues');
    expect(auditCutover(dump([row]), {}, now).dispatchAllowed).toBe(false);
  });
  it('accepts only verified unambiguous correctly linked data without writing or sending', () => {
    const report = auditCutover(dump([row]), verified, now);
    expect(report.dispatchAllowed).toBe(true);
    expect(report.reminders.dispatchCandidates).toBe(1);
    expect(report.writes).toBe(0);
  });
  it('blocks duplicate IDs and missing accounts', () => {
    const report = auditCutover(dump([row, { ...row, user_id: 'wrong' }]), verified, now);
    expect(report.dispatchAllowed).toBe(false);
    expect(report.reminders.requiresReview[0].reasons).toContain('account_missing');
  });
  it('requires template for active jobs but does not reactivate expired history', () => {
    expect(assessReminder({ ...row, subscription_template_id: null }, accounts, now).reasons).toContain('accepted_without_template');
    expect(assessReminder({ ...row, delivery_status: 'expired', subscription_template_id: null }, accounts, now).canDispatch).toBe(false);
    expect(assessReminder({ ...row, delivery_status: 'manual_required', subscription_template_id: null }, accounts, now).reasons).toEqual([]);
  });
});
