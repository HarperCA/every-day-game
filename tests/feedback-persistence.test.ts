import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloud = vi.hoisted(() => ({
  queueCloudAiJobs: vi.fn(),
  queueCloudFeedbacks: vi.fn(),
}));

vi.mock('../apps/admin/src/adminCloud', () => cloud);

import { loadFeedbacks, persistFeedbacks, type FeedbackRecord } from '../apps/admin/src/operationsStore';

const storage = new Map<string, string>();
const submitted: FeedbackRecord = {
  id:'feedback-1', editionId:'edition-1', competitionName:'测试竞赛', category:'time',
  content:'报名截止时间需要复核。', evidenceUrl:'', submitterMasked:'用户***0001',
  status:'pending_ai_review', spotCheckStatus:'not_checked', createdAt:'2026-08-20T00:00:00.000Z',
  source:'user_submission', cloudDocumentId:'feedback-1',
};

beforeEach(() => {
  storage.clear();
  cloud.queueCloudFeedbacks.mockClear();
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  };
});

describe('feedback persistence', () => {
  it('sends only changed user submissions for canonical collection sync', () => {
    storage.set('competition-admin-feedback-v2', JSON.stringify([submitted]));
    const next = [{ ...submitted, status:'accepted' as const, reviewer:'admin@example.local' }];

    persistFeedbacks(next);

    expect(loadFeedbacks()[0].status).toBe('accepted');
    expect(cloud.queueCloudFeedbacks).toHaveBeenCalledWith(next, next);
  });
});
