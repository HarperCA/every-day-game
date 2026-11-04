// 维护：审计比赛库找出错误和缺失 → 错误有把握的直接改、缺失的调工具查、拿不准的标待人工审核 → 统一提交（版本号核对）。
// 人工改过的字段机器不自动改；已删除的不管；每次自动改正都留操作日志。用内存里的比赛库，不连网、不调 AI。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { importsOf, relTo, walk } from '../../../../../共用/test/复用/扫描引用.mjs';
import { openDb } from '../../../index.mjs';
import { runMaintenance } from '../../index.mjs';
import { CHECKS } from '../../审计清单.mjs';
import { routeFound, routeProblem } from '../../处理/分流.mjs';

const MAINTAIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const US_DIR = path.resolve(MAINTAIN_DIR, '..', '..');   // 维护在 美国/db/维护/（2026-11-01 挪进比赛库的文件夹）
const NOW = '2026-10-31T12:00:00.000Z';
const quiet = { info() {}, warn() {}, error() {}, child() { return quiet; } };

function openSample() {
  const db = openDb({ file: ':memory:', now: () => new Date('2026-10-01T00:00:00.000Z') });
  db.transaction(tx => {
    tx.insert('competition', 'event-math', { name: '全国大学生数学建模竞赛', level: '国家级', organizer: '错的主办方' });
    tx.insert('edition', 'ed-2025', { competition_id: 'event-math', ordinal: 1, edition_name: '2025 年数学建模', status: '已归档' });
    tx.insert('edition', 'ed-2026', { competition_id: 'event-math', ordinal: 2, edition_name: '2026 年数学建模', status: '已发布', registration_end: '2026-09-01' });
  });
  return db;
}
const check = (name, problems, extra = {}) => ({ name, timeoutMs: 5000, run: () => ({ problems }), ...extra });
const run = (db, checks, more = {}) => runMaintenance({ db, log: quiet, now: () => new Date(NOW), checks, find: async () => ({ 找到: false }), ...more });
const 错的截止 = { table: 'edition', key: 'ed-2026', 字段: 'registration_end', 类型: '错误', 现在的值: '2026-09-01', 依据: '官网写的是 9 月 10 日' };

describe('分流', () => {
  test('错误有建议改动：有把握就改，不确定转人工；缺失、或不知道正确值的去查', () => {
    expect(routeProblem({ 类型: '错误', 建议改动: { a: 1 }, 把握: '有把握' })).toBe('改正');
    expect(routeProblem({ 类型: '错误', 建议改动: { a: 1 }, 把握: '不确定' })).toBe('人工');
    expect(routeProblem({ 类型: '错误', 把握: '有把握' })).toBe('查找');
    expect(routeProblem({ 类型: '缺失' })).toBe('查找');
  });
  test('查找之后：找到、有把握、带原文出处才改；找到但拿不准或没出处转人工；没找到留着', () => {
    const 出处 = [{ 网址: 'https://a.cn', 原文: '主办单位：中国工业与应用数学学会' }];
    expect(routeFound({ 找到: true, 改动: { a: 1 }, 出处, 把握: '有把握' })).toBe('改正');
    expect(routeFound({ 找到: true, 改动: { a: 1 }, 出处: [], 把握: '有把握' })).toBe('人工');
    expect(routeFound({ 找到: true, 改动: { a: 1 }, 出处, 把握: '不确定' })).toBe('人工');
    expect(routeFound({ 找到: false })).toBe('留着');
  });
});

