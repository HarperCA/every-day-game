import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { AUDIT_ACTIONS, buildSafeAuditEntry, validateAuditIdentity } = require('../apps/miniprogram/cloudfunctions/adminData/auditValidation.js');

describe('admin audit validation', () => {
  it('covers every action emitted by the current admin UI', () => {
    for (const action of ['update','reset','system_validation_run','manual_review_pass','manual_review_reject','publish','unpublish','profession_mapping_update','feedback_ai_queue','feedback_accept','feedback_reject','feedback_spotcheck_correct','feedback_spotcheck_incorrect','feedback_update','ai_job_retry','ai_job_manual','ai_job_resolve','ai_job_update']) {
      expect(AUDIT_ACTIONS.has(action), action).toBe(true);
    }
  });

  it('normalizes the default object type', () => {
    expect(validateAuditIdentity({ id:'audit-1', action:'update', recordId:'edition-1' })).toEqual({ action:'update', objectType:'event_edition' });
  });

  it('rejects unknown actions, object types, and empty record IDs', () => {
    expect(() => validateAuditIdentity({ id:'audit-1', action:'invented', recordId:'x' })).toThrow('invalid_audit_action');
    expect(() => validateAuditIdentity({ id:'audit-1', action:'update', objectType:'secret', recordId:'x' })).toThrow('invalid_audit_object_type');
    expect(() => validateAuditIdentity({ id:'audit-1', action:'update', recordId:'' })).toThrow('invalid_audit_record_id');
    expect(() => validateAuditIdentity({ id:'../audit', action:'update', recordId:'x' })).toThrow('invalid_audit_entry');
  });

  it('normalizes audit timestamps and bounds client-controlled text', () => {
    const result = buildSafeAuditEntry({
      id:'audit-1', action:'update', recordId:'edition-1', recordName:'赛'.repeat(250),
      changedFields:['name'], changes:{ name:{ before:'旧', after:'新' } }, reason:'因'.repeat(600), createdAt:'2026-09-08T00:00:00Z',
    });
    expect(result.created_at).toBe('2026-09-08T00:00:00.000Z');
    expect(result.record_name).toHaveLength(200);
    expect(result.reason).toHaveLength(500);
    expect(() => buildSafeAuditEntry({ id:'audit-2', action:'update', recordId:'edition-1', createdAt:'bad' })).toThrow('invalid_audit_created_at');
  });
});
