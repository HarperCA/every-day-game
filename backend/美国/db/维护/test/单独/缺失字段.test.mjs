// 缺失字段（2026-11-03 用户定）：库里已有的空字段也交给维护，由 Codex 补字段（美国/补字段/）去官方网页上找，找得到原文出处的才补。
//   检查：每个比赛看最新一届和已发布的届次（更早的已归档届次不补，花 Codex 的轮数不值）；一条记录缺的字段合成一个问题，一次交给 Codex。
//   查找：补到的直接改；官方写“待公布”的标待公布；补不到的留着下次再查；已发布、报名还没截止却补不到报名时间的转人工审核。
import { describe, expect, test } from 'vitest';
import { openDb } from '../../../index.mjs';
import { run as 查缺失 } from '../../审计/缺失字段/index.mjs';
import { findMissing } from '../../处理/查找/index.mjs';
import { runMaintenance } from '../../index.mjs';

const NOW = new Date('2026-11-03T04:00:00.000Z');
const quiet = { info() {}, warn() {}, error() {}, child() { return quiet; } };
const 官网 = 'https://www.cmc.org.cn/notice/2026.html';
const 官网正文 = ['关于举办2026年全国大学生数学建模竞赛的通知', '主办单位：中国工业与应用数学学会',
  '报名时间：2026年9月1日至2026年11月30日17:00，竞赛时间另行通知。', '参赛费用：每队报名费100元。'].join('\n') + '说明'.repeat(120);

function 样例库() {
  const db = openDb({ file: ':memory:', now: () => NOW });
  db.transaction(tx => {
    tx.insert('competition', 'event-math', { name: '全国大学生数学建模竞赛', level: '国家级', organizer: '中国工业与应用数学学会', professions: ['数学与统计'] });
    tx.insert('edition', 'ed-2024', { competition_id: 'event-math', ordinal: 1, edition_name: '2024 年', status: '已归档' });
    tx.insert('edition', 'ed-2025', { competition_id: 'event-math', ordinal: 2, edition_name: '2025 年', status: '已发布', registration_start: '2025-09-01', registration_end: '2025-10-31',
      competition_start: '2025-11-10', competition_end: '2025-11-13', participants: '全国在校大学生', format_and_rules: '三天写论文', fees: '100元', rewards: '证书', registration_url: 'https://a.cn', registration_method: '网上报名' });
    tx.insert('edition', 'ed-2026', { competition_id: 'event-math', ordinal: 3, edition_name: '2026 年', status: '已发布', participants: '全国在校大学生', format_and_rules: '三天写论文' });
    tx.insert('competition', 'event-art', { name: '大学生艺术展演', level: '国家级' });   // 没写主办方、专业
    tx.insert('edition', 'ed-art', { competition_id: 'event-art', ordinal: 1, edition_name: '第八届', status: '已归档', participants: '全国学生', format_and_rules: '作品展演',
      registration_start: '2026-03-01', registration_end: '2026-04-01', competition_start: '2026-05-01', competition_end: '2026-05-02' });
  });
  return db;
}
const 检查环境 = (db, 比赛编号) => ({ db, now: () => NOW, log: quiet, 范围: 比赛编号 ? { 比赛编号 } : null });

describe('检查：哪些记录、缺哪些字段', () => {
  test('最新一届和已发布的届次逐个看；空着的字段合成一个问题；参赛对象写了大学生就不缺资格依据；更早的已归档届次不看', async () => {
    const { problems } = await 查缺失(检查环境(样例库(), 'event-math'));
    expect(problems.map(p => p.key)).toEqual(['ed-2026']);   // ed-2025 什么都不缺；ed-2024 是更早的已归档
    expect(problems[0]).toMatchObject({ table: 'edition', 类型: '缺失' });
    expect(problems[0].字段们.sort()).toEqual(['competition_end', 'competition_start', 'fees', 'registration_end', 'registration_method', 'registration_start', 'registration_url', 'rewards'].sort());
    expect(problems[0].字段).toMatch('报名截止');
  });
  test('比赛级的（主办方、专业分类）记在比赛上；只有已归档的比赛也看它最新的一届', async () => {
    const { problems } = await 查缺失(检查环境(样例库(), 'event-art'));
    const 比赛的 = problems.find(p => p.table === 'competition');
    expect(比赛的).toMatchObject({ key: 'event-art' });
    expect(比赛的.字段们.sort()).toEqual(['organizer', 'professions']);
    expect(problems.find(p => p.key === 'ed-art').字段们.sort()).toEqual(['eligibility', 'fees', 'registration_method', 'registration_url', 'rewards'].sort());
  });
  test('没给范围：全部比赛都看', async () => {
    const { problems } = await 查缺失(检查环境(样例库()));
    expect(new Set(problems.map(p => p.key))).toEqual(new Set(['ed-2026', 'event-art', 'ed-art']));
  });
});

