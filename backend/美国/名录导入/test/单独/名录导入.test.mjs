// 名录导入：把 2026-10-26 复判的“可以入库”写进比赛库，全部待人工审核。用内存里的库跑，不碰线上。
import { describe, expect, test } from 'vitest';
import { openDb } from '../../../db/index.mjs';
import { 解析CSV, 排计划, 排补充计划, 写入, 撤回, 转归档 } from '../../index.mjs';

const at = '2026-11-04T16:00:00.000Z';
const 批次 = '名录导入-20261104';

const 行 = (源行号, name, 其余 = {}) => ({
  源行号: String(源行号), '源：比赛名': name, 最终分类: '可以入库', 结论类型: '历史届草稿（该届已结束）', 结论原因: '官方通知确认', 关联记录: '',
  name, aliases: '', editionName: `第三届${name}`, editionYear: '2025', editionOrdinal: '3', organizer: '某协会', eventLevel: '国家级', region: '',
  participants: '本科生', eligibility: '在校大学生', formatAndRules: '作品赛', professions: '计算机与AI；电子信息', 原专业表述: '软件工程', objectiveTags: '编程；算法',
  teamSize: '3人', participationFormat: '团队赛', teamSizeCategory: '2～3人', registrationMethod: '官网报名', registrationOrganization: '自行报名',
  registrationUrl: 'https://reg.example.cn/1', discoveryNoticeUrl: '', fees: '', feeType: '暂未公布',
  'schedule.registration_start': '2025-03-01', 'schedule.registration_end': '2025-04-01', 'schedule.competition_start': '', 'schedule.competition_end': '',
  'schedule.pending_announcement': '否', 'schedule.time_note': '', 'track.name': '', 'track.scope_note': '', rewards: '', rewardAmount: '', rewardTier: '', rewardHighlights: '',
  participantCount: '', participantUnit: '', participantScale: '', scaleTier: '', lifecycle: 'ended', recognition: '', qualityIssues: '缺费用', lastVerifiedAt: '2026-10-17',
  官方来源: `甲协会通知 | https://a.example.cn/${源行号} | 类型 未标 | 官方 | 状态 valid | 核验 2026-10-17\n转载 | https://b.example.cn/${源行号} | 类型 转载 | 非官方 | 状态 自由文字 | 核验 未记`,
  证据摘录: `[organizer] 摘录：某协会主办 （https://a.example.cn/${源行号}）`,
  尚缺发布字段: '报名入口 registrationUrl', 缺项与已查来源: '缺费用', 纠正记录: '', 备注: '备注内容', ...其余,
});
const 核查 = (源行号, 核查结论 = '核实', 其余 = {}) => ({ 源行号: String(源行号), 核查结论, 打不开的网址: '', ...其余 });
const 排 = (行们, 核查们, 现有 = []) => 排计划({ 行们, 核查们, 现有比赛们: 现有, 批次, at });

describe('解析CSV', () => {
  test('支持带引号、引号转义和单元格里换行', () => {
    expect(解析CSV('﻿a,b\n"1,2","x""y\nz"\n')).toEqual([{ a: '1,2', b: 'x"y\nz' }]);
  });
});

describe('排计划：挑哪些', () => {
  test('只要 可以入库 且 核实、大部分核实 的，其余写明原因', () => {
    const 计划 = 排(
      [行(1, '甲杯'), 行(2, '乙杯'), 行(3, '丙杯'), 行(4, '丁杯'), 行(5, '戊杯', { 最终分类: '未完成' }), 行(6, '己杯')],
      [核查(1), 核查(2, '大部分核实'), 核查(3, '名称对不上'), 核查(4, '来源全部打不开'), 核查(5)],
    );
    expect(计划.届次们.map(e => e.data.legacy.名录导入.源行号)).toEqual(['1', '2']);
    expect(计划.跳过.map(x => [x.源行号, x.原因])).toEqual([
      ['3', '核查结论：名称对不上'], ['4', '核查结论：来源全部打不开'], ['5', '不在可以入库清单'], ['6', '没有核查结果'],
    ]);
  });
  test('第 74、1319 行单独排除', () => {
    const 计划 = 排([行(74, '甲杯'), 行(1319, '乙杯')], [核查(74), 核查(1319)]);
    expect(计划.届次们).toEqual([]);
    expect(计划.跳过.map(x => x.源行号)).toEqual(['74', '1319']);
  });
  test('名称或别名规范化后和库里比赛一样的不新建', () => {
    const 现有 = [{ id: 'event-a', name: '全国甲竞赛', aliases: ['乙杯'] }];
    const 计划 = 排([行(1, '2026年第三届全国甲大赛'), 行(2, '丙杯', { aliases: '乙杯' }), 行(3, '丁杯')], [核查(1), 核查(2), 核查(3)], 现有);
    expect(计划.届次们.map(e => e.data.legacy.名录导入.源行号)).toEqual(['3']);
    expect(计划.跳过.map(x => x.原因)).toEqual(['库里已有 event-a', '库里已有 event-a']);
  });
  test('已经关联库内赛事的不新建', () => {
    const 计划 = 排([行(1, '甲杯', { 关联记录: '关联库内赛事 edition-x-2026' })], [核查(1)]);
    expect(计划.比赛们).toEqual([]);
    expect(计划.跳过[0].原因).toBe('关联库内赛事 edition-x-2026');
  });
  test('有效来源一条都没有的不入库', () => {
    const 计划 = 排([行(1, '甲杯', { 官方来源: '没有网址的一行' })], [核查(1)]);
    expect(计划.届次们).toEqual([]);
    expect(计划.跳过[0].原因).toBe('没有可用的来源网址');
  });
});

