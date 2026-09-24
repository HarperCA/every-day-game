import { describe, expect, it } from 'vitest';
import { createCompetitionDraft, validateNewCompetition } from '../apps/admin/src/newCompetition';

describe('manual competition creation', () => {
  it('creates independent, linked, unverified drafts without invented dates', () => {
    const a = createCompetitionDraft(), b = createCompetitionDraft();
    expect(a.id).not.toBe(b.id);
    expect(a.schedule.edition_id).toBe(a.id);
    expect(a.track.edition_id).toBe(a.id);
    expect(a.dataStatus).toBe('draft');
    expect(a.systemValidation).toBe('not_run');
    expect(a.recommendation.published_cache).toBe(false);
    expect(a.lastVerifiedAt).toBeNull();
    expect(a.schedule.pending_announcement).toBe(false);
  });
  it('requires evidence and blocks duplicate editions and unsafe URLs', () => {
    const a = { ...createCompetitionDraft(), name: '大学生程序设计竞赛', editionName: '2026届', organizer: '主办高校', participants: '大学生', eligibility: '在读本科生', professions: ['计算机'], formatAndRules: '程序设计', sources: [{url: 'https://example.edu/contest'}] };
    expect(validateNewCompetition(a, [])).toEqual([]);
    expect(validateNewCompetition(a, [a])).not.toEqual([]);
    expect(validateNewCompetition({...a, sources: []}, [])).not.toEqual([]);
    expect(validateNewCompetition({...a, registrationUrl: 'javascript:alert(1)'}, [])).not.toEqual([]);
  });
});
