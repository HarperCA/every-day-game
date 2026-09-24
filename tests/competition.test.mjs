import { describe, expect, it } from 'vitest';
import competition from '../packages/shared/competition.js';
const { computeRegistrationStatus, matchesQuery, sortCompetitions, listPublic, rankSearchResult } = competition;

describe('competition rules', () => {
  it('computes all four registration states without guessing a missing start', () => {
    const now = new Date('2026-08-20T00:00:00+08:00');
    expect(computeRegistrationStatus({ registration_start: null, registration_end: null }, now)).toBe('时间待公布');
    expect(computeRegistrationStatus({ registration_start: '2026-08-21T00:00:00+08:00', registration_end: '2026-08-30T00:00:00+08:00' }, now)).toBe('即将报名');
    expect(computeRegistrationStatus({ registration_start: '2026-08-01T00:00:00+08:00', registration_end: '2026-08-30T00:00:00+08:00' }, now)).toBe('报名中');
    expect(computeRegistrationStatus({ registration_start: '2026-07-01T00:00:00+08:00', registration_end: '2026-07-30T00:00:00+08:00' }, now)).toBe('已截止');
    expect(computeRegistrationStatus({ registration_start: null, registration_end: '2026-07-30T00:00:00+08:00' }, now)).toBe('已截止');
  });
  it('sorts status in the frozen order', () => {
    const items = ['已截止', '时间待公布', '报名中', '即将报名'].map((registrationStatus, i) => ({ registrationStatus, recommendation: '值得参加', qualityIssues: [], registrationEnd: null, id: i }));
    expect(sortCompetitions(items).map((item) => item.registrationStatus)).toEqual(['报名中', '即将报名', '时间待公布', '已截止']);
  });
  it('searches aliases and organizer and combines three filters', () => {
    const item = { name: '全国大学生数学建模竞赛', editionName: '2026年竞赛', organizer: '中国工业与应用数学学会', aliases: ['CUMCM'], objectiveTags: [], registrationStatus: '报名中', eventLevel: '国家级', professions: ['数学与统计'] };
    expect(matchesQuery(item, { keyword: 'CUMCM', registrationStatus: '报名中', eventLevel: '国家级', profession: '数学与统计' })).toBe(true);
    expect(matchesQuery(item, { keyword: '中国工业与应用数学学会' })).toBe(true);
    expect(matchesQuery(item, { profession: '计算机与AI' })).toBe(false);
  });
  it('combines all four additional filters without mixing participation and registration organization', () => {
    const item = { name: '示例赛事', editionName: '2026', organizer: '组委会', aliases: [], objectiveTags: [], registrationStatus: '报名中', eventLevel: '国家级', professions: ['计算机与AI'], participationFormat: '团队赛', teamSizeCategory: '2～3人', feeType: '暂未公布', registrationOrganization: '学校统一报名' };
    expect(matchesQuery(item, { keyword: '示例', participationFormat: '团队赛', teamSizeCategory: '2～3人', feeType: '暂未公布', registrationOrganization: '学校统一报名' })).toBe(true);
    expect(matchesQuery(item, { participationFormat: '学校统一报名' })).toBe(false);
    expect(matchesQuery(item, { registrationOrganization: '团队赛' })).toBe(false);
  });
  it('returns only fully published records in production', () => {
    const valid = { dataStatus: 'published', systemValidation: 'passed', manualReview: 'passed' };
    expect(listPublic([valid, { ...valid, manualReview: 'pending' }, { ...valid, dataStatus: 'pending_manual_review' }])).toEqual([valid]);
  });
  it('ranks exact names and aliases before organizer-only matches', () => {
    const exact = { name: '蓝桥杯', aliases: [], organizer: '组委会' };
    const alias = { name: '蓝桥杯全国大学生软件和信息技术大赛', aliases: ['蓝桥杯'], organizer: '工业和信息化部人才交流中心' };
    const organizer = { name: '其他赛事', aliases: [], organizer: '蓝桥杯组委会' };
    expect(rankSearchResult(exact, '蓝桥杯')).toBeLessThan(rankSearchResult(alias, '蓝桥杯'));
    expect(rankSearchResult(alias, '蓝桥杯')).toBeLessThan(rankSearchResult(organizer, '蓝桥杯'));
  });
});
