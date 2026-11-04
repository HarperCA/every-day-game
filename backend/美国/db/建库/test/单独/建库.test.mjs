// 建库：用几条样例旧记录跑一遍 排计划 → 写进内存里的库 → 核对，覆盖合并、拆开、重复届次、规整、状态对应、不丢数据。
import { describe, expect, test } from 'vitest';
import { openDb } from '../../../index.mjs';
import { 核对 } from '../../核对.mjs';
import { 排计划 } from '../../转换.mjs';
import { 搬比赛 } from '../../搬比赛.mjs';

const 时间 = '2026-10-01T00:00:00.000Z';
const 基础 = (id, eventId, name, 其余 = {}) => ({
  id, eventId, name, editionName: `${name}（${id}）`, eventLevel: '国家级', organizer: '主办方甲', aliases: [], professions: ['计算机类'],
  participationFormat: '团队赛', teamSizeCategory: '暂未明确', registrationOrganization: '自行报名', feeType: '暂未公布',
  dataStatus: 'archived', systemValidation: 'passed', manualReview: 'passed', qualityIssues: [], updatedAt: 时间,
  schedule: { id: `schedule-${id}`, edition_id: id, track_id: null, registration_start: null, registration_end: null, competition_start: null, competition_end: null,
    pending_announcement: false, status_override: null, status_override_reason: null, time_note: '', change_status: 'normal' },
  track: { id: `track-${id}`, edition_id: id, name: '', scope_note: '' },
  sources: [{ id: `source-${id}`, edition_id: id, url: 'https://a.cn', source_type: 'organizer_website', is_official: true, validity_status: 'valid', last_verified_at: 时间 }],
  ...其余,
});

const 样例 = [
  // 同一 eventId 的两届：2025 归档、2026 已发布
  基础('ed-a-2025', 'event-a', '甲杯', { editionYear: 2025, editionOrdinal: '第一届', schedule: { ...基础('x', 'x', 'x').schedule, registration_end: '2025-09-01' } }),
  基础('ed-a-2026', 'event-a', '甲杯', { editionYear: '2026', editionOrdinal: '第二届', dataStatus: 'published', registrationUrl: '', publishedAt: '2026-09-02T00:00:00.000Z',
    aiReview: { decision: 'ok', reviewed_at: '2026-09-01T00:00:00.000Z' }, task: { attempts: 2 }, formatAndRules: '规'.repeat(5000),
    sources: [{ id: 'source-a-1', url: 'https://a.cn/n', source_type: 'organizer_notice', is_official: true, validity_status: 'valid', published_at: '2026-09' },
      { id: 'source-a-2', source_type: 'x', is_official: false, validity_status: 'unchecked' }] }),
  // 不同 eventId、同名、同一届：合并，并标出重复
  基础('ed-b-1', 'event-b1', '乙赛', { editionOrdinal: '第七届', registrationUrl: 'not a url' }),
  基础('ed-b-2', 'event-b2', ' 乙赛 ', { editionOrdinal: '第七届', dataStatus: 'draft', organizer: '主办方乙', firstSeenAt: '2026-09-15T00:00:00.000Z',
    needsManualReview: true, qualityIssues: ['报名时间待确认'], archivedReason: '无' }),
  // 借用上级编号的下级比赛：拆开
  基础('edition-c-track', 'event-a', '甲杯—赛道一', { parentEventId: 'event-a', editionYear: '2026' }),
];

