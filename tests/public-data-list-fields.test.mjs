// 公开列表只返回卡片要用的字段（publicData/listFields.js）。
// 背景：小程序调云函数，返回不能超过 1MB（腾讯云开发错误码 EXCEED_MAX_RESPONSE_SIZE）；全部比赛带上全部字段是 1.21MB，超限后要退回美国服务器。
import Module, { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';
import { hydratePublic } from '../apps/miniprogram/services/publicRecord';

const require = createRequire(import.meta.url);
const { toPublicCache } = require('../apps/miniprogram/cloudfunctions/adminData/publicCache.js');
const { LIST_FIELDS, toListItem, slimList } = require('../apps/miniprogram/cloudfunctions/publicData/listFields.js');

// 与 tests/public-cache.test.mjs 同形状的可发布记录，经过真正的 toPublicCache 变成公开缓存里的样子
const publishable = {
  id:'edition-1', eventId:'event-1', name:'全国大学生计算机设计竞赛', editionName:'第十九届', editionYear:'2026', editionOrdinal:'第十九届',
  aliases:['测试杯'], organizer:'测试组委会', eventLevel:'国家级', professions:['计算机与AI'], objectiveTags:['创新'],
  participants:'全日制在校本科生'.repeat(20), eligibility:'须具有学籍'.repeat(30), formatAndRules:'分初赛、复赛、决赛三轮。'.repeat(60),
  teamSize:'2到3人', registrationMethod:'在官网注册并提交报名表'.repeat(10), fees:'免费',
  participationFormat:'团队赛', teamSizeCategory:'2～3人', feeType:'免费', registrationOrganization:'自行报名', registrationUrl:'https://example.com/register',
  schedule:{ registration_start:'2026-08-01T00:00:00.000Z', registration_end:'2026-09-30T00:00:00.000Z', status_override:null, time_note:'各赛区时间不同'.repeat(20) },
  recommendation:{ recommendation:'值得参加', reasons:['官方资料完整', '往届规模大'], suitable_for:'适合计算机专业', preparation:'提前组队'.repeat(20) },
  lastVerifiedAt:'2026-08-30T00:00:00.000Z',
  sources:[{ id:'source-1', source_type:'authority_notice', is_official:true, validity_status:'valid', url:'https://example.com/notice',
    last_verified_at:'2026-08-30T00:00:00Z', title:'正式通知', content_summary:'说明当届赛事和报名安排', evidence_excerpt:'报名时间为2026年8月1日至9月30日',
    supports_fields:['赛事名称', '届次', '报名开始时间'], review_reason:'人工已核对主办方当届通知' }],
  dataStatus:'published', systemValidation:'passed', manualReview:'passed',
};
const NOW = new Date('2026-08-31T00:00:00.000Z');
const published = toPublicCache(publishable, NOW);
const archived = toPublicCache({ ...publishable, id:'edition-2', name:'某往届大赛', dataStatus:'archived', nextEditionEstimate:'2027-03-01T00:00:00.000Z', archivedAt:'2026-10-01T00:00:00.000Z' }, NOW);

describe('toListItem', () => {
  it('清单里的每个字段在真实的公开缓存记录里都存在（改名会被这条测试发现）', () => {
    for (const key of LIST_FIELDS) expect(Object.keys(published), `缺字段 ${key}`).toContain(key);
  });

  it('只留清单里的字段，长文本都不带', () => {
    const item = toListItem(published);
    expect(Object.keys(item).sort()).toEqual([...LIST_FIELDS].sort());
    for (const dropped of ['format_and_rules', 'eligibility', 'participants', 'sources', 'registration_url', 'search_text', 'registration_method', 'time_note', 'value_scores', 'rewards', '_id']) {
      expect(item).not.toHaveProperty(dropped);
    }
    expect(item).toMatchObject({ id:'edition-1', name:'全国大学生计算机设计竞赛', professions:['计算机与AI'], recommendation:'值得参加', data_status:'published' });
  });

  it('记录里没有的字段不凭空出现；null 和空串原样保留（卡片靠它判断有没有日期）', () => {
    const item = toListItem({ id:'a', name:'b', registration_end:null, registration_end_note:'' });
    expect(item).toEqual({ id:'a', name:'b', registration_end:null, registration_end_note:'' });
  });

  it('已归档记录带着下一届估算时间', () => {
    expect(toListItem(archived)).toMatchObject({ data_status:'archived' });
    expect(toListItem(archived).next_edition_estimate).toBeTruthy();
  });
});

describe('slimList', () => {
  it('total / hasMore / preview 原样保留，只换 items', () => {
    const result = slimList({ items:[published], total:325, hasMore:true, preview:false });
    expect(result).toMatchObject({ total:325, hasMore:true, preview:false });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty('format_and_rules');
  });
  it('没有 items 也不报错', () => {
    expect(slimList({ total:0, hasMore:false })).toEqual({ total:0, hasMore:false, items:[] });
  });
});

describe('瘦身后的体积', () => {
  it('500 条（公开比赛的上限）完整记录超过 1MB，瘦身后远低于 1MB', () => {
    const many = Array.from({ length:500 }, (_, index) => ({ ...published, id:`edition-${index}`, _id:`edition-${index}` }));
    const full = Buffer.byteLength(JSON.stringify({ ok:true, data:{ items:many, total:500, hasMore:false } }));
    const slim = Buffer.byteLength(JSON.stringify({ ok:true, data:slimList({ items:many, total:500, hasMore:false }) }));
    expect(full).toBeGreaterThan(1048576);
    expect(slim).toBeLessThan(1048576 * 0.5);
  });
});

// 历史版本的首页卡片读过的字段（10 月 1 日以来各版本 index.wxml 的并集 + 本地筛选用的 professions、region）。
// 瘦身前后，当前字段转换代码给出的这些值必须完全一致。
const CARD_FIELDS = ['id', 'name', 'editionName', 'editionYear', 'editionOrdinal', 'eventLevel', 'displayProfessions', 'professions', 'region',
  'registrationStatus', 'statusClass', 'registrationEndDate', 'registrationEndNote', 'recommendationLevel', 'recommendationReasons',
  'dataStatus', 'nextEditionEstimateDate', 'lastVerifiedDate'];
const cardOf = item => Object.fromEntries(CARD_FIELDS.map(key => [key, hydratePublic(item)[key]]));

describe('小程序卡片显示不受影响', () => {
  it('已发布、已归档、缺日期、缺推荐的记录，瘦身前后卡片字段完全一致', () => {
    const samples = [
      published, archived,
      toPublicCache({ ...publishable, id:'edition-3', schedule:{ registration_start:'2026-08-01T00:00:00.000Z', registration_end:null, registration_end_note:'各赛项不同，见时间说明' } }, NOW),
      toPublicCache({ ...publishable, id:'edition-4', recommendation:{ recommendation:'信息不足', reasons:[] } }, NOW),
    ];
    for (const sample of samples) expect(cardOf(toListItem(sample))).toEqual(cardOf(sample));
  });
});

// ---- 云函数入口：list 瘦身，get 仍是完整记录 ----
const records = [published, archived].map(record => ({ ...record, _id:record.id }));
const fakeDb = {
  command:{ in:value => value, inc:value => value },
  collection:name => ({
    where:() => ({ limit:() => ({ get:async () => ({ data:records }) }) }),
    doc:id => ({
      get:async () => ({ data:records.find(item => item.id === id) || null }),
      update:async () => ({ stats:{ updated:1 } }),
      set:async () => undefined,
    }),
  }),
  createCollection:async () => undefined,
};
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  return request === 'wx-server-sdk' ? { init:() => undefined, DYNAMIC_CURRENT_ENV:'test', database:() => fakeDb } : originalLoad.call(this, request, ...rest);
};
const { main } = require('../apps/miniprogram/cloudfunctions/publicData/index.js');
afterAll(() => { Module._load = originalLoad; });