describe('处理', () => {
  test('错误、有把握：直接改进比赛库，留一条操作日志（原值、新值、依据、哪项检查）', async () => {
    const db = openSample();
    const result = await run(db, [check('核对原文', [{ ...错的截止, 建议改动: { registration_end: '2026-09-10' }, 把握: '有把握' }])]);
    expect(result.处理).toMatchObject({ 改正: 1, 人工: 0, 留着: 0 });
    expect(db.get('edition', 'ed-2026')).toMatchObject({ version: 2, data: { registration_end: '2026-09-10', status: '已发布' } });
    const [日志] = db.find('audit_log', { action: '维护改正' });
    expect(日志).toMatchObject({ table_name: 'edition', record_id: 'ed-2026',
      detail: { 检查项: '核对原文', 字段: 'registration_end', 原值: '2026-09-01', 新值: { registration_end: '2026-09-10' }, 依据: '官网写的是 9 月 10 日' } });
  });
  test('错误但不确定：字段不动，这一届标待人工审核，理由写明哪项检查、哪个字段、依据和建议', async () => {
    const db = openSample();
    await run(db, [check('核对原文', [{ ...错的截止, 建议改动: { registration_end: '2026-09-10' }, 把握: '不确定' }])]);
    const { data } = db.get('edition', 'ed-2026');
    expect(data).toMatchObject({ registration_end: '2026-09-01', status: '待人工审核', status_at: NOW });
    expect(data.status_reason).toEqual(['[维护·核对原文] registration_end：官网写的是 9 月 10 日（建议：{"registration_end":"2026-09-10"}）']);
  });
  test('缺失的调工具查：找到且带出处就补上；找到但没出处转人工；没找到留着不动；查找出错也留着', async () => {
    const db = openSample();
    const 缺 = 字段 => ({ table: 'edition', key: 'ed-2025', 字段, 类型: '缺失', 依据: `${字段} 没填` });
    const find = async p => ({
      participants: { 找到: true, 改动: { participants: '全日制在校本科生' }, 把握: '有把握', 出处: [{ 网址: 'https://a.cn', 原文: '参赛对象：全日制在校本科生' }] },
      fees: { 找到: true, 改动: { fees: '免费' }, 把握: '有把握', 出处: [] },
      rewards: { 找到: false, 说明: '官网和搜索都没写' },
    }[p.字段] ?? (() => { throw new Error('搜索额度用完'); })());
    const result = await run(db, [check('缺失字段', [缺('participants'), 缺('fees'), 缺('rewards'), 缺('team_size')])], { find });
    expect(result.处理).toMatchObject({ 改正: 1, 人工: 1, 留着: 2 });
    const { data } = db.get('edition', 'ed-2025');
    expect(data).toMatchObject({ participants: '全日制在校本科生', fees: null, status: '待人工审核' });
    expect(data.status_reason).toHaveLength(1);
    expect(data.status_reason[0]).toContain('[维护·缺失字段] fees');
    expect(result.留着.map(p => [p.字段, p.说明])).toEqual([['rewards', '官网和搜索都没写'], ['team_size', '查找出错：搜索额度用完']]);
  });
  test('人工改过的字段：机器有把握也不改，转人工', async () => {
    const db = openSample();
    db.update('edition', 'ed-2026', { manual_fields: ['registration_end'] }, 1);
    await run(db, [check('核对原文', [{ ...错的截止, 建议改动: { registration_end: '2026-09-10' }, 把握: '有把握' }])]);
    const { data } = db.get('edition', 'ed-2026');
    expect(data.registration_end).toBe('2026-09-01');
    expect(data.status).toBe('待人工审核');
    expect(data.status_reason[0]).toContain('人工改过这个字段');
  });
  test('比赛级字段：有把握的改在比赛上；拿不准的标在这场比赛最新的一届上', async () => {
    const db = openSample();
    const 主办方 = { table: 'competition', key: 'event-math', 字段: 'organizer', 类型: '错误', 依据: '官网写的是中国工业与应用数学学会' };
    await run(db, [check('核对原文', [{ ...主办方, 建议改动: { organizer: '中国工业与应用数学学会' }, 把握: '有把握' }])]);
    expect(db.get('competition', 'event-math').data.organizer).toBe('中国工业与应用数学学会');
    const db2 = openSample();
    await run(db2, [check('核对原文', [{ ...主办方, 建议改动: { organizer: '中国工业与应用数学学会' }, 把握: '不确定' }])]);
    expect(db2.get('edition', 'ed-2026').data.status_reason[0]).toContain('[维护·核对原文] 比赛.organizer');
    expect(db2.get('competition', 'event-math').data.organizer).toBe('错的主办方');
  });
  test('同一届的几处问题合成一次修改；再跑一遍不会重复加同一条理由', async () => {
    const db = openSample();
    const checks = [check('核对原文', [
      { ...错的截止, 建议改动: { registration_end: '2026-09-10' }, 把握: '有把握' },
      { table: 'edition', key: 'ed-2026', 字段: 'registration_url', 类型: '错误', 建议改动: { registration_url: 'https://b.cn' }, 把握: '不确定', 依据: '链接跳到了别的比赛' },
    ])];
    await run(db, checks);
    expect(db.get('edition', 'ed-2026').version).toBe(2);
    await run(db, [check('核对原文', [checks[0].run().problems[1]])]);
    expect(db.get('edition', 'ed-2026').data.status_reason).toHaveLength(1);
  });
  test('改“状态”时顺带记下状态时间（例如报名截止后自动归档）', async () => {
    const db = openSample();
    await run(db, [check('状态', [{ table: 'edition', key: 'ed-2026', 字段: 'status', 类型: '错误', 建议改动: { status: '已归档' }, 把握: '有把握', 依据: '报名 9 月 1 日已截止' }])]);
    expect(db.get('edition', 'ed-2026').data).toMatchObject({ status: '已归档', status_at: NOW });
  });
});

