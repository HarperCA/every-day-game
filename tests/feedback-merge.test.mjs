import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { canonicalFeedbackDocumentId, mergeFeedbackRecords } = require('../apps/miniprogram/cloudfunctions/adminData/feedbackMerge.js');

describe('admin feedback bootstrap merge', () => {
  it('uses the canonical user-submission record over a stale admin snapshot', () => {
    const stored = [{ id:'feedback-1', status:'pending_ai_review', createdAt:'2026-08-30T00:00:00Z' }];
    const canonical = [{ id:'feedback-1', status:'ai_flagged', createdAt:'2026-08-30T00:00:00Z', source:'user_submission' }];

    expect(mergeFeedbackRecords(stored, canonical, 100)[0].status).toBe('ai_flagged');
  });

  it('retains admin-only development records and sorts newest first', () => {
    const stored = [{ id:'mock-1', createdAt:'2026-08-29T00:00:00Z' }];
    const canonical = [{ id:'feedback-2', createdAt:'2026-08-31T00:00:00Z' }];

    expect(mergeFeedbackRecords(stored, canonical, 100).map(item => item.id)).toEqual(['feedback-2', 'mock-1']);
  });

  it('enforces the bootstrap record bound after merging', () => {
    expect(mergeFeedbackRecords([{ id:'a' }], [{ id:'b' }], 1)).toHaveLength(1);
  });
});

describe('canonical feedback document identity', () => {
  it('writes a user submission only to its business ID', () => {
    expect(canonicalFeedbackDocumentId({ id:'feedback-1', cloudDocumentId:'feedback-1' })).toBe('feedback-1');
  });

  it('rejects a mismatched document ID', () => {
    expect(() => canonicalFeedbackDocumentId({ id:'feedback-1', cloudDocumentId:'feedback-2' })).toThrow('feedback_document_id_mismatch');
  });
});