describe('排计划：同名合并', () => {
  test('同名不同年合成一个比赛的多届，按年份排顺序，比赛信息取最新一届', () => {
    const 计划 = 排(
      [行(9, '甲杯', { editionYear: '2026', organizer: '新主办', eventLevel: '省级/区域级', region: '上海' }), 行(8, '“甲杯”', { editionYear: '2024', organizer: '旧主办' })],
      [核查(8), 核查(9)],
    );
    expect(计划.比赛们).toHaveLength(1);
    expect(计划.比赛们[0].data).toMatchObject({ organizer: '新主办', level: '省级/区域级', region: '上海' });
    expect(计划.届次们.map(e => [e.data.edition_year, e.data.ordinal])).toEqual([['2024', 1], ['2026', 2]]);
    expect(new Set(计划.届次们.map(e => e.data.competition_id)).size).toBe(1);
  });
  test('同名同年算重复：留来源多的，另一条写明跳过', () => {
    const 两条来源 = 行(1, '甲杯');
    const 一条来源 = 行(2, '甲杯', { 官方来源: '通知 | https://c.example.cn/2 | 类型 未标 | 官方 | 状态 valid | 核验 未记' });
    const 计划 = 排([一条来源, 两条来源], [核查(1), 核查(2)]);
    expect(计划.届次们.map(e => e.data.legacy.名录导入.源行号)).toEqual(['1']);
    expect(计划.跳过).toEqual([{ 源行号: '2', 名称: '甲杯', 原因: '和第 1 行同名同年，留来源多的' }]);
  });
});

