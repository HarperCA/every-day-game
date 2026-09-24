import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { normalizeEditionTitle, titleHasEditionTokens } = require('../apps/miniprogram/cloudfunctions/adminData/editionTitle.js');

describe('赛事名称、年份与届次分离', () => {
  it.each([
    ['2026年第八届全国高校计算机能力挑战赛', '全国高校计算机能力挑战赛', '2026', '第八届'],
    ['2026（第四届）四川省大学生供应链优化管理大赛', '四川省大学生供应链优化管理大赛', '2026', '第四届'],
    ['第十一届华为ICT大赛（2026）', '华为ICT大赛', '2026', '第十一届'],
    ['中国国际大学生创新大赛（2026）', '中国国际大学生创新大赛', '2026', ''],
    ['2026年广东省大学生电子设计竞赛', '广东省大学生电子设计竞赛', '2026', ''],
    ['CHIP2026-医学NLP代码自动生成测评', 'CHIP-医学NLP代码自动生成测评', '2026', ''],
  ])('规范化 %s', (name, canonical, year, ordinal) => {
    expect(normalizeEditionTitle({name, editionName:name})).toMatchObject({name:canonical, editionYear:year, editionOrdinal:ordinal});
  });
  it('名称本来规范时，从原届次名称提取，不凭 ID 猜年份', () => {
    expect(normalizeEditionTitle({name:'蓝桥杯全国大学生软件和信息技术大赛', editionName:'第十七届（2025—2026）'})).toMatchObject({name:'蓝桥杯全国大学生软件和信息技术大赛', editionYear:'2025—2026', editionOrdinal:'第十七届'});
    expect(normalizeEditionTitle({name:'某大学生设计竞赛', id:'edition-2026'}).editionYear).toBe('');
  });
  it('复杂复合标题保留多届次提示，不能静默选一个', () => {
    const result = normalizeEditionTitle({name:'第七届辽宁省高校案例大赛暨第十届全国高校案例大赛辽宁赛区'});
    expect(result.name).toBe('辽宁省高校案例大赛暨全国高校案例大赛辽宁赛区');
    expect(result.editionOrdinal).toBe('第七届、第十届');
    expect(result.issues).toContain('标题涉及多个届次，需核对各自对应赛事');
  });
  it('新名称不得重新混入年份或届次', () => {
    expect(titleHasEditionTokens('2027年第九届全国大学生技能竞赛')).toBe(true);
    expect(titleHasEditionTokens('全国大学生技能竞赛')).toBe(false);
  });
});
