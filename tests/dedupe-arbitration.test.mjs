import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { selectAmbiguous } from '../scripts/server/arbitrate-dedupe.mjs';

const require = createRequire(import.meta.url);
const { arbitrateDuplicate, buildArbitrationPrompt, decide, validateArbitration } = require('../apps/miniprogram/cloudfunctions/adminData/dedupeArbitrationAi.js');
const { syncPublicCache } = require('../apps/miniprogram/cloudfunctions/adminData/publicCache.js');

const jsonResponse = (status, body) => ({ ok:status >= 200 && status < 300, status, text:async () => JSON.stringify(body), headers:{ get:() => '' } });
const reply = content => async () => jsonResponse(200, { choices:[{ message:{ content:JSON.stringify(content) } }] });

const oldRecord = { id:'edition-old', name:'中国国际大学生创新大赛', editionName:'中国国际大学生创新大赛（2025）', editionYear:'2025', dataStatus:'archived', schedule:{ registration_end:'2025-09-01' }, sources:[] };
const item = {
  key:'https://x.example/new', candidate:{ name:'中国国际大学生创新大赛(2026)报名通知', url:'https://x.example/new', introduction:'2026 年第十二届报名开始', source:'baidu' },
  records:[oldRecord], matchReason:'标题完整包含「中国国际大学生创新大赛」',
};

describe('判重裁决：提示词', () => {
  it('把情况讲清楚：库里记录的状态、新的替代旧的、地区层级规则', () => {
    const prompt = buildArbitrationPrompt(item);
    expect(prompt).toContain('已归档');
    expect(prompt).toContain('new_edition');
    expect(prompt).toContain('新的要替代旧的');
    expect(prompt).toContain('湖南省');
    expect(prompt).toContain('中国国际大学生创新大赛(2026)报名通知');
    expect(prompt).toContain('"状态":"archived"');
  });
});

describe('判重裁决：结论处理', () => {
  it('校验字段', () => {
    expect(() => validateArbitration({ relation:'maybe', confidence:0.9, reason:'x' })).toThrow('invalid_relation');
    expect(() => validateArbitration({ relation:'new_edition', confidence:2, reason:'x' })).toThrow('invalid_confidence');
    expect(() => validateArbitration({ relation:'new_edition', confidence:0.9, reason:' ' })).toThrow('invalid_reason');
  });
  it('只有“不是同一场”“新一届”继续往下走', () => {
    expect(decide({ relation:'different_contest', confidence:0.9 }, [oldRecord]).promote).toBe(true);
    expect(decide({ relation:'new_edition', confidence:0.9 }, [oldRecord]).promote).toBe(true);
    for (const relation of ['same_edition', 'lower_level_notice', 'unclear']) expect(decide({ relation, confidence:0.95 }, [oldRecord]).promote).toBe(false);
  });
  it('把握不到 0.6 一律按看不出处理', () => {
    expect(decide({ relation:'new_edition', confidence:0.5 }, [oldRecord])).toMatchObject({ relation:'unclear', promote:false, supersedes:[] });
  });
  it('新一届只替代已归档的往届；审核中、已发布的不动', () => {
    const published = { ...oldRecord, id:'edition-pub', dataStatus:'published' };
    expect(decide({ relation:'new_edition', confidence:0.9 }, [oldRecord, published]).supersedes).toEqual(['edition-old']);
    expect(decide({ relation:'different_contest', confidence:0.9 }, [oldRecord]).supersedes).toEqual([]);
  });
});

