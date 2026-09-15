// 官方报名日期的可靠程度。
//
// 已发布的记录由云函数在公开缓存里算好（competitionValue.js），直接读字段即可；
// 这里这份是给开发预览数据用的 —— 预览走的是本地种子数据，没有经过云函数。
//
// 两份文案必须逐字一致，由 tests/timing-notes.test.mjs 守护：
// 一旦漂移，用户在预览和正式数据下会看到不同的说明。

export type TimingReliability = 'official' | 'school_controlled' | 'unverified';

export const TIMING_RELIABILITY: Record<string, TimingReliability> = {
  '需先校内选拔': 'school_controlled',
  '学校统一报名': 'school_controlled',
  '以赛区或学校通知为准': 'school_controlled',
  '两种方式均可': 'unverified',
  '暂未明确': 'unverified',
  '自行报名': 'official',
};

export const SCHOOL_TIMING_NOTES: Record<string, string> = {
  '需先校内选拔': '需先通过校内选拔。校赛时间各校不同，通常远早于官方截止日，很可能已经开始组队。',
  '学校统一报名': '由学校统一报名。你校的内部截止日期通常早于官方日期。',
  '以赛区或学校通知为准': '报名时间以赛区或学校通知为准，官方日期仅供参考。',
  '两种方式均可': '可自行报名，也可能由学校统一组织，两条路的截止时间不一定相同。',
  '暂未明确': '报名组织方式尚未确认，官方日期可能不是你实际要赶的时间。',
};

export const SCHOOL_TIMING_ACTION = '请尽快向教务处、学院或指导老师确认本校安排，不要等到官方截止日。';

export function schoolTimingAdvice(registrationOrganization: string) {
  const reliability = TIMING_RELIABILITY[registrationOrganization] || 'unverified';
  if (reliability === 'official') return { dependent: false, reliability, note: '' };
  const note = SCHOOL_TIMING_NOTES[registrationOrganization] || SCHOOL_TIMING_NOTES['暂未明确'];
  return { dependent: true, reliability, note: `${note}${SCHOOL_TIMING_ACTION}` };
}
