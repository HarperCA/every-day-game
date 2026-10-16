import { describe, expect, it } from 'vitest';
import { hasReviewedOfficialSource } from '../apps/admin/src/sourceReview';

const source = {
  id:'source-1', source_type:'organizer_notice', url:'https://contest.example/notice', is_official:true, validity_status:'valid',
  last_verified_at:'2026-10-03T10:00:00+08:00', title:'赛事正式通知',
  content_summary:'说明当届报名和参赛资格', evidence_excerpt:'面向普通高校在校生',
  supports_fields:['参赛资格'], review_reason:'主办方正式通知，可核对资格',
};

describe('manual source review', () => {
  it('requires a checked official source with content, evidence and reason', () => {
    expect(hasReviewedOfficialSource({ id:'edition-1', sources:[source] })).toBe(true);
    expect(hasReviewedOfficialSource({ sources:[{ ...source, validity_status:'unchecked' }] })).toBe(false);
    expect(hasReviewedOfficialSource({ sources:[{ ...source, review_reason:'' }] })).toBe(false);
    expect(hasReviewedOfficialSource({ sources:[{ ...source, is_official:false }] })).toBe(false);
    expect(hasReviewedOfficialSource({ id:'edition-1', sources:[{ ...source, edition_id:'edition-2' }] })).toBe(false);
  });
});
