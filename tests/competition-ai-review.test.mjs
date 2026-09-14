import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compactRecord, htmlToText, validateResult } = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');

describe('competition AI review', () => {
  it('strips scripts and tags from evidence pages', () => {
    expect(htmlToText('<style>x</style><h1>报名通知</h1><script>bad()</script>')).toBe('报名通知');
  });

  it('keeps source provenance in the review input', () => {
    const input = compactRecord({ id:'e1', sources:[{ url:'https://example.com', is_official:true, validity_status:'unchecked' }] });
    expect(input.sources[0]).toEqual(expect.objectContaining({ claimed_official:true, current_validity:'unchecked' }));
  });

  it('never accepts a model claim that it published a record', () => {
    expect(() => validateResult({ decision:'published', risk_level:'low', summary:'模型已经发布赛事', issues:[], evidence_refs:[] })).toThrow('ai_review_invalid_decision');
  });
});
