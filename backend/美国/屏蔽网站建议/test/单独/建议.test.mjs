// 每周统计建议屏蔽的网站：搬自 scripts/server/site-block-suggest.mjs（2026-11-02），统计规则不变，旧测试 tests/site-blocklist.test.mjs 的用例照搬。
// 换的只有输入：旧的读 runs/ 里的 baidu-candidates.json 等文件，新的读每晚的 run.db（pipeline/小数据库 的 读候选网站）。
// 新的 01 不记“搜索时就筛掉的结果”，所以只统计候选：出现次数就是进入判重的次数。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { open, seed } from '../../../db/test/复用/样例数据.mjs';
import { 屏蔽网站 } from '../../../db/index.mjs';
import { openRunDb } from '../../../pipeline/小数据库/index.mjs';
import { openSqlite } from '../../../../共用/工具/sqlite.mjs';
import { MIN_REFS, WINDOW_DAYS, buildSuggestions, sourceHosts, 每周统计 } from '../../index.mjs';

const { BUILTIN_HOSTS } = 屏蔽网站;
const 候选 = (url, extra = {}) => ({ 网址: url, 名称: `${new URL(url).hostname} 标题`, 读了详情: false, 追溯了: false, 追溯找到: false, ...extra });
const many = (host, n, extra = {}) => Array.from({ length: n }, (_, i) => 候选(`https://${host}/a/${i}`, { 名称: `${host} 标题${i}`, ...extra }));

describe('每周统计建议屏蔽的网站', () => {
  it('默认看近 30 天、出现 15 次以上（和旧的一样）', () => {
    expect([WINDOW_DAYS, MIN_REFS]).toEqual([30, 15]);
  });
  it('出现够多、从没被放行或追溯成功的才建议', () => {
    const runs = [
      { id: '2026-10-11', 候选们: [...many('eol.cn', 10), ...many('hncci.com', 9), 候选('https://hncci.com/c1', { 读了详情: true }), ...many('few.cn', 3),
        ...many('traced.org', 9), 候选('https://traced.org/n1', { 追溯了: true, 追溯找到: true })] },
      { id: '2026-10-12', 候选们: [...many('eol.cn', 8), ...many('hncci.com', 8), ...many('traced.org', 8)] },
    ];
    const list = buildSuggestions(runs, { minRefs: 15 });
    expect(list.map(item => item.host)).toEqual(['eol.cn']);
    expect(list[0]).toMatchObject({ refs: 18, candidates: 18, firstSeen: '2026-10-11', lastSeen: '2026-10-12' });
    expect(list[0].samples).toHaveLength(3);
    expect(list[0].reason).toBe('近 2 晚出现 18 次，进入判重 18；没有一次被放行去读详情');
  });
  it('交给追溯过但都没找到官方来源的，原因里写明', () => {
    const list = buildSuggestions([{ id: '2026-10-12', 候选们: many('news.cn', 16, { 追溯了: true }) }], { minRefs: 15 });
    expect(list[0].reason).toBe('近 1 晚出现 16 次，进入判重 16；没有一次被放行去读详情，交给通知追溯 16 次也没找到官方来源');
  });
  it('已屏蔽、已忽略、学校网站、库里赛事的来源网站不建议', () => {
    const runs = [{ id: '2026-10-11', 候选们: [...many('baike.baidu.com', 20), ...many('gk100.com', 20), ...many('chem.whu.edu.cn', 20), ...many('cie.org.cn', 20), ...many('zsb.eol.cn', 20)] }];
    const protectedHosts = new Set(['cie.org.cn']);
    const list = buildSuggestions(runs, { blocked: [...BUILTIN_HOSTS, 'eol.cn'], dismissed: [{ host: 'gk100.com' }], protectedHosts, minRefs: 15 });
    expect(list).toEqual([]);
  });
  it('库里赛事的来源网站：比赛官网、报名入口、来源网址', () => {
    const db = open(); seed(db);
    db.transaction(tx => {
      tx.insert('competition', 'event-x', { name: '某某竞赛', level: '国家级', website: 'https://www.cie.org.cn/' });
      tx.insert('source', 'src-x', { edition_id: 'ed-math-2026', url: 'https://www.mcm.edu.cn/notice', source_type: 'organizer_website' });
      tx.update('edition', 'ed-math-2026', { registration_url: 'https://reg.example.com/x' }, db.get('edition', 'ed-math-2026').version);
    });
    const hosts = sourceHosts(db);
    for (const h of ['cie.org.cn', 'mcm.edu.cn', 'reg.example.com']) expect(hosts.has(h)).toBe(true);
  });
});

describe('每周统计：读几晚、算建议、写进比赛库', () => {
  const 临时 = [];
  afterEach(() => { while (临时.length) fs.rmSync(临时.pop(), { recursive: true, force: true }); });
  function 一晚(根, 名, urls) {
    fs.mkdirSync(path.join(根, 名));
    openRunDb(path.join(根, 名, 'run.db'), { runId: 名 }).close();
    fs.writeFileSync(path.join(根, 名, 'report.md'), '- 方式：正式运行\n');
    const db = openSqlite(path.join(根, 名, 'run.db'));
    const ins = db.prepare("INSERT INTO items (key, kind, status, stage, data, created_by, updated_at) VALUES (?, 'candidate', '已丢弃', '03-filter', ?, '01-search', 'x')");
    for (const url of urls) ins.run(url, JSON.stringify({ url, name: '标题' }));
    db.close();
  }
  it('写进比赛库的屏蔽网站状态，后台“屏蔽网站”页就能看到；试跑（dryRun）不写', async () => {
    const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
    临时.push(根);
    一晚(根, '2026-10-31', Array.from({ length: 10 }, (_, i) => `https://eol.cn/${i}`));
    一晚(根, '2026-11-01', Array.from({ length: 6 }, (_, i) => `https://eol.cn/b${i}`));
    const db = open();
    const now = () => new Date('2026-11-02T01:00:00Z');
    const 试跑 = await 每周统计({ db, 根, now, dryRun: true });
    expect(试跑).toMatchObject({ runs: 2, suggestions: [{ host: 'eol.cn', refs: 16 }], 写了: false });
    expect(屏蔽网站.读状态(db).suggestions).toEqual([]);
    const 正式 = await 每周统计({ db, 根, now });
    expect(正式).toMatchObject({ 写了: true, 已写: { suggestions: 1, blocked: 0 } });
    expect(屏蔽网站.读状态(db)).toMatchObject({ runs: 2, minRefs: 15, windowDays: 30, generatedAt: '2026-11-02T01:00:00.000Z', suggestions: [{ host: 'eol.cn', refs: 16 }] });
  });
});
