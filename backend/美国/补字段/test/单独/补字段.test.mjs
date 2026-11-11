// Codex 补字段（2026-11-03 用户定）：缺的字段交给 Codex 代理去官方网页上找，程序逐个核对——每个值都要在读过的官方网页原文里找得到，找不到的不填。
// 每晚流程的审核（新候选）和维护的缺失字段（库里已有的）共用这一个。用假的 AI 和假网页跑。
import { describe, expect, test } from 'vitest';
import { 补字段, 字段表 } from '../../index.mjs';

const 官网 = 'https://www.cmc.org.cn/notice/2026.html';
const 官网正文 = [
  '关于举办2026年全国大学生数学建模竞赛的通知',
  '主办单位：中国工业与应用数学学会',
  '参赛对象：全国普通高等学校在校本科生、专科生，可跨专业组队，每队3人。',
  '报名时间：2026年9月1日至2026年10月31日17:00，竞赛时间另行通知。',
  '参赛费用：每队报名费100元。报名网址：https://www.mcm.edu.cn/signup',
  '竞赛形式：三天内完成一篇论文，题目涉及数学建模与计算。',
].join('\n') + '\n' + '说明'.repeat(120);

// 假网页、假搜索；假 Codex 按给定的回复一轮轮交回
function 假环境(回复们, { 页们 = { [官网]: { status: '成功', text: 官网正文, links: [{ kind: '链接', text: '报名入口', url: 'https://www.mcm.edu.cn/signup' }] } } } = {}) {
  const 发过 = [];
  const 读过 = [];
  const 搜过 = [];
  const 报告 = [];
  let 第几 = 0;
  return {
    发过, 读过, 搜过, 报告,
    ctx: {
      now: () => new Date('2026-11-03T04:00:00Z'),
      ai: {
        // 记下当时的消息（同一个列表后面还会往里加）
        chat: async 请求 => { 发过.push({ ...请求, messages: [...请求.messages] }); const r = 回复们[第几++]; if (r instanceof Error) throw r; return { data: r }; },
        search: async 请求 => { 搜过.push(请求); return { references: [{ title: '2026年全国大学生数学建模竞赛通知', url: 官网, content: '主办单位：中国工业与应用数学学会' }] }; },
        报告问题: x => 报告.push(x),
      },
      web: { 读网页: async 网址 => { 读过.push(网址); return 页们[网址] ?? { status: '打不开', error: '404' }; } },
    },
  };
}
const 读官网 = { 动作: '读网页', 网址: 官网 };
const 结论 = (字段们, 待公布 = []) => ({ 动作: '结论', 结论: { 理由: '读了官网通知', 字段们, 待公布 } });
const 记录 = { name: '全国大学生数学建模竞赛', edition_name: '2026年全国大学生数学建模竞赛' };

describe('补字段：读过的官方原文里找得到的才填', () => {
  test('文字字段：值在原文里，就填，并带上出处', async () => {
    const t = 假环境([读官网, 结论([
      { 字段: 'organizer', 值: '中国工业与应用数学学会', 网址: 官网, 原文: '主办单位：中国工业与应用数学学会' },
      { 字段: 'fees', 值: '每队报名费100元', 网址: 官网, 原文: '参赛费用：每队报名费100元。' },
    ])]);
    const r = await 补字段(记录, ['organizer', 'fees'], t.ctx);
    expect(r.补到).toEqual({ organizer: '中国工业与应用数学学会', fees: '每队报名费100元' });
    expect(r.出处.organizer).toEqual({ 网址: 官网, 原文: '主办单位：中国工业与应用数学学会' });
    expect(r.没补到).toEqual([]);
    expect(r.来源们).toEqual([{ 网址: 官网, 原文: '主办单位：中国工业与应用数学学会' }]);
    expect(t.读过).toEqual([官网]);
  });
  test('值不在原文里、原文不在网页里、网页没读过：都不填，写明原因', async () => {
    const t = 假环境([读官网, 结论([
      { 字段: 'organizer', 值: '中国数学会', 网址: 官网, 原文: '主办单位：中国工业与应用数学学会' },
      { 字段: 'participants', 值: '全国大学生', 网址: 官网, 原文: '参赛对象：全国所有大学生' },
      { 字段: 'fees', 值: '免费', 网址: 'https://没读过.cn/', 原文: '免费' },
    ])]);
    const r = await 补字段(记录, ['organizer', 'participants', 'fees'], t.ctx);
    expect(r.补到).toEqual({});
    expect(r.没补到.sort()).toEqual(['fees', 'organizer', 'participants']);
    expect(r.原因).toMatch('值不在原文里');
    expect(r.原因).toMatch('原文不在网页里');
    expect(r.原因).toMatch('网页没读过');
  });
  test('日期：原文写“2026年10月31日17:00”，值 2026-10-31T17:00:00+08:00 算对；写成别的日子不算', async () => {
    const t = 假环境([读官网, 结论([
      { 字段: 'registration_start', 值: '2026-09-01', 网址: 官网, 原文: '报名时间：2026年9月1日至2026年10月31日17:00' },
      { 字段: 'registration_end', 值: '2026-10-31T17:00:00+08:00', 网址: 官网, 原文: '报名时间：2026年9月1日至2026年10月31日17:00' },
      { 字段: 'competition_start', 值: '2026-11-30', 网址: 官网, 原文: '报名时间：2026年9月1日至2026年10月31日17:00' },
    ])]);
    const r = await 补字段(记录, ['registration_start', 'registration_end', 'competition_start'], t.ctx);
    expect(r.补到).toEqual({ registration_start: '2026-09-01', registration_end: '2026-10-31T17:00:00+08:00' });
    expect(r.没补到).toEqual(['competition_start']);
  });
  test('待公布：原文写明“另行通知”的算补齐（标待公布）；原文没这么说的不算', async () => {
    const t = 假环境([读官网, 结论([], [
      { 字段: 'competition_start', 网址: 官网, 原文: '竞赛时间另行通知' },
      { 字段: 'competition_end', 网址: 官网, 原文: '报名时间：2026年9月1日至2026年10月31日17:00' },
    ])]);
    const r = await 补字段(记录, ['competition_start', 'competition_end'], t.ctx);
    expect(r.待公布).toEqual(['competition_start']);
    expect(r.没补到).toEqual(['competition_end']);
  });
  test('专业分类：只认十三类，要有原文依据；报名入口：要是网页里出现过的网址', async () => {
    const t = 假环境([读官网, 结论([
      { 字段: 'professions', 值: ['数学与统计', '火星学'], 网址: 官网, 原文: '题目涉及数学建模与计算' },
      { 字段: 'registration_url', 值: 'https://www.mcm.edu.cn/signup', 网址: 官网, 原文: '报名网址：https://www.mcm.edu.cn/signup' },
    ])]);
    const r = await 补字段(记录, ['professions', 'registration_url'], t.ctx);
    expect(r.补到).toEqual({ professions: ['数学与统计'], registration_url: 'https://www.mcm.edu.cn/signup' });
    const u = 假环境([读官网, 结论([{ 字段: 'registration_url', 值: 'https://编的.cn/x', 网址: 官网, 原文: '报名网址：https://www.mcm.edu.cn/signup' }])]);
    expect((await 补字段(记录, ['registration_url'], u.ctx)).没补到).toEqual(['registration_url']);
  });
  test('只填要补的字段：Codex 多给的不要；没要的字段不在结果里', async () => {
    const t = 假环境([读官网, 结论([
      { 字段: 'organizer', 值: '中国工业与应用数学学会', 网址: 官网, 原文: '主办单位：中国工业与应用数学学会' },
      { 字段: 'fees', 值: '每队报名费100元', 网址: 官网, 原文: '参赛费用：每队报名费100元。' },
    ])]);
    const r = await 补字段(记录, ['fees'], t.ctx);
    expect(r.补到).toEqual({ fees: '每队报名费100元' });
  });
});

