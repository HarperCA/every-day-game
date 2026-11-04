// 程序填：通知页上常见“主办单位：××”“报名截止时间：2026年10月15日”这种写法，程序按固定的字段名先填；
// 填不上的才交给 DeepSeek（2026-11-01 用户定）。每项的原文依据就是那一行，回原文一定找得到。
import { describe, expect, test } from 'vitest';
import { 程序填, 必要齐了, 必要字段 } from '../../steps/程序填.mjs';
import { quoteAppearsInSource } from '../../steps/原文核对.mjs';

const 通知 = [
  '关于举办2026年全国大学生数学建模竞赛的通知',
  '一、主办单位：中国工业与应用数学学会',
  '二、参赛对象：全日制在校本科生、研究生',
  '三、参赛资格：须由所在学校统一报名',
  '四、竞赛形式：三人一队，72 小时内完成一道建模题并提交论文',
  '五、组队要求：每队不超过 3 人，可跨专业组队',
  '六、报名方式：登录竞赛官网注册后由学校审核',
  '七、报名费用：每队 200 元',
  '八、报名时间：2026年9月1日—2026年9月20日',
].join('\n');

describe('程序填：名称：内容', () => {
  test('按字段名填，值是冒号后面的内容，依据是整行', () => {
    const { fields, 填了 } = 程序填(通知);
    expect(fields.organizer).toEqual({ value: '中国工业与应用数学学会', quote: '一、主办单位：中国工业与应用数学学会' });
    expect(fields.participants.value).toBe('全日制在校本科生、研究生');
    expect(fields.eligibility.value).toBe('须由所在学校统一报名');
    expect(fields.format_and_rules.value).toBe('三人一队，72 小时内完成一道建模题并提交论文');
    expect(fields.team_size.value).toBe('每队不超过 3 人，可跨专业组队');
    expect(fields.registration_method.value).toBe('登录竞赛官网注册后由学校审核');
    expect(fields.fees.value).toBe('每队 200 元');
    expect(fields.registration_start.value).toBe('2026-09-01');
    expect(fields.registration_end.value).toBe('2026-09-20');
    expect(填了.sort()).toEqual(['eligibility', 'fees', 'format_and_rules', 'organizer', 'participants', 'registration_end', 'registration_method', 'registration_start', 'team_size']);
  });
  test('每项的依据回原文都找得到', () => {
    for (const f of Object.values(程序填(通知).fields)) expect(quoteAppearsInSource(f.quote, 通知)).toBe(true);
  });
  test('标题单独一行、内容在下一行的也认；半角冒号、空格、序号写法都认', () => {
    const { fields } = 程序填('（一）主办单位\n教育部高等学校计算机类专业教学指导委员会\n2. 参赛对象: 高校在读学生\n主 办 方：某某学会');
    expect(fields.organizer).toEqual({ value: '教育部高等学校计算机类专业教学指导委员会', quote: '（一）主办单位 教育部高等学校计算机类专业教学指导委员会' });
    expect(fields.participants.value).toBe('高校在读学生');
  });
  test('只认行首的字段名：句子中间提到的不算；同一字段只取第一次出现的', () => {
    const { fields } = 程序填('本次比赛的主办单位是教育部。\n主办单位：甲学会\n主办单位：乙学会');
    expect(fields.organizer.value).toBe('甲学会');
  });
  test('冒号后面不到 2 个字的不填；太长的截到 200 字', () => {
    expect(程序填('主办单位：\n参赛对象：无').fields).toEqual({});
    expect(程序填(`参赛对象：${'本'.repeat(300)}`).fields.participants.value).toHaveLength(200);
  });
});

describe('程序填：报名日期（只认写全了年份的日期，宁可不填也不猜）', () => {
  const 日期 = text => { const f = 程序填(text).fields; return [f.registration_start?.value ?? null, f.registration_end?.value ?? null]; };
  test('报名截止、报名开始各自一行', () => {
    expect(日期('报名截止时间：2026年10月15日 17:00')).toEqual([null, '2026-10-15']);
    expect(日期('报名开始时间：2026-09-01\n报名截止日期：2026/10/15')).toEqual(['2026-09-01', '2026-10-15']);
  });
  test('报名时间写成一段：两头都有年份的填两头', () => {
    expect(日期('报名时间：2026年9月1日至2026年10月15日')).toEqual(['2026-09-01', '2026-10-15']);
    expect(日期('报名时间：2026.9.1-2026.10.15')).toEqual(['2026-09-01', '2026-10-15']);
  });
  test('后一个日期没写年份：只填开始，截止留给 DeepSeek', () => {
    expect(日期('报名时间：2026年9月1日至10月15日')).toEqual(['2026-09-01', null]);
  });
  test('只有一个日期：写了“前、截止、止”的算截止，写了“起、开始”的算开始，都没写的不填', () => {
    expect(日期('报名时间：2026年10月15日前')).toEqual([null, '2026-10-15']);
    expect(日期('报名时间：即日起至2026年10月15日止')).toEqual([null, '2026-10-15']);
    expect(日期('报名时间：2026年9月1日起')).toEqual(['2026-09-01', null]);
    expect(日期('报名时间：2026年9月1日')).toEqual([null, null]);
  });
  test('没写年份、不是真日期的都不填', () => {
    expect(日期('报名截止时间：10月15日')).toEqual([null, null]);
    expect(日期('报名截止时间：2026年13月40日')).toEqual([null, null]);
  });
});

describe('必要的四项齐了就不用调 DeepSeek', () => {
  test('主办方、参赛对象（或资格）、赛制、报名截止都有才算齐', () => {
    expect(必要字段).toEqual(['organizer', 'participants', 'format_and_rules', 'registration_end']);
    expect(必要齐了(程序填(通知).fields)).toBe(true);
    const 没对象有资格 = 程序填(通知.replace('二、参赛对象：全日制在校本科生、研究生\n', '')).fields;
    expect(必要齐了(没对象有资格)).toBe(true);
    expect(必要齐了(程序填(通知.replace('四、竞赛形式', '四、其他')).fields)).toBe(false);
    expect(必要齐了({})).toBe(false);
  });
});
