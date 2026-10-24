// 新版首页列表（listVersion 2）：服务器筛选、分组、分档、排序、分页（2026-10-24）
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { buildPublicList, listGroup, personalizePage, publicQueryKey, isListV2 } = require('../apps/miniprogram/cloudfunctions/publicData/listOrder.js');
const { matchesCompetitionPreferences } = require('../apps/miniprogram/cloudfunctions/publicData/preferenceMatch.js');
const { filterPublicRecords } = require('../apps/miniprogram/cloudfunctions/publicData/publicQuery.js');
const { slimListV2, LIST_FIELDS } = require('../apps/miniprogram/cloudfunctions/publicData/listFields.js');

const NOW = new Date('2026-10-24T04:00:00Z'); // 北京时间 10-24 12:00
const base = { data_status:'published', system_validation:'passed', manual_review:'passed', event_level:'国家级', professions:['计算机与AI'],
  participation_format:'团队赛', team_size_category:'2～3人', fee_type:'免费', registration_organization:'自行报名', sort_weight:1 };
const rec = (id: string, over: Record<string, any> = {}) => ({ ...base, id, event_id:`event-${id}`, name:`比赛${id}`, search_text:`比赛${id}`, ...over });
const ids = (result: any) => result.items.map((item: any) => item.id);

// 报名中（截止不同）、时间待公布、比赛中、比赛已结束各若干
const records = [
  rec('open-late', { registration_start:'2026-10-01', registration_end:'2026-11-30' }),
  rec('open-soon', { registration_start:'2026-10-01', registration_end:'2026-10-26' }),
  rec('open-nodl', { registration_start:'2026-10-01', competition_start:'2026-12-01' }),
  rec('tbd', { }),
  rec('upcoming', { registration_start:'2026-11-05', registration_end:'2026-11-20' }),
  rec('running', { registration_start:'2026-09-01', registration_end:'2026-10-10', competition_end:'2026-11-15' }),
  rec('ended-recent', { registration_start:'2026-08-01', registration_end:'2026-10-01', competition_end:'2026-10-20' }),
  rec('ended-old', { registration_start:'2026-03-01', registration_end:'2026-04-01', competition_end:'2026-05-01' }),
];

describe('新版列表：分组和公共顺序', () => {
  it('四个分组依次排列，组内按截止日；已过截止日的离今天越近越靠前', () => {
    const list = buildPublicList(records, { listVersion:2 }, NOW);
    expect(list.items.map((item: any) => [item.id, item.list_group])).toEqual([
      ['open-soon', '报名中'], ['open-late', '报名中'], ['open-nodl', '报名中'],
      ['upcoming', '时间待公布'], ['tbd', '时间待公布'],
      ['running', '比赛中'],
      ['ended-recent', '比赛已结束'], ['ended-old', '比赛已结束'],
    ]);
  });
  it('报名截止后、比赛还没开始也算比赛中；没有比赛结束日的算比赛已结束', () => {
    const item = (over: any) => ({ registration_status:'已截止', ...over });
    expect(listGroup(item({ competition_end:'2026-10-24' }), NOW)).toBe('比赛中');
    expect(listGroup(item({ competition_end:'2026-10-23' }), NOW)).toBe('比赛已结束');
    expect(listGroup(item({}), NOW)).toBe('比赛已结束');
  });
  it('截止日相同时按综合分（推荐分高的在前）', () => {
    const same = [rec('low', { registration_start:'2026-10-01', registration_end:'2026-11-01', recommendation:'信息不足' }),
      rec('high', { registration_start:'2026-10-01', registration_end:'2026-11-01', recommendation:'强烈推荐', recommendation_score:95, scale_tier:'10万以上' })];
    expect(ids(buildPublicList(same, { listVersion:2 }, NOW))).toEqual(['high', 'low']);
  });
});

