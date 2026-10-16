import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { registrationStatus, syncPublicCache, toPublicCache } = require('../apps/miniprogram/cloudfunctions/adminData/publicCache.js');

const publishable = {
  id:'edition-1', eventId:'event-1', name:'全国大学生计算机设计竞赛', editionName:'全国大学生计算机设计竞赛（2026）', aliases:['测试杯'], organizer:'测试组委会', eventLevel:'国家级', professions:['计算机与AI'], objectiveTags:['创新'],
  participationFormat:'团队赛', teamSizeCategory:'2～3人', feeType:'免费', registrationOrganization:'自行报名', registrationUrl:'https://example.com/register',
  schedule:{ registration_start:'2026-08-01T00:00:00.000Z', registration_end:'2026-09-30T00:00:00.000Z', status_override:null },
  recommendation:{ recommendation:'值得参加', reasons:['官方资料完整'] }, lastVerifiedAt:'2026-08-30T00:00:00.000Z',
  sources:[{ id:'source-1', source_type:'authority_notice', is_official:true, validity_status:'valid', url:'https://example.com/notice',
    last_verified_at:'2026-08-30T00:00:00Z', title:'全国大学生计算机设计竞赛正式通知', content_summary:'说明当届赛事和报名安排',
    evidence_excerpt:'报名时间为2026年8月1日至9月30日', supports_fields:['赛事名称','届次','报名开始时间'],
    review_reason:'人工已核对主办方当届通知' }],
  dataStatus:'published', systemValidation:'passed', manualReview:'passed',
};