describe('建库', () => {
  const 计划 = 排计划(样例, { 导出时间: '2026-10-30T00:00:00.000Z' });

  test('同一 eventId 合成一个比赛，按年份排届次；代表那届是已发布的', () => {
    const 甲 = 计划.届次们.filter(e => e.data.competition_id === 'event-a');
    expect(甲.map(e => [e.id, e.data.ordinal])).toEqual([['ed-a-2025', 1], ['ed-a-2026', 2]]);
    expect(计划.比赛们.find(c => c.id === 'event-a').data).toMatchObject({ name: '甲杯', level: '国家级', website: 'https://a.cn' });
    expect('status' in 计划.比赛们.find(c => c.id === 'event-a').data).toBe(false);
  });
  test('名称规范化后一样的合并；同一届出现两次标出来；主办方不同时届次自己记', () => {
    const 乙 = 计划.合并组们.find(g => g.编号 === 'event-b1');
    expect(乙.旧eventId们).toEqual(['event-b1', 'event-b2']);
    expect(乙.同一届重复).toEqual(['七']);
    expect(计划.编号对照['event-b2']).toBe('event-b1');
    expect(计划.届次们.find(e => e.id === 'ed-b-2').data.organizer).toBe('主办方乙');
    expect(计划.届次们.find(e => e.id === 'ed-b-1').data.organizer).toBeNull();
  });
  test('上级比赛就是自己 eventId 的：拆成独立比赛，上级指向原编号', () => {
    expect(计划.拆开们).toEqual([{ 届次: 'edition-c-track', 名称: '甲杯—赛道一', 新编号: 'event-c-track', 上级: 'event-a' }]);
    expect(计划.比赛们.find(c => c.id === 'event-c-track').data.parent_id).toBe('event-a');
  });
  test('不改意思的规整：只有日期的原样存、空字符串当没填、数字年份转文字、只到月的发布日期照存', () => {
    const e25 = 计划.届次们.find(e => e.id === 'ed-a-2025').data;
    const e26 = 计划.届次们.find(e => e.id === 'ed-a-2026').data;
    expect(e25.registration_end).toBe('2025-09-01');
    expect(e25.edition_year).toBe('2025');
    expect(e26.registration_url).toBeNull();
    expect(e26.format_and_rules).toHaveLength(5000);
    expect(计划.来源们.find(s => s.id === 'source-a-1').data.published_at).toBe('2026-09');
  });
  test('不丢：过不了校验的选填字段移进 legacy；缺必填的来源整条移进 legacy；处理记录和 task 都在', () => {
    const b1 = 计划.届次们.find(e => e.id === 'ed-b-1').data;
    expect(b1.registration_url).toBeNull();
    expect(b1.legacy.未通过校验.registration_url).toBe('not a url');
    const e26 = 计划.届次们.find(e => e.id === 'ed-a-2026').data;
    expect(e26.legacy.task).toEqual({ attempts: 2 });
    expect(e26.legacy.未搬的来源).toHaveLength(1);
    expect(计划.处理记录们.find(l => l.id === 'ed-a-2026-ai_review').data).toMatchObject({ kind: 'ai_review', at: '2026-09-01T00:00:00.000Z' });
    expect(计划.问题们.map(p => p.字段)).toEqual(expect.arrayContaining(['registration_url', 'source.url']));
  });
  test('状态：已发布、已归档照旧；草稿改成待人工审核并写明理由；状态时间取发布、归档、首次发现的时间', () => {
    const 状态 = id => 计划.届次们.find(e => e.id === id).data;
    expect(状态('ed-a-2026')).toMatchObject({ status: '已发布', status_at: '2026-09-02T00:00:00.000Z', status_reason: null });
    expect(状态('ed-a-2025')).toMatchObject({ status: '已归档', status_at: 时间 });
    expect(状态('ed-b-2')).toMatchObject({ status: '待人工审核', status_at: '2026-09-15T00:00:00.000Z', status_reason: ['旧系统的草稿，未审核'] });
  });
  test('旧的审核字段（数据状态、人工审核、待确认清单、归档原因……）原样进 legacy，不丢', () => {
    const b2 = 计划.届次们.find(e => e.id === 'ed-b-2').data;
    expect(b2.legacy).toMatchObject({ dataStatus: 'draft', needsManualReview: true, qualityIssues: ['报名时间待确认'], archivedReason: '无', firstSeenAt: '2026-09-15T00:00:00.000Z' });
    expect('data_status' in b2 || 'quality_issues' in b2).toBe(false);
  });
  test('写进库、再核对：每个有值的旧字段都找得到', () => {
    const db = openDb({ file: ':memory:' });
    const 写入 = 搬比赛(计划, db);
    expect(写入).toMatchObject({ 比赛: 3, 届次: 5 });
    const 结果 = 核对(样例, db);
    expect(结果.找不到).toEqual([]);
    expect(结果.检查了).toBeGreaterThan(50);
  });
});
