// 小程序首页用的筛选常量和公开记录字段转换：可以脱离微信环境加载，并和后端口径一致。
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PROFESSION_CATEGORIES, statusOptions, levelOptions } from '../apps/miniprogram/services/filterOptions';
import { hydratePublic } from '../apps/miniprogram/services/publicRecord';

const require = createRequire(import.meta.url);
const { PROFESSION_TAXONOMY } = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');

describe('小程序共用代码', () => {
  it('专业筛选的十三类与后端 AI 审核用的完全一致', () => {
    expect(PROFESSION_CATEGORIES).toEqual([...PROFESSION_TAXONOMY].sort());
  });
  it('筛选项与字段转换可以脱离微信环境使用', () => {
    expect(statusOptions[0]).toBe('全部报名状态');
    expect(levelOptions).toContain('国际级');
    const item = hydratePublic({ id:'a', name:'某大赛', registration_status:'报名中', registration_end:'2026-10-15T00:00:00Z', professions:['计算机与AI'] });
    expect(item.statusClass).toBe('status-open');
    expect(item.registrationEndDate).toBe('2026-10-15');
  });
});
