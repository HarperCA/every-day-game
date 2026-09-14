import { describe, expect, it } from 'vitest';
import { classifyHttpStatus, normalizeVerifiableUrl } from '../scripts/verify_source_urls.mjs';

describe('source URL verification policy', () => {
  it('classifies transport outcomes without calling them official-source validation', () => {
    expect(classifyHttpStatus(200)).toBe('reachable');
    expect(classifyHttpStatus(302)).toBe('reachable');
    expect(classifyHttpStatus(403)).toBe('reachable_restricted');
    expect(classifyHttpStatus(404)).toBe('not_found');
    expect(classifyHttpStatus(503)).toBe('transient_failure');
  });

  it('only permits public-looking HTTP URLs without embedded credentials', () => {
    expect(normalizeVerifiableUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(() => normalizeVerifiableUrl('file:///etc/passwd')).toThrow('unsupported_url');
    expect(() => normalizeVerifiableUrl('https://user:secret@example.com/')).toThrow('unsupported_url');
    expect(() => normalizeVerifiableUrl('http://localhost/internal')).toThrow('private_target_forbidden');
  });
});
