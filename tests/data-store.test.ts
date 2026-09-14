import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloudMocks = vi.hoisted(() => ({
  queueCloudAudit: vi.fn(),
  queueCloudRecords: vi.fn(),
}));

vi.mock('../apps/admin/src/adminCloud', () => cloudMocks);

import { replaceAdminRecordCache, resetAdminRecords } from '../apps/admin/src/dataStore';

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  cloudMocks.queueCloudAudit.mockClear();
  cloudMocks.queueCloudRecords.mockClear();
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  };
});

describe('admin data store', () => {
  it('hydrates the browser cache without writing unchanged cloud records', () => {
    const records = [{ id:'competition-1', name:'云端赛事' }];

    replaceAdminRecordCache(records);

    expect(Array.from(values.values())).toContain(JSON.stringify(records));
    expect(cloudMocks.queueCloudRecords).not.toHaveBeenCalled();
  });

  it('restores seed records locally and queues the same records for CloudBase', () => {
    const seed = [{ id: 'competition-1', name: '测试竞赛', nested: { status: 'seed' } }];

    const restored = resetAdminRecords(seed);

    expect(restored).toEqual(seed);
    expect(restored).not.toBe(seed);
    expect(Array.from(values.values())).toContain(JSON.stringify(seed));
    expect(cloudMocks.queueCloudRecords).toHaveBeenCalledOnce();
    expect(cloudMocks.queueCloudRecords).toHaveBeenCalledWith(restored, expect.objectContaining({ action:'reset', recordId:'*' }));
    expect(cloudMocks.queueCloudAudit).not.toHaveBeenCalled();
  });
});
