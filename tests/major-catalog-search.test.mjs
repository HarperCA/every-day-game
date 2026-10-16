import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { majorCategories } = require('../apps/miniprogram/cloudfunctions/publicData/majorKeywords.js');
const { majors } = require('../apps/miniprogram/cloudfunctions/publicData/undergraduateMajors2026.json');
const { PROFESSION_TAXONOMY } = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');

describe('官方专业目录搜索映射', () => {
  it.each([
    ['软件工程', ['计算机与AI']],
    ['临床医学', ['生物与医药']],
    ['汉语言文学', ['人文与法学']],
    ['英语', ['外语与教育']],
  ])('%s 使用目录映射，避免通用关键词串类', (name, categories) => {
    expect(majorCategories(name)).toEqual(categories);
    expect(majorCategories(`${name}专业`)).toEqual(categories);
    expect(majorCategories(`${name}专业类`)).toEqual(categories);
    expect(majorCategories(`${name}系`)).toEqual(categories);
  });

  it('经济统计学保留经管映射，精确匹配以目录交叉学科分类为准', () => {
    const major = majors.find(item => item.name === '经济统计学');
    expect(major).toBeDefined();
    expect(majorCategories('经济统计学')).toEqual(major.categories);
    expect(majorCategories('经济统计学')).toContain('经管与商科');
  });

  it('全部专业名、官方代码及后缀都命中自身目录映射', () => {
    expect(majors.length).toBeGreaterThan(800);
    for (const major of majors) {
      expect(major.categories.length, major.name).toBeGreaterThan(0);
      for (const category of major.categories) expect(PROFESSION_TAXONOMY, major.name).toContain(category);
      expect(majorCategories(major.name), major.name).toEqual(major.categories);
      expect(majorCategories(major.code), major.code).toEqual(major.categories);
      expect(majorCategories(`${major.name}专业`), major.name).toEqual(major.categories);
    }
  });

  it('保留常用专业简称和英文 AI，设计不扩展到程序设计和机械设计', () => {
    expect(majorCategories('设计')).toEqual(['设计与艺术']);
    expect(majorCategories('程序设计')).toEqual(['计算机与AI']);
    expect(majorCategories('机械设计')).toEqual(['机械与自动化']);
    expect(majorCategories('AI')).toEqual(['计算机与AI']);
  });

  it('不会把带专业字样的比赛全名当作专业扩大搜索', () => {
    for (const name of ['全国大学生软件工程竞赛', '临床医学技能大赛', '全国大学生程序设计比赛', '挑战杯']) {
      expect(majorCategories(name)).toEqual([]);
    }
    expect(majorCategories('晴空杯')).toEqual([]);
  });
});