describe('新版列表：组内分档', () => {
  const list = buildPublicList(records, { listVersion:2 }, NOW);
  it('收藏且有提醒 → 只收藏 → 只提醒 → 其他，只在本组内挪动', () => {
    const page = personalizePage(list, { listVersion:2, favoriteIds:['open-late', 'open-nodl', 'ended-old'], reminderIds:['open-nodl', 'tbd'], page:1, pageSize:20 });
    expect(ids(page)).toEqual(['open-nodl', 'open-late', 'open-soon', 'tbd', 'upcoming', 'running', 'ended-old', 'ended-recent']);
  });
  it('收藏可以按比赛编号（event_id）对上', () => {
    const page = personalizePage(list, { favoriteIds:['event-open-late'], pageSize:3 });
    expect(ids(page)).toEqual(['open-late', 'open-soon', 'open-nodl']);
  });
  it('不改缓存的公共列表，下一个人看到的还是原来的顺序', () => {
    const before = ids(list);
    personalizePage(list, { favoriteIds:['ended-old'] });
    expect(ids(list)).toEqual(before);
    expect(ids(personalizePage(list, { pageSize:20 }))).toEqual(before);
  });
  it('收藏、提醒的比赛不符合筛选条件就不显示', () => {
    const filtered = buildPublicList([...records, rec('other', { professions:['设计与艺术'], registration_start:'2026-10-01', registration_end:'2026-11-01' })], { listVersion:2, categories:['计算机与AI'] }, NOW);
    expect(ids(personalizePage(filtered, { favoriteIds:['other'], pageSize:20 }))).not.toContain('other');
  });
  it('编号格式不对、超过 200 个的部分直接忽略', () => {
    const page = personalizePage(list, { favoriteIds:['../x', { $ne:1 }, ...Array.from({ length:300 }, (_, i) => `f${i}`), 'ended-old'] });
    expect(ids(page)[0]).toBe('open-soon');
  });
  it('分页是累计的：第 2 页返回前 2×pageSize 条', () => {
    const page = personalizePage(list, { page:2, pageSize:3 });
    expect(page.items).toHaveLength(6);
    expect(page).toMatchObject({ total:8, hasMore:true, listVersion:2 });
  });
});

describe('新版列表：筛选和搜索', () => {
  const pool = [
    rec('cs-gd', { professions:['计算机与AI'], region:'广东', registration_start:'2026-10-01', registration_end:'2026-11-01' }),
    rec('cs-all', { professions:['计算机与AI'], region:'全国', registration_start:'2026-10-01', registration_end:'2026-11-02' }),
    rec('any', { professions:['综合/不限专业'], registration_start:'2026-10-01', registration_end:'2026-11-03' }),
    rec('art-bj', { professions:['设计与艺术'], region:'北京', registration_start:'2026-10-01', registration_end:'2026-11-04' }),
    rec('art-hn', { professions:['设计与艺术'], region:'华南', registration_start:'2026-10-01', registration_end:'2026-11-05' }),
    rec('name-only', { name:'计算机设计大赛', search_text:'计算机设计大赛', professions:['设计与艺术'], registration_start:'2026-10-01', registration_end:'2026-11-06' }),
  ];
  it('按专业大类和省份筛：综合/不限专业都算；广东认华南和全国类', () => {
    expect(ids(buildPublicList(pool, { categories:['计算机与AI'] }, NOW))).toEqual(['cs-gd', 'cs-all', 'any']);
    // name-only 没填地区，按规则没有明确地区限制的继续显示
    expect(ids(buildPublicList(pool, { province:'广东省' }, NOW))).toEqual(['cs-gd', 'cs-all', 'any', 'art-hn', 'name-only']);
  });
  it('其余面板条件照旧生效', () => {
    expect(ids(buildPublicList([...pool, rec('x', { event_level:'省级/区域级' })], { eventLevel:'省级/区域级' }, NOW))).toEqual(['x']);
  });
  it('搜索：映射出的专业大类拿来筛，名称里有关键词但专业不对的被筛掉，并返回映射条件', () => {
    const list = buildPublicList(pool, { keyword:'计算机', categories:['设计与艺术'] }, NOW);
    expect(list.appliedFilters.categories).toContain('计算机与AI');
    expect(ids(list)).not.toContain('name-only');
    expect(ids(list)).not.toContain('art-bj');
    expect(ids(list)).toEqual(expect.arrayContaining(['cs-gd', 'cs-all', 'any']));
  });
  it('搜索：名称命中的整块在前，只是专业对得上的在后', () => {
    const named = [...pool, rec('cs-named', { name:'计算机博弈大赛', search_text:'计算机博弈大赛', registration_start:'2026-10-01', registration_end:'2026-12-30' })];
    const list = buildPublicList(named, { keyword:'计算机' }, NOW);
    expect(ids(list)[0]).toBe('cs-named');
  });
  it('关键词映射不出专业时，只按名称搜', () => {
    expect(ids(buildPublicList(pool, { keyword:'设计大赛' }, NOW))).toEqual(['name-only']);
  });
  it('不合格的记录（没过审核）不会出现', () => {
    expect(ids(buildPublicList([rec('bad', { manual_review:'pending' })], {}, NOW))).toEqual([]);
  });
});

