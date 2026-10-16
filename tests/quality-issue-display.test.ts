import { describe, expect, it } from 'vitest';
import competitions from '../apps/admin/src/data/competitions.json';
import { displayQualityIssue, parseQualityIssueLines, qualityIssueLabels } from '../apps/admin/src/qualityIssueDisplay';

describe('admin quality issue display', () => {
  it('has a Chinese label for every imported quality and missing-information code', () => {
    const codes = new Set<string>();
    for (const record of competitions) {
      for (const code of record.qualityIssues || []) codes.add(code);
      for (const code of record.recommendation?.missing_information || []) codes.add(code);
    }
    for (const code of codes) {
      expect(qualityIssueLabels[code], code).toMatch(/[\u4e00-\u9fff]/);
      expect(displayQualityIssue(code)).toBe(`${qualityIssueLabels[code]}（${code}）`);
    }
  });

  it('renders unknown machine codes in Chinese while retaining the original code', () => {
    expect(displayQualityIssue('unmapped_future_code')).toBe('未配置中文说明，待人工核对（unmapped_future_code）');
  });

  it('round-trips displayed codes to stored values without translating original Chinese notes', () => {
    const original = ['registration_start_pending', 'edition_year_missing', '需核实主办方公告'];
    const displayed = original.map(displayQualityIssue).join('\n');
    expect(parseQualityIssueLines(displayed)).toEqual(original);
    expect(parseQualityIssueLines('报名开始时间待核实（registration_start_pending）\r\n\r\n  需核实主办方公告  '))
      .toEqual(['registration_start_pending', '需核实主办方公告']);
  });
});