describe('运行', () => {
  test('检查项同时跑，一项失败或超时只记下原因；检查项拿到的比赛库只能读，读不到已删除的', async () => {
    const db = openSample();
    db.update('edition', 'ed-2025', { deleted_at: '2026-10-30T00:00:00.000Z' }, 1);
    let 看到;
    const result = await run(db, [
      check('状态', [], { run: ctx => { 看到 = { 删了的: ctx.db.get('edition', 'ed-2025'), 能写: typeof ctx.db.update === 'function' }; return { problems: [] }; } }),
      check('链接', [], { run: () => { throw new Error('网站打不开'); } }),
      check('核对原文', [], { timeoutMs: 30, run: ctx => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason))) }),
    ]);
    expect(看到).toEqual({ 删了的: null, 能写: false });
    expect(result.检查.失败.map(f => f.name).sort()).toEqual(['核对原文', '链接']);
    expect(result.检查.失败.find(f => f.name === '核对原文').error).toContain('超过时间上限');
  });
  test('问题指向的记录不存在或已删除：跳过，记在留着里', async () => {
    const db = openSample();
    const result = await run(db, [check('状态', [{ table: 'edition', key: 'ed-none', 字段: 'status', 类型: '错误', 建议改动: { status: '已归档' }, 把握: '有把握', 依据: 'x' }])]);
    expect(result.留着[0].说明).toContain('不存在或已删除');
  });
  test('试跑：照常审计和分流，比赛库不写；--only 只跑指定的检查项', async () => {
    const db = openSample();
    let 跑了别的 = false;
    const result = await run(db, [
      check('核对原文', [{ ...错的截止, 建议改动: { registration_end: '2026-09-10' }, 把握: '有把握' }]),
      check('链接', [], { run: () => { 跑了别的 = true; return { problems: [] }; } }),
    ], { dryRun: true, only: ['核对原文'] });
    expect(result.处理.改正).toBe(1);
    expect(result.commit.dryRun).toBe(true);
    expect(跑了别的).toBe(false);
    expect(db.get('edition', 'ed-2026').version).toBe(1);
  });
  test('还没写的检查项是占位：明确报“还没实现”（缺失字段 2026-11-03 已实现）', async () => {
    const 占位 = CHECKS.map(c => c.name).filter(n => n !== '缺失字段');
    const result = await runMaintenance({ db: openSample(), log: quiet, only: 占位 });
    expect(result.检查.失败.map(f => f.name).sort()).toEqual(占位.sort());
    for (const f of result.检查.失败) expect(f.error).toContain('还没实现');
  });
});

describe('目录和引用规矩', () => {
  test('每项检查都有 README.md 和 index.mjs，和审计清单一致；查找也有', () => {
    const folders = fs.readdirSync(path.join(MAINTAIN_DIR, '审计'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    expect(folders.sort()).toEqual(CHECKS.map(c => c.name).sort());
    for (const f of folders) for (const file of ['README.md', 'index.mjs']) expect(fs.existsSync(path.join(MAINTAIN_DIR, '审计', f, file)), `${f}/${file}`).toBe(true);
    for (const file of ['README.md', 'index.mjs']) expect(fs.existsSync(path.join(MAINTAIN_DIR, '处理', '查找', file))).toBe(true);
  });
  test('维护只用自己的文件和比赛库、AI 总管、读网页、程序审核、补字段的入口、共用/工具；检查项之间不互相引用；和寻找流程互不引用', () => {
    const violations = [];
    const entries = ['db/index.mjs', 'ai/index.mjs', 'web/index.mjs', '程序审核/index.mjs', '补字段/index.mjs'];
    for (const file of walk(MAINTAIN_DIR)) {
      const from = relTo(US_DIR, file);
      for (const target of importsOf(file)) {
        const to = relTo(US_DIR, target);
        if (!(to.startsWith('db/维护/') || entries.includes(to) || to.startsWith('../共用/工具/'))) violations.push(`${from} 引用了 ${to}`);
        const own = from.split('/').slice(0, 4).join('/');
        if (from.startsWith('db/维护/审计/') && to.startsWith('db/维护/') && !to.startsWith(own + '/')) violations.push(`${from} 引用了 ${to}（检查项只用自己的文件）`);
      }
    }
    for (const file of walk(path.join(US_DIR, 'pipeline'))) {
      for (const target of importsOf(file)) if (relTo(US_DIR, target).startsWith('db/维护/')) violations.push(`${relTo(US_DIR, file)} 引用了维护`);
    }
    expect(violations).toEqual([]);
  });
});
