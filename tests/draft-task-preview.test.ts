import { describe, expect, it } from 'vitest';
import { previewDraftTask } from '../apps/admin/src/draftTaskPreview';

const now = new Date('2026-09-24T00:00:00Z');
const base = {
  id:'edition-x', eventId:'event-x', name:'全国大学生测试设计竞赛', editionName:'2026', organizer:'测试组委会',
  participants:'全日制在校大学生', eligibility:'全日制在校大学生', formatAndRules:'提交设计作品', professions:['设计与艺术'],
  registrationUrl:'https://contest.org/signup', registrationMethod:'在官网报名系统注册提交',
  schedule:{ registration_start:'2026-10-01T00:00:00+08:00', registration_end:'2026-11-30T23:59:59+08:00' },
  sources:[{ url:'https://contest.org/notice', source_type:'organizer_notice', is_official:true, validity_status:'valid', evidence_excerpt:'关于举办2026年全国大学生测试设计竞赛的通知，面向全日制在校大学生' }],
  qualityIssues:[], systemValidation:'not_run', manualReview:'pending', dataStatus:'pending_manual_review',
};
const state = (task:any, code:string) => task.checks.find((item:any) => item.code === code).state;

describe('草稿处理预览的证据状态', () => {
  it('当届官方原文齐全、AI 未提出入时，各项为已证实', () => {
    const task = previewDraftTask(base, now);
    expect(task.checks.every((item:any) => item.state === '已证实')).toBe(true);
  });

  it('立项目录能证明身份，但不是当届官方依据，时间和入口不算已证实', () => {
    const task = previewDraftTask({ ...base, ruleVersion:'hunan-directory-v1', dataStatus:'draft' }, now);
    expect(state(task, 'EVENT_IDENTITY')).toBe('已证实');
    expect(state(task, 'OFFICIAL_EDITION_SOURCE')).toBe('待核验');
    expect(state(task, 'REGISTRATION_TIME')).toBe('待核验');
    expect(task.result).toBe('只有目录线索，当届赛事待追到');
  });

  it('AI 指出与原文不符的字段判为有冲突，只说缺少的判为待核验', () => {
    const task = previewDraftTask({ ...base, aiReview:{ decision:'needs_changes', evidence_status:[{ status:'reachable' }], issues:[
      { field:'eligibility', finding:'来源仅称本校学生可报名，记录泛化为全国高校' },
      { field:'schedule.registration_end', finding:'来源缺少报名截止时间' },
    ] } }, now);
    expect(state(task, 'COLLEGE_ELIGIBILITY')).toBe('有冲突');
    expect(state(task, 'REGISTRATION_TIME')).toBe('待核验');
    expect(task.nextAction).toBe('按官方原文改正：大学生参赛资格');
  });

  it('AI 打不开来源：没有原文摘录则全部待核验；有人工核对的原文摘录则不受影响，也不采用 AI 意见', () => {
    const blind = { decision:'insufficient_evidence', evidence_status:[{ status:'unreachable' }], issues:[{ field:'organizer', finding:'无法访问，主办方与记录不符待确认' }] };
    const withoutExcerpt = previewDraftTask({ ...base, sources:[{ ...base.sources[0], evidence_excerpt:'' }], aiReview:blind }, now);
    expect(withoutExcerpt.result).toBe('来源打不开，字段未经比对');
    expect(state(withoutExcerpt, 'ORGANIZER')).toBe('待核验');
    const withExcerpt = previewDraftTask({ ...base, aiReview:blind }, now);
    expect(state(withExcerpt, 'ORGANIZER')).toBe('已证实');
  });

  it('分诊待追溯的草稿，当届官方依据一律待核验，下一动作沿用追溯要求', () => {
    const task = previewDraftTask({ ...base, dataStatus:'draft', triage:{ bucket:'需要追溯', traceTodo:'来源为高校转发通知，需取主办单位原始通知' } }, now);
    expect(state(task, 'OFFICIAL_EDITION_SOURCE')).toBe('待核验');
    expect(task.nextAction).toContain('来源为高校转发通知');
  });

  it('“须核对所在学校的校赛安排”只是提醒，不把全国赛判成校赛；标题是校赛才算', () => {
    expect(state(previewDraftTask({ ...base, qualityIssues:['须核对所在学校的校赛报名及晋级安排'] }, now), 'EVENT_IDENTITY')).toBe('已证实');
    expect(state(previewDraftTask({ ...base, name:'测试大学校赛' }, now), 'EVENT_IDENTITY')).toBe('有冲突');
  });

  it('“在校学生”配合名称中的大学生才算大学生参赛资格', () => {
    const audience = { participants:'辽宁省内相关专业的在校学生。', eligibility:'辽宁省内相关专业的在校学生。' };
    expect(state(previewDraftTask({ ...base, ...audience, name:'辽宁省普通高等学校大学生测试大赛' }, now), 'COLLEGE_ELIGIBILITY')).toBe('已证实');
    expect(state(previewDraftTask({ ...base, ...audience, name:'辽宁省测试大赛' }, now), 'COLLEGE_ELIGIBILITY')).toBe('有冲突');
  });
});
