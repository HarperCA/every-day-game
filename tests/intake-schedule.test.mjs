import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeCompetitionName, findPriorEdition, estimateRegistrationStart, classifyIntake,
  evaluateDraftStaleness, draftStalenessReason, STALE_DRAFT_DAYS,
} = require('../apps/miniprogram/cloudfunctions/adminData/intakeSchedule.js');

function draftRecord(overrides = {}) {
  return {
    id: 'edition-x', name: '2026年全国机器人创新大赛', schedule: {}, qualityIssues: [],
    ...overrides,
  };
}

describe('normalizeCompetitionName', () => {
  it('strips year and edition-ordinal noise so the same series matches across years', () => {
    expect(normalizeCompetitionName('2026年全国机器人创新大赛')).toBe(normalizeCompetitionName('第十七届全国机器人创新大赛'));
  });

  it('does not collapse genuinely different competitions', () => {
    expect(normalizeCompetitionName('全国机器人创新大赛')).not.toBe(normalizeCompetitionName('全国人工智能创新大赛'));
  });
});

describe('findPriorEdition', () => {
  const prior = { id: 'edition-prior', name: '第十六届全国机器人创新大赛', schedule: { registration_start: '2025-03-01T00:00:00.000Z' } };

  it('matches an existing record with a real (non-estimated) schedule by normalized name', () => {
    expect(findPriorEdition(draftRecord(), [prior])?.id).toBe('edition-prior');
  });

  it('ignores records whose own schedule was itself estimated, to avoid compounding error', () => {
    const estimatedOnly = { ...prior, scheduleEstimated: true };
    expect(findPriorEdition(draftRecord(), [estimatedOnly])).toBeNull();
  });

  it('ignores unrelated competitions', () => {
    const unrelated = { id: 'edition-other', name: '全国编程算法大赛', schedule: { registration_start: '2025-03-01T00:00:00.000Z' } };
    expect(findPriorEdition(draftRecord(), [unrelated])).toBeNull();
  });

  it('never matches a record against itself', () => {
    expect(findPriorEdition(draftRecord({ id: 'edition-prior' }), [prior])).toBeNull();
  });
});

describe('estimateRegistrationStart', () => {
  it('adds 365 days to the prior edition base date', () => {
    const estimate = estimateRegistrationStart({ schedule: { registration_start: '2025-03-01T00:00:00.000Z' } });
    expect(estimate).toBe('2026-03-01T00:00:00.000Z');
  });

  it('returns null when there is nothing to base an estimate on', () => {
    expect(estimateRegistrationStart(null)).toBeNull();
    expect(estimateRegistrationStart({ schedule: {} })).toBeNull();
  });
});

describe('classifyIntake', () => {
  const now = new Date('2026-09-19T00:00:00.000Z');

  it('archives immediately when registration already closed at discovery time', () => {
    const record = draftRecord({ schedule: { registration_end: '2026-07-01T00:00:00.000Z' } });
    const result = classifyIntake(record, [], now);
    expect(result.decision).toBe('archive');
  });

  it('carries a next-edition estimate into the archive decision when a prior edition exists', () => {
    const prior = { id: 'p', name: '2025年全国机器人创新大赛', schedule: { registration_start: '2025-07-01T00:00:00.000Z' } };
    const record = draftRecord({ schedule: { registration_end: '2026-07-01T00:00:00.000Z' } });
    const result = classifyIntake(record, [prior], now);
    expect(result.decision).toBe('archive');
    expect(result.nextEditionEstimate).toBe('2026-07-01T00:00:00.000Z');
  });

  it('sends to kimi_review when a published registration date falls within six months', () => {
    const record = draftRecord({ schedule: { registration_start: '2026-11-01T00:00:00.000Z' } });
    const result = classifyIntake(record, [], now);
    expect(result.decision).toBe('kimi_review');
    expect(result.estimatedRegistrationStart).toBeNull(); // 真实日期，不是推算的
  });

  it('holds when the registration date is more than six months out', () => {
    const record = draftRecord({ schedule: { registration_start: '2027-06-01T00:00:00.000Z' } });
    const result = classifyIntake(record, [], now);
    expect(result.decision).toBe('hold');
  });

  it('estimates from a matching prior edition when no date is published, then applies the same six-month window', () => {
    const prior = { id: 'p', name: '2025年全国机器人创新大赛', schedule: { registration_start: '2025-08-01T00:00:00.000Z' } };
    // 估算出 2026-08-01，距 now(2026-09-19) 已过去，落在"半年以内"窗口
    const record = draftRecord({ name: '2026年全国机器人创新大赛' });
    const result = classifyIntake(record, [prior], now);
    expect(result.decision).toBe('kimi_review');
    expect(result.estimatedRegistrationStart).toBe('2026-08-01T00:00:00.000Z');
  });

  // 不是一定要有报名时间，只要知道有这场比赛、即将报名就够了——没日期、
  // 没往届可参照的，不再直接拦在人工，交给三项核验；Kimi 读不到日期就
  // 落回"时间待公布"照常发布，不用在这一步就放弃。
  it('still sends to kimi_review when there is no date and no prior edition to estimate from, instead of giving up to manual review', () => {
    const record = draftRecord();
    const result = classifyIntake(record, [], now);
    expect(result.decision).toBe('kimi_review');
    expect(result.estimatedRegistrationStart).toBeNull();
  });

  it('still falls back to manual review when a real date value cannot even be parsed (a genuine data error, not "just unknown")', () => {
    const record = draftRecord({ schedule: { registration_start: '不是日期' } });
    const result = classifyIntake(record, [], now);
    expect(result.decision).toBe('manual_review');
  });
});

