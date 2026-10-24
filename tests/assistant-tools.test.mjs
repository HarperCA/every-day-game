import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { NOW, RECORDS, publicRecord } from './assistant-fixtures.mjs';
const require = createRequire(import.meta.url);
const tools = require('../apps/miniprogram/cloudfunctions/assistant/tools.js');
const { filterPublicRecords } = require('../apps/miniprogram/cloudfunctions/assistant/publicQuery.js');

describe('赛事助手：查比赛工具的参数校验', () => {
  it('合法参数原样保留', () => {
    const { query, dropped } = tools.sanitizeSearchArgs(JSON.stringify({
      professions:['计算机与AI'], participationFormats:['团队赛', '个人或团队均可'], registrationWithin:'1m', eventLevel:'国家级', sortBy:'time',
    }));
    expect(query).toEqual({ professions:['计算机与AI'], participationFormats:['团队赛', '个人或团队均可'], registrationWithin:'1m', eventLevel:'国家级', sortBy:'time' });
    expect(dropped).toEqual([]);
  });

  it('JSON 解析不了就当作不限，并记下来', () => {
    expect(tools.sanitizeSearchArgs('{professions:')).toEqual({ query:{}, dropped:['_unparseable'] });
    expect(tools.sanitizeSearchArgs('[1,2]')).toEqual({ query:{}, dropped:['_not_object'] });
  });

  it('不在白名单里的取值、多余的字段都丢掉', () => {
    const { query, dropped } = tools.sanitizeSearchArgs({ professions:['计算机与AI', '量子玄学'], eventLevel:'宇宙级', page:99, region:'火星' }, ['全国']);
    expect(query).toEqual({ professions:['计算机与AI'] });
    expect(dropped).toEqual(expect.arrayContaining(['professions', 'eventLevel', 'page', 'region']));
  });

  it('关键词最多 30 个字', () => {
    expect(tools.sanitizeSearchArgs({ keyword:'长'.repeat(40) }).query.keyword).toHaveLength(30);
  });

  it('地区只认这次比赛数据里实际出现过的值', () => {
    const regions = tools.regionsOf(RECORDS);
    expect(regions).toEqual(['全国', '国际', '浙江省']);
    expect(tools.sanitizeSearchArgs({ region:'浙江省' }, regions).query.region).toBe('浙江省');
    expect(tools.sanitizeSearchArgs({ region:'浙江' }, regions).query.region).toBeUndefined();
    const searchTool = tools.buildTools(regions)[0].function.parameters.properties;
    expect(searchTool.region.enum).toEqual(regions);
    expect(tools.buildTools([])[0].function.parameters.properties.region).toBeUndefined();
  });
});

describe('赛事助手：执行查询', () => {
  it('专业多选时任一命中即可', () => {
    const result = tools.runSearch(RECORDS, { professions:['外语与教育', '机械与自动化'] }, NOW);
    expect(result.items.map(item => item.id).sort()).toEqual(['edition-c', 'edition-d']);
  });

  it('“能组队”同时查到团队赛和个人或团队均可', () => {
    const ids = tools.runSearch(RECORDS, { participationFormats:['团队赛', '个人或团队均可'] }, NOW).items.map(item => item.id);
    expect(ids).toEqual(expect.arrayContaining(['edition-a', 'edition-b', 'edition-d']));
    expect(ids).not.toContain('edition-c');
  });

  it('其余条件交给 filterPublicRecords，结果与直接调用一致', () => {
    const viaTool = tools.runSearch(RECORDS, { eventLevel:'国家级', keyword:'计算机' }, NOW);
    const direct = filterPublicRecords(RECORDS, { eventLevel:'国家级', keyword:'计算机', page:1, pageSize:8 }, NOW);
    expect(viaTool).toEqual(direct);
  });

  it('只返回审核通过的比赛', () => {
    const ids = tools.runSearch(RECORDS, {}, NOW).items.map(item => item.id);
    expect(ids).not.toContain('edition-draft');
  });
});

