// 报名状态和状态分组（《第一步：排序规则》第 ③ 条）。
// 期望值是 2026-11-01 用旧代码（publicData/publicQuery.js 的 currentRegistrationStatus、listOrder.js 的 listGroup）
// 在同样输入下算出来的结果；字段名换成新比赛库的（已归档 = status '已归档'，人工指定 = status_override）。
import { describe, expect, test } from 'vitest';
import { 分组顺序, 报名状态, 状态分组, 时刻 } from '../../index.mjs';

const now = new Date('2026-11-01T04:00:00Z');   // 北京时间 11-01 12:00

describe('时刻', () => {
  test('只写日期的按北京时间：开始算当天 0 点，截止算当天 23:59:59.999；写到时分的照原样；没填或认不出给 null', () => {
    expect(时刻('2026-11-01', '开始')).toBe(Date.parse('2026-11-01T00:00:00+08:00'));
    expect(时刻('2026-11-01', '截止')).toBe(Date.parse('2026-11-01T23:59:59.999+08:00'));
    expect(时刻('2026-11-01T11:00:00+08:00', '截止')).toBe(Date.parse('2026-11-01T03:00:00Z'));
    expect(时刻(null, '开始')).toBeNull();
    expect(时刻('下个月', '截止')).toBeNull();
  });
});

describe('报名状态（和旧代码同样输入同样结果）', () => {
  const cases = [
    ['已归档', { status: '已归档', registration_start: '2026-10-01', registration_end: '2026-12-01' }, '已截止'],
    ['截止日已过', { registration_start: '2026-09-01', registration_end: '2026-10-31' }, '已截止'],
    ['截止日是今天（只写日期，算到当天 23:59）', { registration_start: '2026-10-01', registration_end: '2026-11-01' }, '报名中'],
    ['截止时刻已过（写到时分）', { registration_start: '2026-10-01', registration_end: '2026-11-01T11:00:00+08:00' }, '已截止'],
    ['没截止日但比赛已结束', { registration_start: '2026-09-01', competition_end: '2026-10-20' }, '已截止'],
    ['人工指定已截止，截止日未到', { registration_start: '2026-10-01', registration_end: '2026-12-01', status_override: '已截止' }, '已截止'],
    ['人工指定时间待公布', { status_override: '时间待公布' }, '时间待公布'],
    ['没开始时间', { registration_end: '2026-12-01' }, '时间待公布'],
    ['还没开始报名', { registration_start: '2026-11-05', registration_end: '2026-12-01' }, '即将报名'],
    ['报名中', { registration_start: '2026-10-01', registration_end: '2026-12-01' }, '报名中'],
    ['已开始、没截止日、比赛没开始', { registration_start: '2026-10-01', competition_start: '2026-12-01' }, '报名中'],
    ['已开始、没截止日、比赛已开始', { registration_start: '2026-10-01', competition_start: '2026-10-20' }, '时间待公布'],
    ['开始当天（只写日期，从 0 点算）', { registration_start: '2026-11-01', registration_end: '2026-12-01' }, '报名中'],
  ];
  test.each(cases)('%s', (_name, item, expected) => expect(报名状态(item, now)).toBe(expected));
});

describe('状态分组：报名中 → 时间待公布（含即将报名）→ 比赛中 → 比赛已结束', () => {
  test('分组顺序', () => expect(分组顺序).toEqual(['报名中', '时间待公布', '比赛中', '比赛已结束']));
  const cases = [
    ['报名中', { registration_start: '2026-10-01', registration_end: '2026-12-01' }, '报名中'],
    ['即将报名', { registration_start: '2026-11-05', registration_end: '2026-12-01' }, '时间待公布'],
    ['没公布时间', {}, '时间待公布'],
    ['已截止、比赛还没结束', { registration_start: '2026-09-01', registration_end: '2026-10-20', competition_end: '2026-11-20' }, '比赛中'],
    ['已截止、比赛结束日是今天', { registration_start: '2026-09-01', registration_end: '2026-10-20', competition_end: '2026-11-01' }, '比赛中'],
    ['已截止、没有比赛结束日', { registration_start: '2026-09-01', registration_end: '2026-10-20' }, '比赛已结束'],
    ['已截止、比赛已结束', { registration_start: '2026-09-01', registration_end: '2026-10-10', competition_end: '2026-10-25' }, '比赛已结束'],
    ['已归档、比赛还没结束', { status: '已归档', registration_end: '2026-12-01', competition_end: '2026-12-20' }, '比赛中'],
  ];
  test.each(cases)('%s', (_name, item, expected) => expect(状态分组(item, now)).toBe(expected));
});
