// 每日补缺失（2026-11-03 用户定）：缺失字段交给 Codex 补字段很费 Codex 和搜索额度，所以不走每 5 分钟一个比赛的轮流，
// 而是每天跑一次，挑最有用的 20 个先补：已发布、报名还没截止 → 其他已发布 → 已归档；7 天内查过的跳过。
// 另外：补到一部分、但已发布且报名没截止的这一届仍缺报名时间的，补到的照写，同时转人工审核。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb } from '../../../../index.mjs';
import { 挑要补的, 每日补缺失 } from '../../index.mjs';

const NOW = new Date('2026-11-03T02:00:00.000Z');
const quiet = { info() {}, warn() {}, error() {}, child() { return quiet; } };
const 官网 = 'https://org.cn/notice.html';
const 官网正文 = ['主办单位：中国工业与应用数学学会', '参赛费用：每队报名费100元。', '奖励：颁发获奖证书。'].join('\n') + '说明'.repeat(120);
let 目录;
beforeEach(() => { 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '补缺失-')); });
afterEach(() => fs.rmSync(目录, { recursive: true, force: true }));

function 样例库() {
  const db = openDb({ file: ':memory:', now: () => NOW });
  db.transaction(tx => {
    const 比赛 = id => tx.insert('competition', id, { name: `比赛${id}`, level: '国家级', organizer: '某学会', professions: ['数学与统计'] });
    const 齐 = { participants: '在校大学生', format_and_rules: '写论文', competition_start: '2026-12-01', competition_end: '2026-12-02', registration_url: 'https://a.cn', registration_method: '网上', rewards: '证书' };
    比赛('c-archived'); tx.insert('edition', 'e-archived', { competition_id: 'c-archived', ordinal: 1, edition_name: '旧的', status: '已归档', ...齐, registration_start: '2025-01-01', registration_end: '2025-02-01' });
    比赛('c-closed'); tx.insert('edition', 'e-closed', { competition_id: 'c-closed', ordinal: 1, edition_name: '截止了', status: '已发布', ...齐, registration_start: '2026-09-01', registration_end: '2026-10-01' });
    比赛('c-open'); tx.insert('edition', 'e-open', { competition_id: 'c-open', ordinal: 1, edition_name: '报名中', status: '已发布', ...齐, registration_start: '2026-10-01', registration_end: '2026-12-01' });
    比赛('c-notime'); tx.insert('edition', 'e-notime', { competition_id: 'c-notime', ordinal: 1, edition_name: '没时间', status: '已发布', ...齐 });
  });
  return db;
}
// 每个届次都缺费用；e-notime 还缺报名时间。假 Codex 按每段对话自己的轮次回：第一轮读官网，之后给同一个结论（几条同时查也不会串）
const 环境 = (db, 结论 = { 字段们: [] }) => ({
  db, log: quiet, now: () => NOW, 状态文件: path.join(目录, '补缺失状态.json'),
  ai: { chat: async ({ messages }) => ({ data: messages.length <= 2 ? { 动作: '读网页', 网址: 官网 } : { 动作: '结论', 结论: { 理由: '读了', 待公布: [], ...结论 } } }), search: async () => ({ references: [] }), 报告问题() {} },
  web: { 读网页: async 网址 => (网址 === 官网 ? { status: '成功', text: 官网正文, links: [] } : { status: '打不开', error: '404' }) },
});

describe('挑要补的：按用处排，7 天内查过的跳过，最多 上限 个', () => {
  test('已发布且报名没截止（含没写截止的）→ 其他已发布 → 已归档；同一档里缺报名时间的排前面', () => {
    const db = 样例库();
    const 问题们 = ['e-archived', 'e-closed', 'e-open', 'e-notime'].map(key => ({ table: 'edition', key, 字段们: key === 'e-notime' ? ['registration_start', 'registration_end', 'fees'] : ['fees'] }));
    expect(挑要补的(问题们, db, NOW, {}, 20).map(p => p.key)).toEqual(['e-notime', 'e-open', 'e-closed', 'e-archived']);
    expect(挑要补的(问题们, db, NOW, {}, 2).map(p => p.key)).toEqual(['e-notime', 'e-open']);
    const 查过 = { 'edition:e-notime': '2026-10-30T00:00:00.000Z', 'edition:e-open': '2026-10-20T00:00:00.000Z' };
    expect(挑要补的(问题们, db, NOW, 查过, 20).map(p => p.key)).toEqual(['e-open', 'e-closed', 'e-archived']);   // e-notime 4 天前查过，跳过
  });
  test('比赛级的问题：按这个比赛有没有报名中的已发布届次排', () => {
    const db = 样例库();
    const 问题们 = [{ table: 'competition', key: 'c-archived', 字段们: ['organizer'] }, { table: 'competition', key: 'c-open', 字段们: ['organizer'] }];
    expect(挑要补的(问题们, db, NOW, {}, 20).map(p => p.key)).toEqual(['c-open', 'c-archived']);
  });
});

describe('每日补缺失', () => {
  test('只补挑出来的：写进比赛库、记下查过的时间；没挑上的不动', async () => {
    const db = 样例库();
    const 费用 = { 字段们: [{ 字段: 'fees', 值: '每队报名费100元', 网址: 官网, 原文: '参赛费用：每队报名费100元。' }] };
    const 结果 = await 每日补缺失({ ...环境(db, 费用), 上限: 2 });
    expect(结果.挑了.map(x => x.key)).toEqual(['e-notime', 'e-open']);
    expect(db.get('edition', 'e-open').data.fees).toBe('每队报名费100元');
    expect(db.get('edition', 'e-closed').data.fees ?? null).toBeNull();
    const 状态 = JSON.parse(fs.readFileSync(path.join(目录, '补缺失状态.json'), 'utf8'));
    expect(Object.keys(状态.上次查过).sort()).toEqual(['edition:e-notime', 'edition:e-open']);
  });
  test('补到一部分、但已发布且报名没截止的这一届仍缺报名时间：补到的照写，同时转人工审核', async () => {
    const db = 样例库();
    const 费用 = { 字段们: [{ 字段: 'fees', 值: '每队报名费100元', 网址: 官网, 原文: '参赛费用：每队报名费100元。' }] };
    await 每日补缺失({ ...环境(db, 费用), 上限: 1 });
    const 届 = db.get('edition', 'e-notime').data;
    expect(届.fees).toBe('每队报名费100元');
    expect(届.status).toBe('待人工审核');
    expect(届.status_reason.at(-1)).toMatch('已发布、报名还没截止，却补不到报名时间');
  });
  test('试跑：照样挑、照样问 Codex，但不写比赛库、不记查过的时间', async () => {
    const db = 样例库();
    const 结果 = await 每日补缺失({ ...环境(db), 上限: 1, 试跑: true });
    expect(结果.挑了).toHaveLength(1);
    expect(fs.existsSync(path.join(目录, '补缺失状态.json'))).toBe(false);
  });
});
