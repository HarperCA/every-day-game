// 北京主数据库：美国比赛库里已公开比赛、届次的只读副本。同步只收美国推来的新版本；读取工具把比赛和届次合成一条给排序和详情用。
// 用内存里的库跑，不碰任何真实库文件。
import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { openMainDb, 公开, 同步 } from '../../index.mjs';
import { buildMainSql, FIRST_FILE } from '../../结构/生成.mjs';

const at = '2026-11-01T04:00:00.000Z';
const open = () => openMainDb({ file: ':memory:', now: () => new Date(at) });

const 数学 = { id: 'event-math', version: 3, name: '全国大学生数学建模竞赛', level: '国家级', data: { aliases: ['国赛数模'], professions: ['数学与统计'], organizer: '数学会', region: null } };
const 艺术 = { id: 'event-art', version: 1, name: '省大学生艺术展演', level: '省级/区域级', data: { professions: ['设计与艺术'], region: '浙江省' } };
const 数学26 = { id: 'ed-math-2026', competition_id: 'event-math', version: 5, registration_start: '2026-09-01', registration_end: '2026-11-10', status: '已发布',
  data: { edition_name: '2026 年数学建模', fee_type: '收费', recommendation: { recommendation: '强烈推荐' } } };
const 数学25 = { id: 'ed-math-2025', competition_id: 'event-math', version: 2, registration_start: '2025-09-01', registration_end: '2025-09-10', status: '已归档',
  data: { edition_name: '2025 年数学建模', level: '省级/区域级' } };
const 艺术26 = { id: 'ed-art-2026', competition_id: 'event-art', version: 1, registration_end: '2026-12-01', status: '已发布', data: { edition_name: '第八届艺术展演', organizer: '省文旅厅' } };

function 准备() {
  const db = open();
  同步.收下(db, { 比赛们: [数学, 艺术], 届次们: [数学26, 数学25, 艺术26] });
  return db;
}

describe('建库', () => {
  test('001-建表.sql 和按描述生成的一致；只有公开比赛、公开届次两张表', () => {
    expect(fs.readFileSync(FIRST_FILE, 'utf8')).toBe(buildMainSql());
    const db = open();
    expect(db.count('public_edition')).toBe(0);
    expect(() => db.count('user_account')).toThrow('没有这张表');
  });
});

describe('同步：收下美国推来的一批', () => {
  test('新的就加，记下美国的版本号和同步时间', () => {
    const db = open();
    expect(同步.收下(db, { 比赛们: [数学], 届次们: [数学26] }, { now: new Date(at) })).toEqual({ 新增: 2, 更新: 0, 跳过: 0, 下架: 0, 海报: 0 });
    expect(db.get('public_edition', 'ed-math-2026').data).toMatchObject({ source_version: 5, synced_at: at, status: '已发布', registration_end: '2026-11-10' });
  });
  test('版本号更大才覆盖；一样或更小的跳过（推送重复、乱序都不会改回旧的）', () => {
    const db = 准备();
    const 改过 = { ...数学26, version: 6, registration_end: '2026-11-15' };
    expect(同步.收下(db, { 届次们: [改过, { ...数学25, version: 1 }, 艺术26] })).toEqual({ 新增: 0, 更新: 1, 跳过: 2, 下架: 0, 海报: 0 });
    expect(db.get('public_edition', 'ed-math-2026').data.registration_end).toBe('2026-11-15');
  });
  test('整体重推时带 同版本也覆盖：版本号一样也覆盖（美国白名单改了、两边走样时能改回来），更小的仍然跳过', () => {
    const db = 准备();
    db.update('public_edition', 'ed-math-2026', { data: { edition_name: '被改坏了' } });
    expect(同步.收下(db, { 届次们: [数学26, { ...数学25, version: 1 }], 同版本也覆盖: true })).toMatchObject({ 更新: 1, 跳过: 1 });
    expect(db.get('public_edition', 'ed-math-2026').data.data.edition_name).toBe('2026 年数学建模');
  });
  test('下架届次只删这一届；下架比赛连同它的届次一起删；不存在的不报错', () => {
    const db = 准备();
    expect(同步.收下(db, { 下架届次: ['ed-math-2025', 'ed-none'] })).toMatchObject({ 下架: 1 });
    expect(同步.收下(db, { 下架比赛: ['event-math'] })).toMatchObject({ 下架: 1 });
    expect(db.count('public_edition')).toBe(1);
    expect(db.count('public_competition')).toBe(1);
  });
  test('只收已发布、已归档的；届次指向的比赛不在这一批也不在库里的，整批不收', () => {
    const db = open();
    expect(() => 同步.收下(db, { 比赛们: [数学], 届次们: [{ ...数学26, status: '待人工审核' }] })).toThrow(expect.objectContaining({ kind: '校验不通过' }));
    expect(() => 同步.收下(db, { 届次们: [艺术26] })).toThrow(expect.objectContaining({ kind: '指向的记录不存在' }));
    expect(db.count('public_competition')).toBe(0);
  });
});

describe('读取工具', () => {
  test('全部条目：每一届和它的比赛合成一条（id 是届次编号），级别、主办方届次没填的用比赛的', () => {
    const db = 准备();
    const 条目们 = 公开.全部条目(db);
    expect(条目们.map(条 => 条.id).sort()).toEqual(['ed-art-2026', 'ed-math-2025', 'ed-math-2026']);
    expect(条目们.find(条 => 条.id === 'ed-math-2026')).toMatchObject({
      competition_id: 'event-math', name: '全国大学生数学建模竞赛', edition_name: '2026 年数学建模', aliases: ['国赛数模'], professions: ['数学与统计'],
      level: '国家级', organizer: '数学会', registration_start: '2026-09-01', registration_end: '2026-11-10', status: '已发布', fee_type: '收费',
    });
    expect(条目们.find(条 => 条.id === 'ed-math-2025').level).toBe('省级/区域级');
    expect(条目们.find(条 => 条.id === 'ed-art-2026').organizer).toBe('省文旅厅');
  });
  test('按编号取一届、一个比赛；比赛下的届次；没有的给 null', () => {
    const db = 准备();
    expect(公开.届次(db, 'ed-art-2026')).toMatchObject({ id: 'ed-art-2026', name: '省大学生艺术展演', region: '浙江省' });
    expect(公开.届次(db, 'ed-none')).toBeNull();
    expect(公开.比赛(db, 'event-math')).toMatchObject({ id: 'event-math', name: '全国大学生数学建模竞赛', aliases: ['国赛数模'] });
    expect(公开.比赛(db, 'event-none')).toBeNull();
    expect(公开.比赛的届次(db, 'event-math').map(条 => 条.id).sort()).toEqual(['ed-math-2025', 'ed-math-2026']);
  });
});
