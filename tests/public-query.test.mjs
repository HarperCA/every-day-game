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

  it('shows an archived record by default, ranked after everything still open (2026-10-01)', () => {
    const archived = { ...base, id:'gone', data_status:'archived', registration_start:'2025-08-01T00:00:00Z', registration_end:'2025-08-20T00:00:00Z', next_edition_estimate:'2026-08-01T00:00:00Z', search_text:'x' };
    const open = { ...base, id:'open', data_status:'published', registration_start:'2025-12-01T00:00:00Z', registration_end:'2026-03-01T00:00:00Z', search_text:'x' };
    expect(filterPublicRecords([archived, open], {}, new Date('2026-01-01T00:00:00Z')).items.map(i => i.id)).toEqual(['open', 'gone']);
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

// 2026-10-01：搜索框输入专业名，也能找到对应专业大类的比赛
describe('按专业搜索', () => {
  const rec = (id, name, professions, extra = {}) => ({ ...base, id, name, professions, search_text:name.toLowerCase(), ...extra });
  const records = [
    rec('cs', '全国大学生软件创新大赛', ['计算机与AI']),
    rec('cs2', '某某数据竞赛', ['计算机与AI']),
    rec('civil', '全国大学生结构设计竞赛', ['建筑与土木']),
    rec('named', '计算机应用能力大赛', ['电子信息']),         // 名称里就有“计算机”，专业分类却不是计算机类
    rec('med', '全国大学生生命科学竞赛', ['生物与医药']),
    rec('closed', '往届计算机类竞赛', ['计算机与AI'], { registration_status:'已截止', data_status:'archived' }),
  ];
  const ids = query => filterPublicRecords(records, query, new Date('2026-10-01T00:00:00Z')).items.map(item => item.id);

  it('搜具体专业名：专业大类对得上的都出来，名称里直接命中的排在前面', () => {
    const result = ids({ keyword:'计算机' });
    expect(result).toContain('cs'); expect(result).toContain('cs2'); expect(result).toContain('named');
    expect(result).not.toContain('civil'); expect(result).not.toContain('med');
    expect(result[0]).toBe('named');                         // 名称里有“计算机”的先排
    expect(result[result.length - 1]).toBe('closed');         // 已截止/已归档的仍然排在最后
  });
  it('带“专业”后缀、写全称、写成句子都行', () => {
    expect(ids({ keyword:'计算机科学与技术专业' })).toEqual(expect.arrayContaining(['cs', 'cs2']));
    expect(ids({ keyword:'土木工程' })).toEqual(['civil']);
    expect(ids({ keyword:'临床医学' })).toEqual(['med']);
  });
  it('不像专业名的词，行为和原来一样（只搜名称、主办方）', () => {
    expect(ids({ keyword:'结构设计' })).toEqual(['civil']);
    expect(ids({ keyword:'不存在的词' })).toEqual([]);
  });
  it('单个字不当专业名，避免乱匹配', () => {
    expect(ids({ keyword:'法' })).toEqual([]);
  });
});

describe('专业词表', () => {
  const { majorCategories } = require('../apps/miniprogram/cloudfunctions/publicData/majorKeywords.js');
  const taxonomy = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js').PROFESSION_TAXONOMY;
  it('词表里每个大类都是库里真实存在的十三类之一', () => {
    const { MAJOR_TERMS } = require('../apps/miniprogram/cloudfunctions/publicData/majorKeywords.js');
    for (const category of Object.keys(MAJOR_TERMS)) expect(taxonomy).toContain(category);
  });
  it('两个字的词只按开头匹配、更长的词才能包含词表词，避免串类', () => {
    expect(majorCategories('设计')).toEqual(['设计与艺术']);
    expect(majorCategories('程序设计')).toEqual(['计算机与AI']);
    expect(majorCategories('机械设计')).toEqual(['机械与自动化']);
    expect(majorCategories('不限专业')).toEqual(['综合/不限专业']);
    expect(majorCategories('ai')).toEqual(['计算机与AI']);
  });
});