describe('排计划：字段', () => {
  const 一条 = 其余 => 排([行(1, '甲杯', 其余)], [核查(1, '大部分核实', { 打不开的网址: 'https://b.example.cn/1' })]);

  test('状态都是待人工审核，理由写明批次、核查结论和缺什么，原始研究放进 legacy', () => {
    const { data } = 一条().届次们[0];
    expect(data.status).toBe('待人工审核');
    expect(data.status_at).toBe(at);
    expect(data.created_by).toBe(批次);
    expect(data.status_reason.join('\n')).toContain('未经人工审核');
    expect(data.status_reason.join('\n')).toContain('大部分核实');
    expect(data.status_reason.join('\n')).toContain('报名入口');
    expect(data.legacy.名录导入).toMatchObject({ 批次, 源行号: '1', 结论原因: '官方通知确认', 备注: '备注内容', 原专业表述: '软件工程', lifecycle: 'ended' });
  });
  test('数字届次写成原文样式，时间不带时区的只留日期并把原文放进时间说明', () => {
    const { data } = 一条({ editionOrdinal: '12', 'schedule.registration_end': '2026-04-01T18:00', 'schedule.competition_start': '2026-05-01T09:00:00+08:00', 'schedule.time_note': '以通知为准' }).届次们[0];
    expect(data.edition_ordinal).toBe('第十二届');
    expect(data.registration_end).toBe('2026-04-01');
    expect(data.competition_start).toBe('2026-05-01T09:00:00+08:00');
    expect(data.time_note).toBe('以通知为准；报名截止原文：2026-04-01T18:00');
  });
  test('不在可选值里的不写，原文留在 legacy；只有国家级、国际级之外才写地区', () => {
    const 计划 = 一条({ rewardTier: '一等奖；二等奖', participantUnit: '名选手', scaleTier: '全国', rewardHighlights: '证书荣誉；随便写的', region: '全国', lifecycle: 'ended' });
    const { data } = 计划.届次们[0];
    expect(data).not.toHaveProperty('reward_tier');
    expect(data).not.toHaveProperty('participant_unit');
    expect(data).not.toHaveProperty('scale_tier');
    expect(data.reward_highlights).toEqual(['证书荣誉']);
    expect(data.legacy.名录导入.未写入).toMatchObject({ rewardTier: '一等奖；二等奖', participantUnit: '名选手', scaleTier: '全国' });
    expect(计划.比赛们[0].data).not.toHaveProperty('region');
    expect(计划.比赛们[0].data).not.toHaveProperty('lifecycle');
  });
  test('来源：官方和核验结果只认可选值，打不开的标 content_unavailable，摘录按网址对上', () => {
    const [甲, 乙] = 一条().来源们;
    expect(甲.data).toMatchObject({ url: 'https://a.example.cn/1', title: '甲协会通知', source_type: '未标', is_official: true, validity_status: 'valid', supports_fields: ['organizer'] });
    expect(甲.data.evidence_excerpt).toContain('某协会主办');
    expect(甲.data.last_verified_at).toBe('2026-10-17T00:00:00+08:00');
    expect(乙.data).toMatchObject({ url: 'https://b.example.cn/1', is_official: false, validity_status: 'content_unavailable' });
    expect(乙.data).not.toHaveProperty('last_verified_at');
  });
  test('报名入口不是网址就不写', () => {
    expect(一条({ registrationUrl: '见通知' }).届次们[0].data).not.toHaveProperty('registration_url');
  });
});

describe('转归档：只转比赛结束日已过的历史届', () => {
  const 现在 = new Date('2026-11-04T16:00:00.000Z');
  const 打开写入 = 行们 => {
    const db = openDb({ file: ':memory:' });
    写入(db, 排(行们, 行们.map(x => 核查(x.源行号))), { 批次, at });
    return db;
  };
  const 历史届 = (号, 结束日, 其余 = {}) => 行(号, `比赛${号}`, { 'schedule.competition_end': 结束日, ...其余 });

  test('结束日已过的转已归档；没结束日、结束日没到、当届、报名没截止的都不动', () => {
    const db = 打开写入([
      历史届(1, '2025-05-01'),
      历史届(2, ''),
      历史届(3, '2027-01-01'),
      历史届(4, '2025-05-01', { 结论类型: '当届合格草稿' }),
      历史届(5, '2025-05-01', { 'schedule.registration_end': '2027-01-01' }),
      历史届(6, '2026-11-05'),
    ]);
    const 结果 = 转归档(db, { 批次, at, now: 现在 });
    expect(结果.编号们).toEqual(['edition-registry-1']);
    expect(db.get('edition', 'edition-registry-1').data).toMatchObject({ status: '已归档', status_at: at, updated_by: 批次, manual_fields: ['status'] });
    expect(db.get('edition', 'edition-registry-1').data.status_reason.join('')).toContain('未逐条人工审核');
    for (const 号 of [2, 3, 4, 5, 6]) expect(db.get('edition', `edition-registry-${号}`).data.status).toBe('待人工审核');
    expect(db.find('audit_log', { action: '名录导入转归档' })[0].detail).toMatchObject({ 批次, 届次: 1, 编号们: ['edition-registry-1'] });
    db.close();
  });
  test('只写日期的结束日，按北京时间当天结束算；当天还不转', () => {
    const db = 打开写入([历史届(1, '2026-11-04'), 历史届(2, '2026-11-05')]);
    expect(转归档(db, { 批次, at, now: new Date('2026-11-04T15:59:00.000Z') }).编号们).toEqual([]);
    expect(转归档(db, { 批次, at, now: new Date('2026-11-04T16:01:00.000Z') }).编号们).toEqual(['edition-registry-1']);
    db.close();
  });
  test('人工已经改过的不动，试跑不写', () => {
    const db = 打开写入([历史届(1, '2025-05-01'), 历史届(2, '2025-05-01')]);
    db.update('edition', 'edition-registry-2', { eligibility: '人工改过' }, 1);
    expect(转归档(db, { 批次, at, now: 现在, 试跑: true }).编号们).toEqual(['edition-registry-1']);
    expect(db.get('edition', 'edition-registry-1').data.status).toBe('待人工审核');
    expect(转归档(db, { 批次, at, now: 现在 }).编号们).toEqual(['edition-registry-1']);
    expect(db.get('edition', 'edition-registry-2').data.status).toBe('待人工审核');
    db.close();
  });
});

