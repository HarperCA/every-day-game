import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { assertPublicRecordCapacity, currentRegistrationStatus, filterPublicRecords, isMissingCollection, MAX_PUBLIC_RECORDS, normalizePublicRecordId } = require('../apps/miniprogram/cloudfunctions/publicData/publicQuery.js');

const base = { data_status:'published', system_validation:'passed', manual_review:'passed', registration_status:'报名中', event_level:'国家级', professions:['计算机与AI'], participation_format:'团队赛', team_size_category:'2～3人', fee_type:'免费', registration_organization:'自行报名', sort_weight:1 };

describe('public competition query', () => {
  it('rejects invalid document IDs and a silently truncated public collection', () => {
    expect(normalizePublicRecordId(' edition-1 ')).toBe('edition-1');
    expect(() => normalizePublicRecordId('../private')).toThrow('invalid_public_record_id');
    expect(() => assertPublicRecordCapacity(Array.from({ length:MAX_PUBLIC_RECORDS + 1 }))).toThrow('public_record_limit_exceeded');
  });

  it('never returns a record that misses a publication gate', () => {
    const result = filterPublicRecords([{ ...base, id:'ok', search_text:'测试' }, { ...base, id:'bad', manual_review:'pending', search_text:'测试' }], { keyword:'测试' });
    expect(result.items.map(item => item.id)).toEqual(['ok']);
    expect(result.preview).toBe(false);
  });

  it('applies all supported filters and cumulative pagination', () => {
    const records = Array.from({ length:10 }, (_, index) => ({ ...base, id:`id-${index}`, name:`赛事${index}`, search_text:`赛事${index}` }));
    const result = filterPublicRecords(records, { profession:'计算机与AI', participationFormat:'团队赛', page:2, pageSize:3 });
    expect(result.items).toHaveLength(6);
    expect(result.total).toBe(10);
    expect(result.hasMore).toBe(true);
  });

  it('refreshes time-based status when records are read', () => {
    expect(currentRegistrationStatus({ registration_start:'2026-09-10T00:00:00Z' }, new Date('2026-08-31T00:00:00Z'))).toBe('即将报名');
    expect(currentRegistrationStatus({ registration_status_override:'时间待公布', registration_start:'2026-01-01T00:00:00Z' })).toBe('时间待公布');
  });

  it('tells "collection not created yet" apart from a real database failure', () => {
    // 公开缓存集合要等第一条记录发布才会被建出来。在那之前 list 应该
    // 拿到空列表，而不是把这个当成故障抛给用户 —— 否则小程序一条都没发布时
    // 首页直接报错，而不是显示「没有匹配的比赛」。
    expect(isMissingCollection({ errCode:-502005 })).toBe(true);
    expect(isMissingCollection({ message:'DATABASE_COLLECTION_NOT_EXIST' })).toBe(true);
    expect(isMissingCollection({ message:'collection not exists' })).toBe(true);
    expect(isMissingCollection({ errCode:-1, message:'permission denied' })).toBe(false);
    expect(isMissingCollection(new Error('network timeout'))).toBe(false);
  });
});
