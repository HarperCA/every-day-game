// 新维护的调度（2026-11-07 用户定）：按“离预计报名时间还有多久”决定多久查一次。
//   窗口外（4 个月以上）每 3 个月；2–4 个月每月；半个月–2 个月每半月；半个月以内每周；
//   过了预计时间还没发现：过了半个月以内每周，半个月–3 个月每月，3 个月以上每 3 个月；
//   正在报名中每月；没有预计时间每月。
// 一个月按 30 天、半个月 15 天、3 个月 90 天、4 个月 120 天算。
import { describe, expect, test } from 'vitest';
import { open } from '../../../test/复用/样例数据.mjs';
import { 检查频率, 下次检查, 挑要查的 } from '../../调度/index.mjs';

const NOW = new Date('2026-11-07T04:00:00.000Z');   // 北京时间 11-07 12:00
const 天 = 24 * 60 * 60 * 1000;
const 天后 = n => new Date(NOW.getTime() + n * 天).toISOString();
const 届 = (字段, ordinal = 1) => ({ id: `ed-${ordinal}`, competition_id: 'c', ordinal, edition_name: `第${ordinal}届`, status: '已发布', ...字段 });
// 上一届已截止，存着下一届预计
const 已截止且预计在 = n => [届({ registration_start: 天后(-400), registration_end: 天后(-380), next_edition_estimate: 天后(n), status: '已归档' })];

describe('检查频率：还没到预计报名时间', () => {
  test.each([
    [150, '窗口外', '每3个月', 90],
    [121, '窗口外', '每3个月', 90],
    [120, '2到4个月', '每月', 30],
    [61, '2到4个月', '每月', 30],
    [60, '半个月到2个月', '每半月', 15],
    [16, '半个月到2个月', '每半月', 15],
    [15, '半个月内', '每周', 7],
    [1, '半个月内', '每周', 7],
    [0, '半个月内', '每周', 7],
  ])('还有 %i 天 → %s、%s', (n, 情况, 频率, 间隔天数) => {
    expect(检查频率(已截止且预计在(n), NOW)).toEqual({ 情况, 频率, 间隔天数, 预计报名: 天后(n) });
  });
  test('这一届报名开始时间还没到：按报名开始算', () => {
    expect(检查频率([届({ registration_start: 天后(150), registration_end: 天后(180) })], NOW))
      .toEqual({ 情况: '窗口外', 频率: '每3个月', 间隔天数: 90, 预计报名: 天后(150) });
  });
});

describe('检查频率：过了预计时间还没发现新一届', () => {
  test.each([
    [-5, '过期半个月内', '每周', 7],
    [-15, '过期半个月内', '每周', 7],
    [-16, '过期半个月到3个月', '每月', 30],
    [-90, '过期半个月到3个月', '每月', 30],
    [-91, '过期3个月以上', '每3个月', 90],
    [-300, '过期3个月以上', '每3个月', 90],
  ])('过了 %i 天 → %s、%s', (n, 情况, 频率, 间隔天数) => {
    expect(检查频率(已截止且预计在(n), NOW)).toEqual({ 情况, 频率, 间隔天数, 预计报名: 天后(n) });
  });
});

describe('检查频率：报名中、没有预计时间', () => {
  const 报名中 = { 情况: '报名中', 频率: '每月', 间隔天数: 30, 预计报名: null };
  const 没有 = { 情况: '没有预计时间', 频率: '每月', 间隔天数: 30, 预计报名: null };
  test('报名开始已过、截止没到 → 报名中', () => {
    expect(检查频率([届({ registration_start: 天后(-10), registration_end: 天后(10) })], NOW)).toEqual(报名中);
  });
  test('只写日期的截止算到当天 23:59:59（北京时间）：截止当天还是报名中', () => {
    expect(检查频率([届({ registration_start: '2026-10-01', registration_end: '2026-11-07' })], NOW)).toEqual(报名中);
  });
  test('没写开始、截止没到 → 报名中', () => {
    expect(检查频率([届({ registration_end: 天后(10) })], NOW)).toEqual(报名中);
  });
  test('开始已过、没写截止、比赛还没结束 → 报名中', () => {
    expect(检查频率([届({ registration_start: 天后(-10), competition_end: 天后(30) })], NOW)).toEqual(报名中);
  });
  test('人工指定报名中 → 报名中', () => {
    expect(检查频率([届({ status_override: '报名中' })], NOW)).toEqual(报名中);
  });
  test('没有届次、届次里一个时间都没有 → 没有预计时间', () => {
    expect(检查频率([], NOW)).toEqual(没有);
    expect(检查频率([届({ pending_announcement: true })], NOW)).toEqual(没有);
  });
  test('时间写错了的当作没写', () => {
    expect(检查频率([届({ registration_start: '2026-13-45', registration_end: '不知道' })], NOW)).toEqual(没有);
  });
});

