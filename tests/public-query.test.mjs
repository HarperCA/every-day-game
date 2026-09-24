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
    // 只有截止日期的往届：截止已过是已截止，未过才是时间待公布
    expect(currentRegistrationStatus({ registration_end:'2025-03-31T23:59:59+08:00' }, new Date('2026-09-24T00:00:00Z'))).toBe('已截止');
    expect(currentRegistrationStatus({ registration_end:'2026-10-10T23:59:59+08:00' }, new Date('2026-09-24T00:00:00Z'))).toBe('时间待公布');
  });

  it('hides an archived record by default, same as anything past its deadline', () => {
    const archived = { ...base, id:'gone', data_status:'archived', registration_start:'2025-08-01T00:00:00Z', registration_end:'2025-08-20T00:00:00Z', next_edition_estimate:'2026-08-01T00:00:00Z', search_text:'x' };
    expect(filterPublicRecords([archived], {}, new Date('2026-01-01T00:00:00Z')).items).toHaveLength(0);
  });

  it('surfaces an archived record once the "距离报名时间" filter is on and its estimate falls inside the window', () => {
    const archived = { ...base, id:'gone', data_status:'archived', registration_start:'2025-08-01T00:00:00Z', registration_end:'2025-08-20T00:00:00Z', next_edition_estimate:'2026-08-01T00:00:00Z', search_text:'x' };
    const now = new Date('2026-06-01T00:00:00Z'); // 距估算日期约2个月
    expect(filterPublicRecords([archived], { registrationWithin:'3m' }, now).items.map(i => i.id)).toEqual(['gone']);
    expect(filterPublicRecords([archived], { registrationWithin:'1m' }, now).items).toHaveLength(0);
  });

  it('an upcoming (即将报名) record is also caught by the "距离报名时间" filter, using its own start date', () => {
    const upcoming = { ...base, id:'soon', registration_start:'2026-08-20T00:00:00Z', search_text:'x' };
    const now = new Date('2026-06-01T00:00:00Z'); // 距开始约2个半月
    expect(filterPublicRecords([upcoming], { registrationWithin:'3m' }, now).items.map(i => i.id)).toEqual(['soon']);
    expect(filterPublicRecords([upcoming], { registrationWithin:'1m' }, now).items).toHaveLength(0);
  });

  it('sorts by time ascending (default) or descending, unknown-date records always last', () => {
    const soon = { ...base, id:'soon', registration_start:'2026-07-01T00:00:00Z', search_text:'a' };
    const later = { ...base, id:'later', registration_start:'2026-09-01T00:00:00Z', search_text:'b' };
    const unknown = { ...base, id:'unknown', registration_start:null, search_text:'c' };
    const now = new Date('2026-06-01T00:00:00Z');
    expect(filterPublicRecords([later, unknown, soon], { sortBy:'time' }, now).items.map(i => i.id)).toEqual(['soon', 'later', 'unknown']);
    expect(filterPublicRecords([later, unknown, soon], { sortBy:'time', sortOrder:'desc' }, now).items.map(i => i.id)).toEqual(['later', 'soon', 'unknown']);
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
