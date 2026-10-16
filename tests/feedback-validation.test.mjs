import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateFeedbackInput } = require('../apps/miniprogram/cloudfunctions/userData/feedbackValidation.js');

describe('feedback cloud validation', () => {
  it('normalizes a valid feedback submission', () => {
    expect(validateFeedbackInput({
      editionId:' edition-1 ', competitionName:' 测试竞赛 ', category:'time',
      content:' 报名截止时间需要复核。 ', evidenceUrl:' https://example.com/notice ',
    })).toEqual({
      editionId:'edition-1', competitionName:'测试竞赛', category:'time',
      content:'报名截止时间需要复核。', evidenceUrl:'https://example.com/notice',
    });
  });

  it('rejects invalid categories, short content and unsafe evidence URLs', () => {
    expect(() => validateFeedbackInput({ editionId:'e1', competitionName:'赛事', category:'unknown', content:'报名截止时间需要复核。' })).toThrow('invalid_category');
    expect(validateFeedbackInput({ editionId:'e1', competitionName:'赛事', category:'time', content:'错' }).content).toBe('错');
    expect(() => validateFeedbackInput({ editionId:'e1', competitionName:'赛事', category:'time', content:'  ' })).toThrow('invalid_content');
    expect(() => validateFeedbackInput({ editionId:'e1', competitionName:'赛事', category:'time', content:'报名截止时间需要复核。', evidenceUrl:'javascript:alert(1)' })).toThrow('invalid_evidence_url');
  });
});