describe('publicData 云函数入口', () => {
  it('list 只返回清单里的字段，total 与筛选结果不变', async () => {
    const result = await main({ action:'list', query:{} });
    expect(result.ok).toBe(true);
    expect(result.data.total).toBe(2);
    // 2026-10-24 起列表统一走新流程，卡片多带一个 list_group
    for (const item of result.data.items) expect(Object.keys(item).every(key => key === 'list_group' || LIST_FIELDS.includes(key))).toBe(true);
    expect(result.data.items.map(item => item.id).sort()).toEqual(['edition-1', 'edition-2']);
  });

  it('list 的筛选照常按完整字段做（按搜索文本、专业筛选），只是返回时才瘦身', async () => {
    const byKeyword = await main({ action:'list', query:{ keyword:'某往届大赛' } });
    expect(byKeyword.data.items.map(item => item.id)).toEqual(['edition-2']);
    const byProfession = await main({ action:'list', query:{ profession:'计算机与AI' } });
    expect(byProfession.data.total).toBe(2);
  });

  it('get 仍返回完整记录（详情页、收藏页、提醒页用）', async () => {
    const result = await main({ action:'get', id:'edition-1' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ id:'edition-1', format_and_rules:published.format_and_rules, eligibility:published.eligibility });
    expect(result.data.sources.length).toBeGreaterThan(0);
  });
});
