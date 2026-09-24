import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { archiveRecord, estimateNextEditionStart, shouldArchive } = require('../apps/miniprogram/cloudfunctions/adminData/archiveSchedule.js');
const { registrationStatus } = require('../apps/miniprogram/cloudfunctions/adminData/publicCache.js');

const NOW = new Date('2026-09-18T00:00:00.000Z');

describe('archive scheduling', () => {
  it('archives published records whose registration has closed', () => {
    const closed = { dataStatus:'published', schedule:{ registration_start:'2026-08-10T00:00:00Z', registration_end:'2026-08-26T00:00:00Z' } };
    expect(shouldArchive(closed, registrationStatus, NOW)).toBe(true);
  });

  it('leaves open or unannounced registrations alone', () => {
    const open = { dataStatus:'published', schedule:{ registration_start:'2026-09-01T00:00:00Z', registration_end:'2026-09-30T00:00:00Z' } };
    const pending = { dataStatus:'published', schedule:{} };
    expect(shouldArchive(open, registrationStatus, NOW)).toBe(false);
    expect(shouldArchive(pending, registrationStatus, NOW)).toBe(false);
  });

  it('ignores records that are not currently published', () => {
    const draft = { dataStatus:'draft', schedule:{ registration_start:'2026-08-10T00:00:00Z', registration_end:'2026-08-26T00:00:00Z' } };
    expect(shouldArchive(draft, registrationStatus, NOW)).toBe(false);
  });

  it('estimates the next edition about a year after this one started', () => {
    const record = { schedule:{ registration_start:'2026-08-10T00:00:00Z' } };
    expect(estimateNextEditionStart(record)).toBe('2027-08-10T00:00:00.000Z');
  });

  it('falls back to competition_start when registration_start is missing', () => {
    const record = { schedule:{ competition_start:'2026-09-06T00:00:00Z' } };
    expect(estimateNextEditionStart(record)).toBe('2027-09-06T00:00:00.000Z');
  });

  it('returns null when there is no date to extrapolate from', () => {
    expect(estimateNextEditionStart({ schedule:{} })).toBeNull();
    expect(estimateNextEditionStart({})).toBeNull();
  });

  it('marks the record archived with a reason and keeps its other data', () => {
    const record = { id:'x', name:'某赛事', dataStatus:'published', schedule:{ registration_start:'2026-08-10T00:00:00Z' } };
    const updated = archiveRecord(record, NOW);
    expect(updated.dataStatus).toBe('archived');
    expect(updated.archivedReason).toBe('registration_closed');
    expect(updated.archivedAt).toBe(NOW.toISOString());
    expect(updated.nextEditionEstimate).toBe('2027-08-10T00:00:00.000Z');
    expect(updated.name).toBe('某赛事'); // 原始内容不丢
  });
});
