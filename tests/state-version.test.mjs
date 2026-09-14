import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { nextStateVersion, normalizeStateVersion } = require('../apps/miniprogram/cloudfunctions/adminData/stateVersion.js');

describe('admin state optimistic versioning', () => {
  it('normalizes legacy documents without a version', () => {
    expect(normalizeStateVersion(undefined)).toBe(0);
    expect(nextStateVersion('competitions', undefined, 0)).toBe(1);
  });

  it('increments a matching version', () => {
    expect(nextStateVersion('competitions', 4, 4)).toBe(5);
  });

  it('rejects a stale writer with the current version', () => {
    expect(() => nextStateVersion('competitions', 5, 4)).toThrow('state_version_conflict:competitions:5');
  });

  it('rejects malformed expected versions', () => {
    expect(() => nextStateVersion('competitions', 1, -1)).toThrow('invalid_expected_version');
  });

  it('rejects callers that try to bypass locking', () => {
    expect(() => nextStateVersion('competitions', 7, undefined)).toThrow('invalid_expected_version');
  });
});
