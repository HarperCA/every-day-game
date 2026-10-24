// 首页、收藏页双列卡片的显示字段（2026-10，取自 design/ui-tweaks，海报链路的测试没拿）
import { describe, expect, it } from 'vitest';
import { hydratePublic } from '../apps/miniprogram/services/publicRecord';
import { coverOf, deadlineOf, statusTextOf, withCard, withCover } from '../apps/miniprogram/services/cardCover';

it('接口没给海报时 posterUrl 为空，卡片显示文字封面', () => { expect(hydratePublic({}).posterUrl).toBe(''); });

describe('没有海报时的文字封面', () => {
  it('主标题是完整赛事名称，不删字', () => {
    expect(coverOf({ name:'“批改网杯”全国大学生英语翻译大赛', professions:['外语与教育'] })).toEqual({ coverTitle:'“批改网杯”全国大学生英语翻译大赛', coverKicker:'外语与教育', coverTone:'rose' });
    expect(coverOf({ name:'  2026年第八届全国大学生计算机设计竞赛 ' }).coverTitle).toBe('2026年第八届全国大学生计算机设计竞赛');
    expect(coverOf({}).coverTitle).toBe('');
  });
  it('角标是专业大类，颜色按专业大类', () => {
    expect(coverOf({ name:'全国大学生市场调查与分析大赛', professions:['经管与商科'] })).toMatchObject({ coverKicker:'经管与商科', coverTone:'orange' });
    expect(coverOf({ name:'全国大学生统计建模大赛', professions:['数学与统计'] })).toMatchObject({ coverKicker:'数学与统计', coverTone:'indigo' });
    expect(coverOf({ name:'某大赛', professions:['综合/不限专业', '计算机与AI'] })).toMatchObject({ coverKicker:'计算机与AI', coverTone:'blue' });
  });
  it('没有专业大类时按 id 固定取一种颜色，每次一样', () => {
    const first = coverOf({ id:'edition-x', name:'某大赛' });
    expect(first.coverKicker).toBe('大学生竞赛');
    expect(coverOf({ id:'edition-x', name:'某大赛' }).coverTone).toBe(first.coverTone);
    expect(['indigo', 'blue', 'teal', 'purple']).toContain(first.coverTone);
  });
  it('截止倒计时按北京时间的日历天数算', () => {
    const now = new Date('2026-10-23T22:30:00+08:00');
    const open = end => deadlineOf({ registrationStatus:'报名中', registrationEnd:end }, now);
    expect(open('2026-10-23T23:59:59+08:00')).toEqual({ text:'今天截止', tone:'urgent' });
    expect(open('2026-10-24T09:00:00+08:00')).toEqual({ text:'明天截止', tone:'urgent' });
    expect(open('2026-10-30T23:59:59+08:00')).toEqual({ text:'还剩 7 天', tone:'urgent' });
    expect(open('2026-11-15T23:59:59+08:00')).toEqual({ text:'还剩 23 天', tone:'' });
  });
  it('即将报名、已截止、只有截止说明、什么都没有', () => {
    const now = new Date('2026-10-23T10:00:00+08:00');
    expect(deadlineOf({ registrationStatus:'即将报名', registrationStart:'2026-10-26T00:00:00+08:00' }, now).text).toBe('3 天后开始报名');
    expect(deadlineOf({ registrationStatus:'已截止', registrationEnd:'2026-10-01T23:59:59+08:00' }, now)).toEqual({ text:'已过报名日期', tone:'muted' });
    expect(deadlineOf({ registrationStatus:'报名中', dataStatus:'archived' }, now).text).toBe('已过报名日期');
    expect(deadlineOf({ registrationStatus:'报名中', registrationEndNote:'各赛区自定' }, now).text).toBe('截止 各赛区自定');
    expect(deadlineOf({ registrationStatus:'时间待公布' }, now)).toEqual({ text:'报名时间待公布', tone:'muted' });
  });
  it('卡片带上级别和推荐等级；未明确的级别不显示', () => {
    const now = new Date('2026-10-23T10:00:00+08:00');
    expect(withCard({ id:'a', name:'某大赛', eventLevel:'省级/区域级', recommendationLevel:'值得参加' }, now)).toMatchObject({ levelTag:'省级', recClass:'r2' });
    expect(withCard({ id:'b', name:'某大赛', eventLevel:'其他/未明确', recommendationLevel:'' }, now)).toMatchObject({ levelTag:'', recClass:'' });
  });
  it('withCover 保留原字段', () => {
    expect(withCover({ id:'a', name:'全国大学生数学建模竞赛', posterUrl:'' })).toMatchObject({ id:'a', posterUrl:'', coverTitle:'全国大学生数学建模竞赛' });
  });
});

// 卡片状态标签：报名已截止的按服务器分组写“比赛中”或“已结束”（2026-10-24）
it('状态标签：比赛中、已结束按分组写，其余照旧写报名状态', () => {
  expect(statusTextOf({ registrationStatus:'已截止', listGroup:'比赛中' })).toBe('比赛中');
  expect(statusTextOf({ registrationStatus:'已截止', listGroup:'比赛已结束' })).toBe('已结束');
  expect(statusTextOf({ registrationStatus:'即将报名', listGroup:'时间待公布' })).toBe('即将报名');
  expect(statusTextOf({ registrationStatus:'已截止' })).toBe('已截止');
  expect(withCard({ id:'a', name:'某大赛', registrationStatus:'报名中', listGroup:'报名中' } as any).statusText).toBe('报名中');
});
