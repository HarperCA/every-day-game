// 后台 · 屏蔽网站：照旧后台的 SiteBlocklistModule.tsx 搬（2026-11-02）。建议屏蔽、已屏蔽（内置 + 后台确认）、决定不屏蔽三块；
// 四个操作：确认屏蔽、不屏蔽、取消屏蔽、恢复。规则和存放在比赛库的 屏蔽网站.*，这里只管什么时候调。用内存里的比赛库。
import { describe, expect, test } from 'vitest';
import { open } from '../../../../../../db/test/复用/样例数据.mjs';
import { 屏蔽网站 } from '../../../../../../db/index.mjs';
import { 处理后台请求 } from '../../../../../接口.mjs';
import { 整理 } from '../../整理.mjs';

const now = () => new Date('2026-11-02T01:00:00Z');
const 读 = (db, 参数 = {}) => 处理后台请求('屏蔽网站', 参数, { db, now });
function 有建议的库() {
  const db = open();
  屏蔽网站.写建议(db, { suggestions: [
    { host: 'eol.cn', refs: 176, candidates: 176, reason: '近 9 晚出现 176 次', firstSeen: '2026-10-20', lastSeen: '2026-11-01', samples: [{ title: '高考志愿', url: 'https://eol.cn/1' }] },
    { host: 'gk100.com', refs: 49, candidates: 49, reason: '近 9 晚出现 49 次', firstSeen: '2026-10-21', lastSeen: '2026-10-31', samples: [] },
  ], runs: 9, minRefs: 15, windowDays: 30 }, { now });
  return db;
}

describe('取数据和操作', () => {
  test('没给操作：交回现在的名单（内置的直接显示，不用等统计）', async () => {
    const r = await 读(open());
    expect(r).toMatchObject({ blocked: [], suggestions: [], dismissed: [], generatedAt: '', 结果: null });
    expect(r.builtin).toHaveLength(9);
  });
  test('确认屏蔽、不屏蔽、取消屏蔽、恢复：存进比赛库，交回新的名单和刚做的操作', async () => {
    const db = 有建议的库();
    let r = await 读(db, { host: 'eol.cn', decision: 'block' });
    expect(r.blocked).toEqual([{ host: 'eol.cn', reason: '近 9 晚出现 176 次', decidedAt: '2026-11-02T01:00:00.000Z', evidence: { refs: 176, candidates: 176, generatedAt: '2026-11-02T01:00:00.000Z' } }]);
    expect(r.结果).toEqual({ host: 'eol.cn', decision: 'block' });
    r = await 读(db, { host: 'gk100.com', decision: 'dismiss' });
    expect(r.suggestions).toEqual([]);
    expect(r.dismissed.map(x => x.host)).toEqual(['gk100.com']);
    expect(屏蔽网站.当前屏蔽(db)).toContain('eol.cn');
    r = await 读(db, { host: 'eol.cn', decision: 'unblock' });
    expect(r.blocked).toEqual([]);
    r = await 读(db, { host: 'gk100.com', decision: 'restore' });
    expect(r.dismissed).toEqual([]);
  });
  test('不能做的操作报中文原因', async () => {
    await expect(读(open(), { host: 'zhihu.com', decision: 'block' })).rejects.toThrow('已经在内置名单里');
    await expect(读(open(), { host: 'x', decision: 'block' })).rejects.toThrow('不是网站域名');
    await expect(读(open(), { host: 'a.cn', decision: 'unblock' })).rejects.toThrow('没有屏蔽');
    await expect(读(open(), { host: 'a.cn', decision: 'delete' })).rejects.toThrow('不认识的操作');
  });
});

describe('整理', () => {
  test('统计时间写北京时间；出现的日期只留日期；各块几个；刚做的操作给一句提示', async () => {
    const db = 有建议的库();
    const r = 整理(await 读(db, { host: 'eol.cn', decision: 'block' }));
    expect(r.统计说明).toBe('统计于 2026-11-02 09:00：近 30 天 9 晚的搜索结果里，出现 15 次以上、一次都没被放行去读详情、也没追溯出官方来源的网站。学校网站（edu.cn）和库里比赛的来源网站不列。');
    expect(r.建议们).toEqual([{ host: 'gk100.com', 次数: 49, 期间: '2026-10-21 ～ 2026-10-31', 情况: '近 9 晚出现 49 次', 例子: [] }]);
    expect(r.已屏蔽们[0]).toEqual({ host: 'eol.cn', 来源: '后台确认', 时间: '2026-11-02 09:00', 原因: '近 9 晚出现 176 次', 能取消: true });
    expect(r.已屏蔽们.filter(x => x.来源 === '内置')).toHaveLength(9);
    expect(r.提示).toBe('已屏蔽 eol.cn，下一次搜索起生效');
  });
  test('还没统计过', async () => {
    expect(整理(await 读(open())).统计说明).toBe('还没有统计过，每周一 09:00 自动统计。');
  });
});
