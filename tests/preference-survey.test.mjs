// 偏好问卷存进账号（userData 的 savePreferences）和后台统计（publicSync 的 pullPreferenceStats）
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PROFESSION_CATEGORIES } from '../apps/miniprogram/services/filterOptions';

const require = createRequire(import.meta.url);
const { PROFESSIONS, PROVINCES, normalizePreferenceInput, aggregatePreferences } = require('../apps/miniprogram/cloudfunctions/userData/preferenceValidation.js');

describe('偏好问卷：存进账号前的清洗', () => {
  it('云函数的选项名单和小程序一致', () => {
    expect([...PROFESSIONS].sort()).toEqual([...PROFESSION_CATEGORIES].sort());
    const page = fs.readFileSync('apps/miniprogram/services/competitionPreferences.ts', 'utf8');
    for (const province of PROVINCES) expect(page).toContain(`'${province}'`);
  });
  it('userData 和 publicSync 用的是同一份文件', () => {
    expect(fs.readFileSync('apps/miniprogram/cloudfunctions/publicSync/preferenceValidation.js', 'utf8'))
      .toBe(fs.readFileSync('apps/miniprogram/cloudfunctions/userData/preferenceValidation.js', 'utf8'));
  });
  it('不在名单里的值丢掉，不报错；大类去重', () => {
    expect(normalizePreferenceInput({ profession:'火星学', categories:['计算机与AI', '计算机与AI', '<script>'], province:'不限', surveyStatus:'x' }))
      .toEqual({ profession:'', categories:['计算机与AI'], province:'', surveyStatus:'completed', dontShowAgain:false });
    expect(normalizePreferenceInput({ profession:'电子信息', province:'江苏省', surveyStatus:'skipped', dontShowAgain:true }))
      .toEqual({ profession:'电子信息', categories:[], province:'江苏省', surveyStatus:'skipped', dontShowAgain:true });
  });
});

describe('偏好问卷：后台统计只给计数', () => {
  const stats = aggregatePreferences([
    { user_id:'u1', profession:'电子信息', categories:['电子信息', '计算机与AI'], province:'江苏省', survey_status:'completed' },
    { user_id:'u2', profession:'', categories:[], province:'', survey_status:'completed' },
    { user_id:'u3', profession:'电子信息', categories:['计算机与AI'], province:'江苏省', survey_status:'skipped' },
  ]);
  it('填完、跳过分开算；跳过的不计入选项分布', () => {
    expect(stats).toMatchObject({ total:3, completed:2, skipped:1, noProfession:1, noCategory:1, noProvince:1 });
    expect(stats.profession).toEqual({ 电子信息:1 });
    expect(stats.categories).toEqual({ 电子信息:1, 计算机与AI:1 });
    expect(stats.province).toEqual({ 江苏省:1 });
  });
  it('结果里没有账号信息', () => {
    expect(JSON.stringify(stats)).not.toMatch(/u1|u2|u3|user_id/);
  });
});