describe('新版列表：接口形状和兼容', () => {
  it('只有 listVersion 为 2 才走新流程', () => {
    expect(isListV2({ listVersion:2 })).toBe(true);
    expect(isListV2({ listVersion:'2' })).toBe(false);
    expect(isListV2({})).toBe(false);
  });
  it('缓存键不含收藏、提醒编号和页码', () => {
    expect(publicQueryKey({ listVersion:2, categories:['a'], favoriteIds:['x'], reminderIds:['y'], page:3, pageSize:8 }))
      .toBe(publicQueryKey({ listVersion:2, categories:['a'] }));
  });
  it('返回给手机的卡片只有原来的字段加 list_group，不带内部字段', () => {
    const page = slimListV2(personalizePage(buildPublicList(records, {}, NOW), { pageSize:2 }));
    for (const item of page.items) expect(Object.keys(item).every(key => key === 'list_group' || LIST_FIELDS.includes(key))).toBe(true);
    expect(page.items[0].list_group).toBe('报名中');
  });
  it('旧流程（不带 listVersion）结果不变', () => {
    const old = filterPublicRecords(records, { pageSize:20 }, NOW);
    expect(old.items.every((item: any) => item.list_group === undefined)).toBe(true);
    expect(old.total).toBe(8);
  });
});

describe('偏好筛选和手机端规则一致', () => {
  it('同一批样例，服务器模块和手机端 matchesCompetitionPreferences 结果完全一样', async () => {
    vi.stubGlobal('wx', { getStorageSync:() => '', setStorageSync:() => {}, cloud:{ init:() => {}, callFunction:async () => ({}) } });
    const client = await import('../apps/miniprogram/services/competitionPreferences');
    const regions = ['', '全国', '不限', '国际', '广东', '广东省', '华南', '北京', '东北', '江苏、浙江', '待核实'];
    const professionSets = [[], ['计算机与AI'], ['综合/不限专业'], ['设计与艺术', '经管与商科']];
    const choices = [[[], ''], [['计算机与AI'], ''], [[], '广东省'], [[], '全国'], [['设计与艺术'], '黑龙江省'], [['经管与商科', '计算机与AI'], '上海市'], [[], '广西壮族自治区']];
    for (const region of regions) for (const professions of professionSets) for (const [categories, province] of choices) {
      const item = { region, professions };
      expect(matchesCompetitionPreferences(item, categories, province), JSON.stringify({ item, categories, province }))
        .toBe(client.matchesCompetitionPreferences(item, categories as string[], province as string));
    }
    vi.unstubAllGlobals();
  });
});

// 首页状态标签：报名中 / 未开始 / 已截止（2026-10-24）
describe('新版列表：按状态分组筛', () => {
  it('listGroups 只留指定的分组；未开始含即将报名，已截止含比赛中和比赛已结束', () => {
    const pick = (listGroups: any) => ids(buildPublicList(records, { listVersion:2, listGroups }, NOW));
    expect(pick(['报名中'])).toEqual(['open-soon', 'open-late', 'open-nodl']);
    expect(pick(['时间待公布'])).toEqual(['upcoming', 'tbd']);
    expect(pick(['比赛中', '比赛已结束'])).toEqual(['running', 'ended-recent', 'ended-old']);
  });
  it('不带、为空或只有不认识的分组时不筛', () => {
    const all = ids(buildPublicList(records, { listVersion:2 }, NOW));
    expect(ids(buildPublicList(records, { listVersion:2, listGroups:[] }, NOW))).toEqual(all);
    expect(ids(buildPublicList(records, { listVersion:2, listGroups:['乱写'] }, NOW))).toEqual(all);
    expect(ids(buildPublicList(records, { listVersion:2, listGroups:'报名中' }, NOW))).toEqual(all);
  });
  it('分组不同，缓存键也不同', () => {
    expect(publicQueryKey({ listVersion:2, listGroups:['报名中'] })).not.toBe(publicQueryKey({ listVersion:2, listGroups:['时间待公布'] }));
  });
});
