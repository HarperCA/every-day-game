import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { registrationStatus, syncPublicCache, toPublicCache } = require('../apps/miniprogram/cloudfunctions/adminData/publicCache.js');

const publishable = {
  id:'edition-1', eventId:'event-1', name:'测试竞赛', editionName:'测试竞赛（2026）', aliases:['测试杯'], organizer:'测试组委会', eventLevel:'国家级', professions:['计算机与AI'], objectiveTags:['创新'],
  participationFormat:'团队赛', teamSizeCategory:'2～3人', feeType:'免费', registrationOrganization:'自行报名', registrationUrl:'https://example.com/register',
  schedule:{ registration_start:'2026-08-01T00:00:00.000Z', registration_end:'2026-09-30T00:00:00.000Z', status_override:null },
  recommendation:{ recommendation:'值得参加', reasons:['官方资料完整'] }, lastVerifiedAt:'2026-08-30T00:00:00.000Z',
  sources:[{ id:'source-1', source_type:'authority_notice', is_official:true, validity_status:'valid', url:'https://example.com/notice' }],
  dataStatus:'published', systemValidation:'passed', manualReview:'passed',
};

describe('public competition cache', () => {
  it('builds a gate-safe public document', () => {
    expect(toPublicCache(publishable, new Date('2026-08-31T00:00:00.000Z'))).toMatchObject({
      id:'edition-1', registration_status:'报名中', data_status:'published', system_validation:'passed', manual_review:'passed',
    });
  });

  it('rejects records without every publish gate', () => {
    expect(() => toPublicCache({ ...publishable, systemValidation:'failed' })).toThrow('public_cache_system_validation_required');
    expect(() => toPublicCache({ ...publishable, sources:[] })).toThrow('public_cache_valid_official_source_required');
  });

  it('honors a valid registration status override', () => {
    expect(registrationStatus({ schedule:{ status_override:'时间待公布' } })).toBe('时间待公布');
  });

  it('upserts published records and removes newly offline records', async () => {
    const set = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const transaction = { collection:vi.fn(() => ({ doc:vi.fn(() => ({ set, remove })) })) };
    const result = await syncPublicCache(transaction, [publishable], [{ ...publishable, dataStatus:'offline' }]);
    expect(result).toEqual({ publicCachePublished:0, publicCacheRemoved:1 });
    expect(remove).toHaveBeenCalledOnce();
    expect(set).not.toHaveBeenCalled();
  });

  it('does not rewrite an unchanged published cache record', async () => {
    const set = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const transaction = { collection:vi.fn(() => ({ doc:vi.fn(() => ({ set, remove })) })) };
    expect(await syncPublicCache(transaction, [publishable], [structuredClone(publishable)])).toEqual({ publicCachePublished:0, publicCacheRemoved:0 });
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