// 假 Codex：先读官网，再按给定的结论回答
function 查找环境(db, 结论) {
  const 回复们 = [{ 动作: '读网页', 网址: 官网 }, { 动作: '结论', 结论: { 理由: '读了官网', ...结论 } }];
  let 第几 = 0;
  return {
    db, now: () => NOW, log: quiet,
    ai: { chat: async () => ({ data: 回复们[第几++] }), search: async () => ({ references: [] }), 报告问题() {} },
    web: { 读网页: async 网址 => (网址 === 官网 ? { status: '成功', text: 官网正文, links: [] } : { status: '打不开', error: '404' }) },
  };
}

describe('查找：交给 Codex 补字段', () => {
  test('补到的交回改动和出处（有把握）；官方写“另行通知”的时间标待公布', async () => {
    const db = 样例库();
    const [问题] = (await 查缺失(检查环境(db, 'event-math'))).problems;
    const r = await findMissing(问题, 查找环境(db, {
      字段们: [
        { 字段: 'registration_start', 值: '2026-09-01', 网址: 官网, 原文: '报名时间：2026年9月1日至2026年11月30日17:00' },
        { 字段: 'registration_end', 值: '2026-11-30T17:00:00+08:00', 网址: 官网, 原文: '报名时间：2026年9月1日至2026年11月30日17:00' },
        { 字段: 'fees', 值: '每队报名费100元', 网址: 官网, 原文: '参赛费用：每队报名费100元。' },
      ],
      待公布: [{ 字段: 'competition_start', 网址: 官网, 原文: '竞赛时间另行通知' }],
    }));
    expect(r).toMatchObject({ 找到: true, 把握: '有把握' });
    expect(r.改动).toEqual({ registration_start: '2026-09-01', registration_end: '2026-11-30T17:00:00+08:00', fees: '每队报名费100元', pending_announcement: true });
    expect(r.出处[0]).toEqual({ 网址: 官网, 原文: '报名时间：2026年9月1日至2026年11月30日17:00' });
  });
  test('什么都没补到：留着（找到 false）；已发布、报名没截止、却补不到报名时间：转人工', async () => {
    const db = 样例库();
    const [问题] = (await 查缺失(检查环境(db, 'event-math'))).problems;
    const 只缺费用 = { ...问题, 字段们: ['fees'], 字段: '费用' };
    expect(await findMissing(只缺费用, 查找环境(db, { 字段们: [] }))).toMatchObject({ 找到: false });
    const 缺报名时间 = await findMissing(问题, 查找环境(db, { 字段们: [] }));
    expect(缺报名时间).toMatchObject({ 找到: true, 把握: '不确定', 改动: {} });
    expect(缺报名时间.说明).toMatch('已发布、报名还没截止');
  });
  test('比赛级：补到主办方、专业分类，改在比赛上', async () => {
    const db = 样例库();
    const 问题 = (await 查缺失(检查环境(db, 'event-art'))).problems.find(p => p.table === 'competition');
    const r = await findMissing(问题, 查找环境(db, { 字段们: [{ 字段: 'organizer', 值: '中国工业与应用数学学会', 网址: 官网, 原文: '主办单位：中国工业与应用数学学会' }] }));
    expect(r.改动).toEqual({ organizer: '中国工业与应用数学学会' });
  });
});

describe('接进维护跑一遍', () => {
  test('只跑缺失字段：补到的写进比赛库、留“维护改正”记录（带出处）；没补到的留着', async () => {
    const db = 样例库();
    const env = 查找环境(db, { 字段们: [{ 字段: 'fees', 值: '每队报名费100元', 网址: 官网, 原文: '参赛费用：每队报名费100元。' },
      { 字段: 'registration_end', 值: '2026-11-30T17:00:00+08:00', 网址: 官网, 原文: '报名时间：2026年9月1日至2026年11月30日17:00' }] });
    const 结果 = await runMaintenance({ db, ai: env.ai, web: env.web, log: quiet, now: () => NOW, only: ['缺失字段'], 比赛编号: 'event-math' });
    expect(结果.检查.完成).toEqual(['缺失字段']);
    expect(db.get('edition', 'ed-2026').data).toMatchObject({ fees: '每队报名费100元', registration_end: '2026-11-30T17:00:00+08:00' });
    const 记录 = db.find('audit_log', { action: '维护改正' })[0];
    expect(记录.detail).toMatchObject({ 检查项: '缺失字段', 新值: { fees: '每队报名费100元', registration_end: '2026-11-30T17:00:00+08:00' } });
    expect(记录.detail.出处[0].网址).toBe(官网);
  });
});