describe('检查频率：已截止的届次怎么推下一届', () => {
  test('没存下一届预计：报名开始往后推 365 天', () => {
    // 2025-11-20 北京时间 0 点 + 365 天 = 2026-11-20 北京时间 0 点，离现在 12.5 天
    expect(检查频率([届({ registration_start: '2025-11-20', registration_end: '2025-12-20' })], NOW))
      .toEqual({ 情况: '半个月内', 频率: '每周', 间隔天数: 7, 预计报名: '2026-11-19T16:00:00.000Z' });
  });
  test('已归档但缺截止：用历届报名周期推算，按实际届数处理缺失届次', () => {
    const 届次们 = [
      届({ registration_start: 天后(-540), edition_ordinal: '第十届', status: '已归档' }, 1),
      届({ registration_start: 天后(-170), edition_ordinal: '第十二届', status: '已归档',
        next_edition_estimate: 天后(195) }, 2),
    ];
    expect(下次检查({ last_maintained_at: 天后(-8) }, 届次们, NOW)).toMatchObject({
      预计报名: 天后(15), 距报名天数: 15, 频率: '每周', 到期: true,
    });
  });
  test('没有报名开始用比赛开始推', () => {
    expect(检查频率([届({ registration_end: '2025-12-20', competition_start: '2025-11-20' })], NOW).预计报名).toBe('2026-11-19T16:00:00.000Z');
  });
  test('人工指定已截止：截止没到也按已截止推', () => {
    expect(检查频率([届({ registration_start: '2025-11-20', registration_end: 天后(10), status_override: '已截止' })], NOW).情况).toBe('半个月内');
  });
  test('开始已过、没写截止、比赛已结束 → 已截止', () => {
    expect(检查频率([届({ registration_start: '2025-11-20', competition_end: 天后(-1) })], NOW).情况).toBe('半个月内');
  });
  test('以最新一届为准（ordinal 最大），不看上一届', () => {
    const 届次们 = [届({ registration_start: 天后(-10), registration_end: 天后(10) }, 1), 届({ registration_start: 天后(150) }, 2)];
    expect(检查频率(届次们, NOW).情况).toBe('窗口外');
  });
  test('最新一届一个时间都没有：用上一届推', () => {
    const 届次们 = [届({ registration_start: '2025-11-20', registration_end: '2025-12-20' }, 1), 届({}, 2)];
    expect(检查频率(届次们, NOW).预计报名).toBe('2026-11-19T16:00:00.000Z');
  });
  test('已删除的届次不算', () => {
    const 届次们 = [届({ registration_start: 天后(150) }, 1), 届({ registration_start: 天后(-10), registration_end: 天后(10), deleted_at: 天后(-1) }, 2)];
    expect(检查频率(届次们, NOW).情况).toBe('窗口外');
  });
});

describe('下次检查：按上次检查时间加间隔', () => {
  const 每周的 = 已截止且预计在(5);
  test('从没查过 → 马上查', () => {
    expect(下次检查({ id: 'c' }, 每周的, NOW)).toMatchObject({ 上次检查: null, 下次检查: null, 到期: true });
  });
  test('每周：8 天前查过到期，7 天前刚好到期，6 天前没到期', () => {
    expect(下次检查({ last_maintained_at: 天后(-8) }, 每周的, NOW)).toMatchObject({ 到期: true, 下次检查: 天后(-1) });
    expect(下次检查({ last_maintained_at: 天后(-7) }, 每周的, NOW).到期).toBe(true);
    expect(下次检查({ last_maintained_at: 天后(-6) }, 每周的, NOW)).toMatchObject({ 到期: false, 下次检查: 天后(1), 上次检查: 天后(-6) });
  });
  test('带上频率', () => {
    expect(下次检查({ last_maintained_at: 天后(-6) }, 每周的, NOW)).toMatchObject({ 情况: '半个月内', 频率: '每周', 间隔天数: 7, 预计报名: 天后(5) });
  });
});

describe('挑要查的（读比赛库）', () => {
  function 准备() {
    const db = open();
    db.transaction(tx => {
      const 比赛 = (id, last) => tx.insert('competition', id, { name: `比赛${id}`, level: '国家级', last_maintained_at: last });
      const 一届 = (id, 比赛id, 字段) => tx.insert('edition', id, { competition_id: 比赛id, ordinal: 1, edition_name: `${比赛id}届`, ...字段 });
      比赛('a-周', 天后(-8));      一届('ea', 'a-周', { registration_end: 天后(-380), next_edition_estimate: 天后(5) });
      比赛('b-月', 天后(-40));     一届('eb', 'b-月', { registration_start: 天后(-5), registration_end: 天后(20) });
      比赛('c-没到', 天后(-3));    一届('ec', 'c-没到', { registration_end: 天后(-380), next_edition_estimate: 天后(5) });
      比赛('d-从没查', null);      一届('ed', 'd-从没查', { registration_start: 天后(150) });
      比赛('e-3月', 天后(-100));   一届('ee', 'e-3月', { registration_start: 天后(150) });
      比赛('f-周更久', 天后(-20)); 一届('ef', 'f-周更久', { registration_end: 天后(-380), next_edition_estimate: 天后(-3) });
      比赛('g-删了', null);        一届('eg', 'g-删了', { registration_start: 天后(10) });
    });
    db.transaction(tx => tx.update('competition', 'g-删了', { deleted_at: 天后(-1) }, tx.get('competition', 'g-删了').version));
    return db;
  }
  test('只挑到期的；间隔短的先查，同样间隔的越早该查的越先（从没查过的最先）；已删除的不挑', () => {
    expect(挑要查的(准备(), { now: NOW }).map(x => x.比赛)).toEqual(['f-周更久', 'a-周', 'b-月', 'd-从没查', 'e-3月']);
  });
  test('上限', () => {
    expect(挑要查的(准备(), { now: NOW, 上限: 2 }).map(x => x.比赛)).toEqual(['f-周更久', 'a-周']);
  });
  test('每项带名称和频率', () => {
    expect(挑要查的(准备(), { now: NOW })[0]).toEqual({
      比赛: 'f-周更久', 名称: '比赛f-周更久', 情况: '过期半个月内', 频率: '每周', 间隔天数: 7,
      预计报名: 天后(-3), 距报名天数: -3, 上次检查: 天后(-20), 下次检查: 天后(-13), 到期: true,
    });
  });
});