describe('arbitrateDuplicate', () => {
  const keys = ['EXTRACT_AI_API_KEY', 'EXTRACT_AI_BASE_URL'];
  const saved = {};
  beforeEach(() => { for (const key of keys) saved[key] = process.env[key]; process.env.EXTRACT_AI_API_KEY = 'k'; process.env.EXTRACT_AI_BASE_URL = 'https://api.example.com/v1'; });
  afterEach(() => { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

  it('没配钥匙就报错，不默认任何结论', async () => {
    delete process.env.EXTRACT_AI_API_KEY;
    await expect(arbitrateDuplicate(item, () => {})).rejects.toThrow('ai_api_key_not_configured');
  });
  it('返回可执行的结论，并记下思考过程', async () => {
    const onReasoning = vi.fn();
    const request = async () => jsonResponse(200, { choices:[{ message:{ content:JSON.stringify({ relation:'new_edition', confidence:0.9, reason:'标题写明 2026，库里最新是 2025', candidate_edition:'2026' }), reasoning_content:'库里只有 2025 年已归档的记录……' } }] });
    const result = await arbitrateDuplicate(item, request, { onReasoning });
    expect(result).toMatchObject({ relation:'new_edition', promote:true, supersedes:['edition-old'], candidate_edition:'2026', prompt_version:'dedupe-arbitration-v1' });
    expect(onReasoning).toHaveBeenCalledOnce();
  });
  it('服务出错时抛错，由调用方保守跳过', async () => {
    await expect(arbitrateDuplicate(item, async () => jsonResponse(500, { error:{ message:'boom' } }))).rejects.toThrow('ai_provider_error');
  });
  it('结论格式不对时抛错', async () => {
    await expect(arbitrateDuplicate(item, reply({ relation:'???', confidence:1, reason:'x' }))).rejects.toThrow('invalid_relation');
  });
});

describe('selectAmbiguous：哪些要问 AI', () => {
  const master = { id:'m1', standard_name:'中国国际大学生创新大赛', recordIds:['edition-old'] };
  const publishedRecord = { ...oldRecord, id:'edition-cur', dataStatus:'published' };
  const recordsById = new Map([oldRecord, publishedRecord].map(record => [record.id, record]));
  const entry = (name, reason, matchedId = 'm1') => ({ candidate:{ name, detailUrl:`https://x.example/${encodeURIComponent(name)}` }, match:{ verdict:'x', matchedId, reason } });

  it('库里只有往届旧记录、标题包含赛事名 → 问 AI', () => {
    const out = selectAmbiguous({ duplicate:[entry('中国国际大学生创新大赛(2026)报名通知', '标题完整包含「中国国际大学生创新大赛」')] }, [master], recordsById);
    expect(out).toHaveLength(1);
    expect(out[0].records[0].dataStatus).toBe('archived');
  });
  it('库里有当前这一届（已发布）→ 同一届，不用问', () => {
    const current = { id:'m2', standard_name:'中国国际大学生创新大赛', recordIds:['edition-old', 'edition-cur'] };
    expect(selectAmbiguous({ duplicate:[entry('中国国际大学生创新大赛报名', '标题完整包含「中国国际大学生创新大赛」', 'm2')] }, [current], recordsById)).toHaveLength(0);
  });
  it('网址相同的确定重复、学校的校内选拔通知，都不问', () => {
    expect(selectAmbiguous({ duplicate:[entry('x', '网址相同')] }, [master], recordsById)).toHaveLength(0);
    expect(selectAmbiguous({ duplicate:[entry('某某大学关于举办创新大赛校内选拔的通知', '标题完整包含「中国国际大学生创新大赛」')] }, [master], recordsById)).toHaveLength(0);
  });
  it('拿不准、很可能重复的都问；平台来源可以不带拿不准的', () => {
    const buckets = { uncertain:[entry('某创新大赛', '相似度 0.6')], likely_duplicate:[entry('另一创新大赛', '相似度 0.85')] };
    expect(selectAmbiguous(buckets, [master], recordsById)).toHaveLength(2);
    expect(selectAmbiguous(buckets, [master], recordsById, { includeUncertain:false })).toHaveLength(1);
  });
  it('同一个标题对同一场赛事只问一次，且有上限', () => {
    const many = Array.from({ length:5 }, (_, index) => ({ candidate:{ name:'同一个标题', detailUrl:`https://x.example/${index}` }, match:{ matchedId:'m1', reason:'相似度 0.6' } }));
    const items = selectAmbiguous({ uncertain:many }, [master], recordsById);
    expect(new Set(items.map(one => `${one.candidate.name}|${one.matchedMasterId}`)).size).toBe(1);
    const lots = Array.from({ length:10 }, (_, index) => ({ candidate:{ name:`标题${index}`, detailUrl:`https://x.example/t${index}` }, match:{ matchedId:'m1', reason:'相似度 0.6' } }));
    expect(selectAmbiguous({ uncertain:lots }, [master], recordsById, { max:3 })).toHaveLength(3);
  });
});

describe('新一届替代旧的：公开缓存', () => {
  const base = {
    eventId:'event-1', name:'全国大学生计算机设计竞赛', editionName:'全国大学生计算机设计竞赛', organizer:'测试组委会', eventLevel:'国家级', professions:['计算机与AI'], objectiveTags:['创新'],
    participationFormat:'团队赛', teamSizeCategory:'2～3人', feeType:'免费', registrationOrganization:'自行报名', registrationUrl:'https://example.com/register',
    schedule:{ registration_start:'2026-08-01T00:00:00.000Z', registration_end:'2026-09-30T00:00:00.000Z', status_override:null },
    recommendation:{ recommendation:'值得参加', reasons:['官方资料完整'] }, lastVerifiedAt:'2026-08-30T00:00:00.000Z',
    sources:[{ id:'source-1', source_type:'authority_notice', is_official:true, validity_status:'valid', url:'https://example.com/notice' }],
    systemValidation:'passed', manualReview:'passed',
  };
  const oldArchived = { ...base, id:'edition-2025', dataStatus:'archived', archivedAt:'2026-01-01T00:00:00.000Z', nextEditionEstimate:null };
  const makeTx = () => { const set = vi.fn(async () => undefined); const remove = vi.fn(async () => undefined); return { set, remove, tx:{ collection:vi.fn(() => ({ doc:vi.fn(() => ({ set, remove })) })) } }; };

  it('新一届还在审核时，旧的继续显示', async () => {
    const { remove, tx } = makeTx();
    const marked = { ...oldArchived, supersededBy:'edition-2026' };
    const draft = { ...base, id:'edition-2026', dataStatus:'draft' };
    const result = await syncPublicCache(tx, [oldArchived], [marked, draft]);
    expect(result.publicCacheRemoved).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });
  it('新一届公开之后，旧的从公开缓存拿掉，新的写入', async () => {
    const { set, remove, tx } = makeTx();
    const marked = { ...oldArchived, supersededBy:'edition-2026' };
    const draft = { ...base, id:'edition-2026', dataStatus:'draft' };
    const published = { ...draft, dataStatus:'published' };
    expect(await syncPublicCache(tx, [marked, draft], [marked, published])).toEqual({ publicCachePublished:1, publicCacheRemoved:1 });
    expect(set).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });
  it('新一届被撤下（下线）后，旧的重新出现', async () => {
    const { set, tx } = makeTx();
    const marked = { ...oldArchived, supersededBy:'edition-2026' };
    const published = { ...base, id:'edition-2026', dataStatus:'published' };
    const offline = { ...published, dataStatus:'offline' };
    const result = await syncPublicCache(tx, [marked, published], [marked, offline]);
    expect(result).toEqual({ publicCachePublished:1, publicCacheRemoved:1 });
    expect(set).toHaveBeenCalledOnce();
  });
});