describe('补字段：代理怎么跑', () => {
  test('搜索交给 AI 总管的 search，读网页交给 web；每轮把结果交回给 Codex；用途是 fill', async () => {
    const t = 假环境([{ 动作: '搜索', 搜索词: '2026 全国大学生数学建模竞赛 通知' }, 读官网, 结论([])]);
    await 补字段(记录, ['organizer'], t.ctx);
    expect(t.搜过[0]).toMatchObject({ purpose: 'search', query: '2026 全国大学生数学建模竞赛 通知' });
    expect(t.发过.every(x => x.purpose === 'fill' && x.json === true)).toBe(true);
    expect(t.发过[1].messages.at(-1).content).toMatch('搜索“2026 全国大学生数学建模竞赛 通知”的结果');
    expect(t.发过[2].messages.at(-1).content).toMatch('主办单位：中国工业与应用数学学会');
    expect(t.发过[0].messages[1].content).toMatch('主办方（organizer）');   // 告诉 Codex 要补哪些
  });
  test('网页打不开：告诉 Codex 换办法，不算出错', async () => {
    const t = 假环境([{ 动作: '读网页', 网址: 'https://打不开.cn/' }, 结论([])]);
    const r = await 补字段(记录, ['organizer'], t.ctx);
    expect(t.发过[1].messages.at(-1).content).toMatch('没读到');
    expect(r.没补到).toEqual(['organizer']);
  });
  test('Codex 交回的格式不对、轮数用完没结论：报告给 AI 总管并抛错；额度用完原样抛出（调用的地方决定顺延）', async () => {
    const 坏 = 假环境([{ 动作: '乱写' }]);
    await expect(补字段(记录, ['organizer'], 坏.ctx)).rejects.toThrow('Codex 补字段交回的内容用不了');
    expect(坏.报告).toHaveLength(1);
    const 没完 = 假环境([读官网, 读官网]);
    await expect(补字段(记录, ['organizer'], 没完.ctx, { 轮数: 2 })).rejects.toThrow('2 轮都没给出结论');
    const 额度 = Object.assign(new Error('codex 额度用完'), { kind: '额度用完' });
    await expect(补字段(记录, ['organizer'], 假环境([额度]).ctx)).rejects.toMatchObject({ kind: '额度用完' });
  });
  test('没有要补的：不调 Codex', async () => {
    const t = 假环境([]);
    expect(await 补字段(记录, [], t.ctx)).toMatchObject({ 补到: {}, 没补到: [], 待公布: [] });
    expect(t.发过).toEqual([]);
  });
  test('字段表：必须补和能补就补的，各字段的中文名和类型', () => {
    expect(Object.keys(字段表).sort()).toEqual(['competition_end', 'competition_start', 'eligibility', 'fees', 'format_and_rules', 'name', 'organizer', 'participants',
      'professions', 'registration_end', 'registration_method', 'registration_start', 'registration_url', 'rewards'].sort());
    expect(字段表.registration_end).toMatchObject({ 名: '报名截止', 类型: '日期', 必须: true });
    expect(字段表.fees).toMatchObject({ 名: '费用', 类型: '文字', 必须: false });
  });
});
