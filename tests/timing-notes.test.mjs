import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { SCHOOL_TIMING_NOTES, TIMING_RELIABILITY, schoolTimingAdvice } = require('../apps/miniprogram/cloudfunctions/adminData/competitionValue.js');

// 小程序侧的 TypeScript 副本只在开发预览数据下使用（预览不经过云函数）。
// 这里不导入 TS，而是逐字比对源文本：一旦漂移，用户在预览和正式数据下
// 会看到不同的说明文案。
const miniprogramSource = fs.readFileSync(new URL('../apps/miniprogram/services/timing.ts', import.meta.url), 'utf8');

describe('timing notes stay identical across the cloud function and the miniprogram', () => {
  it('carries every note verbatim', () => {
    for (const [organization, note] of Object.entries(SCHOOL_TIMING_NOTES)) {
      expect(miniprogramSource).toContain(organization);
      expect(miniprogramSource).toContain(note);
    }
  });

  it('carries the same reliability mapping', () => {
    for (const [organization, reliability] of Object.entries(TIMING_RELIABILITY)) {
      expect(miniprogramSource).toMatch(new RegExp(`'${organization}':\\s*'${reliability}'`));
    }
  });

  it('carries the same call to action', () => {
    expect(miniprogramSource).toContain('请尽快向教务处、学院或指导老师确认本校安排，不要等到官方截止日。');
  });
});

describe('what the detail page shows', () => {
  const wxml = fs.readFileSync(new URL('../apps/miniprogram/pages/detail/detail.wxml', import.meta.url), 'utf8');
  const wxss = fs.readFileSync(new URL('../apps/miniprogram/pages/detail/detail.wxss', import.meta.url), 'utf8');

  it('renders the warning right after the dates it qualifies', () => {
    // 警告必须紧跟在时间卡片后面：放在页面别处，用户看完日期就滑走了。
    const dates = wxml.indexOf('关键时间');
    const warning = wxml.indexOf('timing-warning');
    const nextSection = wxml.indexOf('参赛与规则');
    expect(warning).toBeGreaterThan(dates);
    expect(warning).toBeLessThan(nextSection);
  });

  it('shows nothing when the official date is reliable', () => {
    expect(wxml).toContain('wx:if="{{item.schoolTimingDependent}}"');
  });

  it('distinguishes a school-controlled date from an unconfirmed one', () => {
    expect(wxml).toContain('以上日期不是你要赶的时间');
    expect(wxml).toContain('以上日期未经确认');
    expect(wxss).toContain('.timing-school_controlled');
    expect(wxss).toContain('.timing-unverified');
  });
});

describe('both data paths carry the fields', () => {
  const repository = fs.readFileSync(new URL('../apps/miniprogram/services/repository.ts', import.meta.url), 'utf8');

  it('reads the cloud-computed fields for published records', () => {
    expect(repository).toContain('item.school_timing_dependent');
    expect(repository).toContain('item.timing_reliability');
  });

  it('computes them locally for preview data, which never reaches the cloud function', () => {
    expect(repository).toContain('schoolTimingAdvice(item.registrationOrganization');
  });

  it('agrees with the cloud function on every organization value in the seed data', () => {
    const seed = require('../data/seed/competitions.json');
    const organizations = new Set(seed.event_editions.map(edition => edition.registration_organization));
    for (const organization of organizations) {
      const advice = schoolTimingAdvice({ registrationOrganization:organization });
      expect(['official', 'school_controlled', 'unverified']).toContain(advice.reliability);
      if (advice.reliability !== 'official') expect(advice.note.length).toBeGreaterThan(10);
    }
  });
});