describe('public competition cache', () => {
  it('blocks out-of-scope or unproven records even when approved or archived', () => {
    for (const name of ['上海市文化和旅游局', '“奔跑吧,少年”篮球锦标赛', '第二届新致杯创新大赛']) {
      expect(() => toPublicCache({ ...publishable, name })).toThrow('public_cache_competition_out_of_scope');
      expect(() => toPublicCache({ ...publishable, name, dataStatus:'archived' })).toThrow('public_cache_competition_out_of_scope');
    }
  });
  it('报名截止说明：没有日期时代替待公布，有日期（最晚截止）时一起显示', () => {
    const now = new Date('2026-08-31T00:00:00.000Z');
    const noEnd = { ...publishable, schedule:{ registration_start:'2026-08-01T00:00:00.000Z', registration_end:null, registration_end_note:'  各赛项不同，见时间说明  ', status_override:null } };
    expect(toPublicCache(noEnd, now)).toMatchObject({ registration_end:null, registration_end_note:'各赛项不同，见时间说明', registration_status:'报名中' });
    expect(toPublicCache({ ...publishable, schedule:{ ...publishable.schedule, registration_end_note:'最晚报名时间，各赛项不同' } }, now).registration_end_note).toBe('最晚报名时间，各赛项不同');
  });
  it('时间说明 time_note 进公开数据：去首尾空白、最多 500 字，没有时为空字符串', () => {
    const now = new Date('2026-08-31T00:00:00.000Z');
    expect(toPublicCache({ ...publishable, schedule:{ ...publishable.schedule, time_note:'  报名时间由各省赛区确定；全国总决赛预计 11 月举行  ' } }, now).time_note).toBe('报名时间由各省赛区确定；全国总决赛预计 11 月举行');
    expect(toPublicCache({ ...publishable, schedule:{ ...publishable.schedule, time_note:'长'.repeat(600) } }, now).time_note).toBe('长'.repeat(500));
    expect(toPublicCache(publishable, now).time_note).toBe('');
  });
  it('time_note 变化会触发公开缓存重写', async () => {
    const set = vi.fn(async () => undefined);
    const transaction = { collection:vi.fn(() => ({ doc:vi.fn(() => ({ set, remove:vi.fn() })) })) };
    const next = { ...publishable, schedule:{ ...publishable.schedule, time_note:'各赛道各自截止' } };
    expect(await syncPublicCache(transaction, [publishable], [next])).toEqual({ publicCachePublished:1, publicCacheRemoved:0 });
    expect(set.mock.calls[0][0].data.time_note).toBe('各赛道各自截止');
  });
  it('builds a gate-safe public document', () => {
    expect(toPublicCache({...publishable, editionYear:'2026', editionOrdinal:'第八届'}, new Date('2026-08-31T00:00:00.000Z'))).toMatchObject({
      id:'edition-1', registration_status:'报名中', data_status:'published', system_validation:'passed', manual_review:'passed', edition_year:'2026', edition_ordinal:'第八届',
    });
  });

  it('rejects records without every publish gate', () => {
    expect(() => toPublicCache({ ...publishable, systemValidation:'failed' })).toThrow('public_cache_system_validation_required');
    expect(() => toPublicCache({ ...publishable, sources:[] })).toThrow('public_cache_valid_official_source_required');
    expect(() => toPublicCache({ ...publishable, name:'2026年第八届全国大学生计算机设计竞赛' })).toThrow('public_cache_title_metadata_not_separated');
  });

  it('rejects a notice title even when other publish flags were marked passed', () => {
    expect(() => toPublicCache({ ...publishable, name:'关于举办测试竞赛的通知' })).toThrow('public_cache_notice_resolution_required');
    expect(() => toPublicCache({ ...publishable, qualityIssues:['notice_resolution_pending'] })).toThrow('public_cache_notice_resolution_required');
    expect(() => toPublicCache({ ...publishable, name:'测试竞赛报名通知' })).toThrow('public_cache_notice_resolution_required');
    expect(() => toPublicCache({ ...publishable, name:'测试竞赛报名通知', dataStatus:'archived' })).toThrow('public_cache_notice_resolution_required');
    expect(() => toPublicCache({ ...publishable, name:'测试竞赛正式启动！' })).toThrow('public_cache_notice_resolution_required');
  });

  it('does not accept a discovery notice as the only official source', () => {
    expect(() => toPublicCache({ ...publishable, sources:[{ ...publishable.sources[0], source_type:'discovery_notice' }] })).toThrow('public_cache_valid_official_source_required');
  });

  it('requires reviewed official content and rejects evidence tagged for another edition', () => {
    const source = publishable.sources[0];
    for (const field of ['title', 'content_summary', 'evidence_excerpt', 'review_reason']) {
      expect(() => toPublicCache({...publishable, sources:[{...source, [field]:''}]}))
        .toThrow('public_cache_valid_official_source_required');
    }
    for (const sourceChange of [{supports_fields:[]}, {last_verified_at:null}, {edition_id:'edition-other'}]) {
      expect(() => toPublicCache({...publishable, sources:[{...source, ...sourceChange}]}))
        .toThrow('public_cache_valid_official_source_required');
    }
  });

  it('honors a valid registration status override', () => {
    expect(registrationStatus({ schedule:{ status_override:'时间待公布' } })).toBe('时间待公布');
    expect(registrationStatus({ schedule:{ status_override:'报名中', registration_end:'2026-09-30' } }, new Date('2026-10-04T00:00:00Z'))).toBe('已截止');
    // 2026-10-10：没有报名截止日、比赛结束日已过 → 已截止（定时归档据此归档）；只是比赛开始了、还没结束 → 时间待公布
    const day = new Date('2026-10-10T04:00:00Z');
    expect(registrationStatus({ schedule:{ registration_start:'2025-12-17', competition_start:'2026-04-12', competition_end:'2026-04-12' } }, day)).toBe('已截止');
    expect(registrationStatus({ schedule:{ competition_start:'2026-09-22T00:00:00+08:00', competition_end:'2026-09-27T00:00:00+08:00' } }, day)).toBe('已截止');
    expect(registrationStatus({ schedule:{ registration_start:'2026-09-01', competition_start:'2026-09-01' } }, day)).toBe('时间待公布');
    expect(registrationStatus({ schedule:{ registration_start:'2026-09-01', competition_start:'2026-10-01', competition_end:'2026-10-31' } }, day)).toBe('时间待公布');
  });

  it('treats a passed deadline as closed even without a registration start date', () => {
    const now = new Date('2026-09-24T00:00:00.000Z');
    expect(registrationStatus({ schedule:{ registration_start:null, registration_end:'2025-03-31T23:59:59+08:00' } }, now)).toBe('已截止');
    expect(registrationStatus({ schedule:{ registration_start:null, registration_end:'2026-10-10T23:59:59+08:00' } }, now)).toBe('时间待公布');
    expect(() => registrationStatus({ schedule:{ registration_start:null, registration_end:'not-a-date' } }, now)).toThrow('invalid_public_schedule');
  });

  it('started without a unified deadline counts as open unless the competition has begun, and preserves a date-only deadline day', () => {
    // 2026-10-09 起：已开始、没有统一截止日的算报名中；比赛已开始或结束的仍是时间待公布
    expect(registrationStatus({ schedule:{registration_start:'2026-10-01'} }, new Date('2026-10-02T00:00:00Z'))).toBe('报名中');
    expect(registrationStatus({ schedule:{registration_start:'2026-09-01', competition_start:'2026-10-01'} }, new Date('2026-10-02T00:00:00Z'))).toBe('时间待公布');
    const schedule = {registration_start:'2026-10-01', registration_end:'2026-10-03'};
    expect(registrationStatus({schedule}, new Date('2026-10-03T15:59:59Z'))).toBe('报名中');
    expect(registrationStatus({schedule}, new Date('2026-10-03T16:00:00Z'))).toBe('已截止');
  });

  it('rejects an impossible or reversed registration schedule at the server publish gate', () => {
    expect(() => toPublicCache({...publishable, schedule:{registration_start:'2026-02-30', registration_end:'2026-03-01'}}))
      .toThrow('public_cache_invalid_registration_schedule');
    expect(() => toPublicCache({...publishable, schedule:{registration_start:'2026-10-04', registration_end:'2026-10-03'}}))
      .toThrow('public_cache_invalid_registration_schedule');
  });

  it('requires field-specific verified official evidence before clearing a pending deadline issue', () => {
    const pending = {...publishable, qualityIssues:['registration_end_pending']};
    expect(() => toPublicCache(pending)).toThrow('public_cache_registration_time_unverified');
    const supported = {...pending, sources:[{...publishable.sources[0], supports_fields:['报名截止时间']}]};
    expect(() => toPublicCache(supported)).not.toThrow();
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

  it('keeps legacy published records syncable, but requires evidence for a new publication or changed source identity', async () => {
    const set = vi.fn(async () => undefined);
    const transaction = { collection:vi.fn(() => ({ doc:vi.fn(() => ({ set })) })) };
    const legacy = {...publishable, sources:[{id:'source-1', source_type:'authority_notice', is_official:true, validity_status:'valid', url:'https://example.com/notice'}]};
    const updated = {...legacy, recommendation:{...legacy.recommendation, reasons:['更新了推荐说明']}};
    expect(await syncPublicCache(transaction, [legacy], [updated])).toEqual({publicCachePublished:1, publicCacheRemoved:0});
    expect(() => toPublicCache(updated)).toThrow('public_cache_valid_official_source_required');
    await expect(syncPublicCache(transaction, [{...legacy, dataStatus:'draft'}], [updated]))
      .rejects.toThrow('public_cache_valid_official_source_required');
    await expect(syncPublicCache(transaction, [legacy], [{...updated, sources:[{...legacy.sources[0], url:'https://example.com/new'}]}]))
      .rejects.toThrow('public_cache_valid_official_source_required');
    const changedFacts = [
      {...legacy, name:'全国大学生计算机设计竞赛新版'},
      {...legacy, editionName:'全国大学生计算机设计竞赛（2027）'},
      {...legacy, editionYear:'2027'},
      {...legacy, editionOrdinal:'第九届'},
      {...legacy, registrationUrl:'https://example.com/new-register'},
      {...legacy, schedule:{...legacy.schedule, registration_start:'2026-08-02T00:00:00.000Z'}},
      {...legacy, schedule:{...legacy.schedule, registration_end:'2026-10-01T00:00:00.000Z'}},
    ];
    for (const changed of changedFacts) {
      await expect(syncPublicCache(transaction, [legacy], [changed]))
        .rejects.toThrow('public_cache_valid_official_source_required');
    }
  });

  it('caches an archived record too, carrying the next-edition estimate instead of re-checking the publish gate', () => {
    const archived = { ...publishable, dataStatus:'archived', archivedAt:'2026-10-01T00:00:00.000Z', nextEditionEstimate:'2027-08-01T00:00:00.000Z', registrationUrl:'' /* 门槛字段可以已经不满足了 */ };
    const doc = toPublicCache(archived, new Date('2026-10-01T00:00:00.000Z')); // 报名截止(9-30)之后
    expect(doc).toMatchObject({ data_status:'archived', registration_status:'已截止', next_edition_estimate:'2027-08-01T00:00:00.000Z', archived_at:'2026-10-01T00:00:00.000Z' });
  });

  it('published records always carry null for the archive-only fields, keeping the doc shape consistent', () => {
    expect(toPublicCache(publishable, new Date('2026-08-31T00:00:00.000Z'))).toMatchObject({ next_edition_estimate:null, archived_at:null });
  });

  it('rejects a record claiming to be archived without actually being archived', () => {
    expect(() => toPublicCache({ ...publishable, dataStatus:'draft' })).toThrow('public_cache_requires_published_record');
  });

  // 发现时报名就已截止、直接归档入库的候选（见 intakeSchedule.js 的 archive 分支）
  // 从没被人工看过，专业标签必然是空的——这条不能拦，否则这批记录连缓存都进不去。
  it('allows an archived record with no profession tags (never human-reviewed before archiving)', () => {
    const archived = { ...publishable, dataStatus:'archived', professions:[], archivedAt:'2026-10-01T00:00:00.000Z', nextEditionEstimate:null };
    const doc = toPublicCache(archived, new Date('2026-10-01T00:00:00.000Z'));
    expect(doc.professions).toEqual([]);
  });

  it('still requires profession tags on a published record', () => {
    expect(() => toPublicCache({ ...publishable, professions:[] })).toThrow('invalid_public_cache_record');
  });

  it('keeps an archived record cached (updates, does not remove) when it transitions from published', async () => {
    const set = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const transaction = { collection:vi.fn(() => ({ doc:vi.fn(() => ({ set, remove })) })) };
    const archived = { ...publishable, dataStatus:'archived', archivedAt:'2026-09-26T00:00:00.000Z', nextEditionEstimate:'2027-08-01T00:00:00.000Z' };
    const result = await syncPublicCache(transaction, [publishable], [archived]);
    expect(result).toEqual({ publicCachePublished:1, publicCacheRemoved:0 });
    expect(set).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes a previously archived record once it drops out of the table entirely', async () => {
    const set = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const transaction = { collection:vi.fn(() => ({ doc:vi.fn(() => ({ set, remove })) })) };
    const archived = { ...publishable, dataStatus:'archived', archivedAt:'2026-09-26T00:00:00.000Z', nextEditionEstimate:'2027-08-01T00:00:00.000Z' };
    const result = await syncPublicCache(transaction, [archived], []);
    expect(result).toEqual({ publicCachePublished:0, publicCacheRemoved:1 });
    expect(remove).toHaveBeenCalledOnce();
  });
  it('persists retry metadata without revalidating unchanged legacy invalid dates', async () => {
    const set = vi.fn();
    const transaction = { collection:() => ({doc:() => ({set})}) };
    const invalid = {...publishable,schedule:{registration_start:'2026-11-01',registration_end:'2026-10-10'}};
    await expect(syncPublicCache(transaction,[invalid],[{...invalid,aiReviewFailure:{attempts:1},updatedAt:'2026-10-09'}]))
      .resolves.toEqual({publicCachePublished:0,publicCacheRemoved:0});
    expect(set).not.toHaveBeenCalled();
    await expect(syncPublicCache(transaction,[invalid],[{...invalid,registrationUrl:'https://example.com/new-register'}]))
      .rejects.toThrow('public_cache_invalid_registration_schedule');
  });

});