describe('赛事助手：按截止日排序', () => {
  const dated = [
    publicRecord({ id:'late', name:'晚截止', registration_end:'2026-12-01', search_text:'晚截止' }),
    publicRecord({ id:'soon-iso', name:'近截止', registration_end:'2026-10-20T23:59:00+08:00', search_text:'近截止' }),
    publicRecord({ id:'mid', name:'中截止', registration_end:'2026-11-05', search_text:'中截止' }),
    publicRecord({ id:'no-end', name:'没写截止日', registration_end:null, registration_start:'2026-09-01', search_text:'没写截止日' }),
    publicRecord({ id:'closed', name:'已截止', registration_end:'2026-09-01', search_text:'已截止' }),
    publicRecord({ id:'archived', name:'已归档', data_status:'archived', registration_end:'2026-10-18', search_text:'已归档' }),
  ];

  it('还能报名的按截止日从近到远，没写截止日的在后，已截止和已归档垫底', () => {
    const result = tools.runSearch(dated, { sortBy:'deadline' }, NOW);
    const ids = result.items.map(item => item.id);
    expect(ids.slice(0, 4)).toEqual(['soon-iso', 'mid', 'late', 'no-end']);
    expect(['closed', 'archived']).toContain(ids[4]);   // 垫底的是已截止或已归档，它们之间的先后不规定
    expect(result.total).toBe(6);
    expect(result.items).toHaveLength(tools.MODEL_RESULT_LIMIT);
  });

  it('只取最前面几场给模型，总数仍是全部', () => {
    const many = Array.from({ length:30 }, (_, index) => publicRecord({ id:`r${index}`, name:`比赛${index}`, registration_end:`2026-11-${String(30 - index).padStart(2, '0')}`, search_text:`比赛${index}` }));
    const result = tools.runSearch(many, { sortBy:'deadline' }, NOW);
    expect(result.items).toHaveLength(tools.MODEL_RESULT_LIMIT);
    expect(result.total).toBe(30);
    expect(result.items.map(item => item.registration_end)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  });

  it('time 仍是原来的“离能报名多久”排序，不受影响', () => {
    const viaTool = tools.runSearch(dated, { sortBy:'time' }, NOW);
    expect(viaTool).toEqual(filterPublicRecords(dated, { sortBy:'time', page:1, pageSize:tools.MODEL_RESULT_LIMIT }, NOW));
  });

  it('deadline 是合法取值', () => {
    expect(tools.sanitizeSearchArgs({ sortBy:'deadline' }).query.sortBy).toBe('deadline');
    expect(tools.sanitizeSearchArgs({ sortBy:'随便' }).dropped).toContain('sortBy');
  });
});

describe('赛事助手：给模型看的结果和卡片', () => {
  it('给模型的结果里没有链接字段', () => {
    const compact = tools.compactForModel(tools.runSearch(RECORDS, {}, NOW));
    expect(compact.total).toBe(4);
    expect(tools.MODEL_RESULT_LIMIT).toBe(tools.CARD_LIMIT);
    expect(JSON.stringify(compact)).not.toMatch(/https?:\/\//);
    expect(compact.shown[0]).not.toHaveProperty('registration_url');
    expect(compact.shown[0]).not.toHaveProperty('sources');
  });

  // 2026-10-24：用户问“谁主办的”，原先模型拿不到主办方，只能答“库里没有”
  it('给模型的结果带主办方（最多 120 字），没有时为空字符串', () => {
    const compact = tools.compactForModel({ total:1, items:[{ id:'a', name:'比赛', organizer:'教育部高等学校计算机类专业教学指导委员会'.repeat(10) }] });
    expect(compact.shown[0].organizer).toHaveLength(120);
    expect(tools.compactForModel({ total:1, items:[{ id:'b', name:'比赛' }] }).shown[0].organizer).toBe('');
  });

  it('卡片字段齐全，剩余天数按北京时间当天结束计算', () => {
    const card = tools.toCard({ ...publicRecord(), registration_status:'报名中' }, NOW);
    expect(card).toEqual({ id:'edition-a', name:'全国大学生智能汽车竞赛', editionName:'第二十一届', eventLevel:'国家级',
      registrationStatus:'报名中', registrationEnd:'2026-10-28', registrationEndNote:'', daysLeft:13 });
    expect(tools.daysLeft('2026-10-16', NOW)).toBe(1);
    expect(tools.daysLeft(null, NOW)).toBeNull();
    expect(tools.daysLeft('2026-10-01', NOW)).toBe(0);
    // 真实数据里的截止带时间
    expect(tools.daysLeft('2026-10-30T00:00:00+08:00', NOW)).toBe(14);
    expect(tools.daysLeft('2026-10-20T23:59:00+08:00', NOW)).toBe(5);
    expect(tools.daysLeft('乱写', NOW)).toBeNull();
  });

  it('追问的选项最多 4 个、每个最多 16 个字', () => {
    const clarify = tools.sanitizeAskUser(JSON.stringify({ question:'你想找哪类？', options:['一', '二', '', '三', '四', '五', '超'.repeat(20)] }));
    expect(clarify.question).toBe('你想找哪类？');
    expect(clarify.options).toEqual(['一', '二', '三', '四']);
    expect(tools.sanitizeAskUser('坏的 JSON')).toEqual({ question:'', options:[] });
  });
});