describe('写入和撤回', () => {
  const 打开 = () => openDb({ file: ':memory:' });

  test('一个事务写完，字段都能过校验，不会被当成公开数据，再写一次会拒绝', () => {
    const db = 打开();
    const 计划 = 排([行(1, '甲杯'), 行(2, '乙杯', { editionYear: '2026' })], [核查(1), 核查(2)]);
    expect(写入(db, 计划, { 批次, at })).toEqual({ 比赛: 2, 届次: 2, 来源: 4 });
    expect(db.count('edition', { status: { in: ['已发布', '已归档'] } })).toBe(0);
    expect(db.count('edition', { status: '待人工审核' })).toBe(2);
    expect(db.find('audit_log', { action: '名录导入' })).toHaveLength(1);
    expect(() => 写入(db, 计划, { 批次, at })).toThrow('已经导入过');
    db.close();
  });
  test('中途出错整批撤回', () => {
    const db = 打开();
    const 计划 = 排([行(1, '甲杯')], [核查(1)]);
    计划.来源们[0].data.edition_id = 'edition-不存在';
    expect(() => 写入(db, 计划, { 批次, at })).toThrow();
    expect(db.count('competition')).toBe(0);
    db.close();
  });
  test('撤回只删这一批没人动过的；人工改过、发布过的留下并报告', () => {
    const db = 打开();
    const 计划 = 排([行(1, '甲杯'), 行(2, '乙杯')], [核查(1), 核查(2)]);
    写入(db, 计划, { 批次, at });
    const 乙 = 计划.届次们.find(e => e.data.legacy.名录导入.源行号 === '2');
    const 现在 = db.get('edition', 乙.id);
    db.update('edition', 乙.id, { status: '已发布' }, 现在.version);
    expect(撤回(db, { 批次, at })).toEqual({ 比赛: 1, 届次: 1, 来源: 2, 留下: [{ 编号: 乙.id, 名称: 乙.data.edition_name, 状态: '已发布' }] });
    expect(db.count('competition')).toBe(1);
    expect(db.get('edition', 乙.id).data.status).toBe('已发布');
    db.close();
  });
});

