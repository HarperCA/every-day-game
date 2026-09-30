import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { SCHOOL_TIMING_NOTES, TIMING_RELIABILITY, schoolTimingAdvice } = require('../apps/miniprogram/cloudfunctions/adminData/competitionValue.js');

// 小程序端的时间提示文案由服务端计算（publicData 返回），开发预览用的本地副本 timing.ts 已于 2026-09-30 删除。

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

describe('published records carry the fields', () => {
  it('reads the cloud-computed fields for published records', () => {
    // 公开记录的字段转换在 publicRecord.ts
    const publicRecord = fs.readFileSync(new URL('../apps/miniprogram/services/publicRecord.ts', import.meta.url), 'utf8');
    expect(publicRecord).toContain('item.school_timing_dependent');
    expect(publicRecord).toContain('item.timing_reliability');
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