describe('evaluateDraftStaleness', () => {
  const now = new Date('2026-09-19T00:00:00.000Z');
  const daysAgo = days => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  it('is not stale before the threshold', () => {
    const record = draftRecord({ dataStatus:'draft', firstSeenAt:daysAgo(STALE_DRAFT_DAYS - 1) });
    expect(evaluateDraftStaleness(record, now).stale).toBe(false);
  });

  it('flags a draft that has sat unresolved past the threshold', () => {
    const record = draftRecord({ dataStatus:'draft', firstSeenAt:daysAgo(STALE_DRAFT_DAYS + 1) });
    const result = evaluateDraftStaleness(record, now);
    expect(result.stale).toBe(true);
    expect(result.reason).toBeTruthy();
  });

  it('never flags a record that already became published or archived', () => {
    const published = draftRecord({ dataStatus:'published', firstSeenAt:daysAgo(30) });
    const archived = draftRecord({ dataStatus:'archived', firstSeenAt:daysAgo(30) });
    expect(evaluateDraftStaleness(published, now).stale).toBe(false);
    expect(evaluateDraftStaleness(archived, now).stale).toBe(false);
  });

  it('exempts a "hold" draft (registration more than six months out) even if it is very old', () => {
    // hold 是设计上就要等半年的，不是卡住——ingest-candidates.mjs 会给它打 stalenessExempt。
    const record = draftRecord({ dataStatus:'draft', firstSeenAt:daysAgo(30), stalenessExempt:true });
    expect(evaluateDraftStaleness(record, now).stale).toBe(false);
  });

  it('does not guess at records from before this feature existed (no firstSeenAt at all)', () => {
    const record = draftRecord({ dataStatus:'draft', firstSeenAt:undefined });
    expect(evaluateDraftStaleness(record, now).stale).toBe(false);
  });

  it('explains a failed field verification in the reason, naming the specific fields that were wrong', () => {
    const record = draftRecord({
      dataStatus:'draft', firstSeenAt:daysAgo(STALE_DRAFT_DAYS + 1),
      aiFieldVerification:{ all_correct:false, name_correct:true, registration_start_status:'incorrect', registration_end_status:'confirmed_correct', registration_url_correct:true, professions_confident:true },
    });
    expect(draftStalenessReason(record)).toContain('报名开始时间与来源不符');
  });

  it('falls back to the most recent quality-issue note when there was no field verification at all', () => {
    // 水赛过滤器判定为 review 的候选从没进过三项核验，但一样该给个理由。
    const record = draftRecord({ dataStatus:'draft', firstSeenAt:daysAgo(STALE_DRAFT_DAYS + 1), qualityIssues:['缺少可查的价值证据，需要人工或 AI 判断'] });
    expect(draftStalenessReason(record)).toBe('缺少可查的价值证据，需要人工或 AI 判断');
  });

  it('gives a generic reason as an absolute last resort, never leaving it blank', () => {
    const record = draftRecord({ dataStatus:'draft', firstSeenAt:daysAgo(STALE_DRAFT_DAYS + 1), qualityIssues:[] });
    expect(draftStalenessReason(record)).toBeTruthy();
  });
});

// 2026-09-30：发现时已截止的收进库里作为已归档，估算下一届
describe('发现时已截止：估算下一届', () => {
  const { estimateNextEditionFromClosed, classifyIntake } = require('../apps/miniprogram/cloudfunctions/adminData/intakeSchedule.js');
  const now = new Date('2026-09-30T00:00:00Z');
  it('本届有报名开始：往后推一年', () => {
    const r = estimateNextEditionFromClosed({ schedule:{ registration_start:'2026-03-01T00:00:00.000Z', registration_end:'2026-06-01T00:00:00.000Z' } }, null);
    expect(r.nextEditionEstimate.slice(0, 10)).toBe('2027-03-01');
    expect(r.nextEditionEndEstimate.slice(0, 10)).toBe('2027-06-01');
    expect(r.nextEditionBasis).toContain('本届报名开始');
  });
  it('只有截止（收稿截止）：只推下一届大约何时截止，不硬凑开始日期', () => {
    const r = estimateNextEditionFromClosed({ schedule:{ registration_start:null, registration_end:'2026-06-01' } }, null);
    expect(r.nextEditionEstimate).toBeNull();
    expect(r.nextEditionEndEstimate.slice(0, 10)).toBe('2027-06-01');
    expect(r.nextEditionBasis).toContain('只写了截止');
  });
  it('classifyIntake 的归档结论带上估算', () => {
    const decision = classifyIntake({ name:'湖南省大学生化工设计竞赛', schedule:{ registration_end:'2026-06-01' } }, [], now);
    expect(decision).toMatchObject({ decision:'archive' });
    expect(decision.nextEditionEndEstimate.slice(0, 10)).toBe('2027-06-01');
  });
});

describe('收稿截止当作报名截止', () => {
  const { buildExtractPrompt } = require('../apps/miniprogram/cloudfunctions/adminData/competitionExtract.js');
  const { buildFieldVerificationPrompt } = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');
  it('抽取和三项核验的提示词口径一致', () => {
    expect(buildExtractPrompt('正文', '某大赛')).toContain('收稿截止、作品提交截止、作品报送截止');
    expect(buildFieldVerificationPrompt({ id:'a', name:'某大赛', schedule:{} }, [])).toContain('收稿截止、作品提交截止、作品报送截止');
  });
});