describe('补充导入（2026-11-06 用户定：GitHub 上 11-04 补查版剩下的比赛也写进库，全部待人工审核）', () => {
  const 批 = '名录导入-20261106';
  const 排补 = ({ 行们, 核查们 = [], 已导入行号 = [], 现有比赛们 = [], 现有届次们 = [], 不再收录们 = [] }) => 排补充计划({ 行们, 核查们, 已导入行号, 现有比赛们, 现有届次们, 不再收录们, 批次: 批, at });
  const 行号们 = 计划 => 计划.届次们.map(e => e.data.legacy.名录导入.源行号);

  test('已导入的、不在可以入库清单的、关联库内的不写', () => {
    const 计划 = 排补({ 行们: [行(1, '甲杯'), 行(2, '乙杯', { 最终分类: '未完成' }), 行(3, '丙杯', { 最终分类: '不能入库' }), 行(4, '丁杯', { 关联记录: '关联库内赛事 edition-x' }), 行(5, '戊杯')], 已导入行号: ['1'] });
    expect(行号们(计划)).toEqual(['5']);
    expect(计划.跳过.map(x => x.源行号)).toEqual(['2', '3', '4']);
  });
  test('来源核查没做过或没过的也写，但理由写清楚；打不开的来源标出来', () => {
    const 计划 = 排补({ 行们: [行(1, '甲杯'), 行(2, '乙杯')], 核查们: [核查(2, '来源全部打不开', { 打不开的网址: 'https://a.example.cn/2' })] });
    const [甲, 乙] = 计划.届次们;
    expect(甲.data.status).toBe('待人工审核');
    expect(甲.data.status_reason.join()).toContain('2026-11-04 补查');
    expect(甲.data.status_reason.join()).toContain('没做过来源网页核查');
    expect(乙.data.status_reason.join()).toContain('来源全部打不开');
    expect(计划.来源们.find(x => x.data.url === 'https://a.example.cn/2').data.validity_status).toBe('content_unavailable');
  });
  test('库里有这个比赛、也有这一年：不写', () => {
    const 现有比赛们 = [{ id: 'event-a', name: '甲杯', aliases: [] }];
    const 现有届次们 = [{ id: 'e1', competition_id: 'event-a', ordinal: 1, edition_year: '2025' }];
    const 计划 = 排补({ 行们: [行(1, '甲杯')], 现有比赛们, 现有届次们 });
    expect(计划.届次们).toEqual([]);
    expect(计划.跳过[0].原因).toContain('库里已有这一年');
  });
  test('跨年届次和其中一年算同一年', () => {
    const 现有比赛们 = [{ id: 'event-a', name: '甲杯', aliases: [] }];
    const 现有届次们 = [{ id: 'e1', competition_id: 'event-a', ordinal: 1, edition_year: '2025—2026' }];
    expect(排补({ 行们: [行(1, '甲杯', { editionYear: '2026' })], 现有比赛们, 现有届次们 }).届次们).toEqual([]);
  });
  test('库里有这个比赛、没有这一年：挂到已有比赛下，不新建比赛；新的排最后，旧的排最前', () => {
    const 现有比赛们 = [{ id: 'event-a', name: '甲杯', aliases: [] }];
    const 现有届次们 = [{ id: 'e1', competition_id: 'event-a', ordinal: 1, edition_year: '2024' }, { id: 'e2', competition_id: 'event-a', ordinal: 2, edition_year: '2025' }];
    const 计划 = 排补({ 行们: [行(1, '甲杯', { editionYear: '2026' }), 行(2, '甲杯', { editionYear: '2020' })], 现有比赛们, 现有届次们 });
    expect(计划.比赛们).toEqual([]);
    expect(计划.届次们.map(e => [e.data.competition_id, e.data.ordinal])).toEqual([['event-a', 3], ['event-a', 0]]);
  });
  test('回收站里的比赛、后台勾了不再收录的：不写回来', () => {
    const 计划 = 排补({ 行们: [行(1, '甲杯'), 行(2, '乙杯')], 现有比赛们: [{ id: 'event-a', name: '甲杯', aliases: [], deleted_at: at }], 不再收录们: [{ name: '乙杯', aliases: [] }] });
    expect(计划.届次们).toEqual([]);
    expect(计划.跳过.map(x => x.原因)).toEqual(['比赛在回收站 event-a', '后台勾了不再收录']);
  });
  test('清单里同一个新比赛多年：一个比赛多届，按年份排；同年只留一条', () => {
    const 计划 = 排补({ 行们: [行(1, '甲杯', { editionYear: '2026' }), 行(2, '甲杯', { editionYear: '2024' }), 行(3, '甲杯', { editionYear: '2024' })] });
    expect(计划.比赛们.map(c => c.id)).toEqual(['event-registry-1']);
    expect(计划.届次们.map(e => [e.data.legacy.名录导入.源行号, e.data.ordinal]).sort((a, b) => a[1] - b[1])).toEqual([['2', 1], ['1', 2]]);
    expect(计划.跳过.map(x => x.源行号)).toEqual(['3']);
  });
  test('写进库：全部待人工审核，已有比赛不被改；同批次不能重复写；撤回只删这一批，已有比赛和旧届次还在', () => {
    const db = openDb({ file: ':memory:', now: () => new Date(at) });
    db.insert('competition', 'event-a', { name: '甲杯', level: '国家级' });
    db.insert('edition', 'e1', { competition_id: 'event-a', ordinal: 1, edition_name: '甲杯 2024', edition_year: '2024', status: '已发布' });
    const 版本 = db.get('competition', 'event-a').version;
    const 计划 = 排补({ 行们: [行(1, '甲杯'), 行(2, '乙杯')], 现有比赛们: db.find('competition', {}), 现有届次们: db.find('edition', {}) });
    expect(写入(db, 计划, { 批次: 批, at })).toMatchObject({ 比赛: 1, 届次: 2 });
    expect(db.find('edition', { status: '待人工审核' })).toHaveLength(2);
    expect(db.get('competition', 'event-a').version).toBe(版本);
    expect(() => 写入(db, 计划, { 批次: 批, at })).toThrow('已经导入过');
    expect(撤回(db, { 批次: 批, at })).toMatchObject({ 比赛: 1, 届次: 2 });
    expect(db.get('edition', 'e1')).toBeTruthy();
    expect(db.get('competition', 'event-a')).toBeTruthy();
    expect(db.count('edition', {})).toBe(1);
    db.close();
  });
});
