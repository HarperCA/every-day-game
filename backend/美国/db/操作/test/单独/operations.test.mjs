// 操作：写入、读入、筛选、用户。用内存里的库跑，不碰任何真实库文件。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../test/复用/样例数据.mjs';
import { DbError, openDb, 比赛, 届次 } from '../../../index.mjs';

describe('写入', () => {
  test('新增：补上默认值、版本号 1、建立时间', () => {
    const db = open(); seed(db);
    const { version, data } = db.get('edition', 'ed-art-next');
    expect(version).toBe(1);
    expect(data).toMatchObject({ participation_format: '暂未明确', fee_type: '暂未公布', status: '待人工审核', pending_announcement: false, created_at: '2026-10-29T12:00:00.000Z' });
  });
  test('校验不通过：报出每个字段的问题，什么都不写', () => {
    const db = open();
    let error;
    try {
      db.insert('competition', 'event-bad', { name: 'x'.repeat(201), level: '世界级', website: 'ftp://a', 颜色: '红' });
    } catch (e) { error = e; }
    expect(error).toBeInstanceOf(DbError);
    expect(error.kind).toBe('校验不通过');
    expect(error.problems.map(p => `${p.field}:${p.rule}`).sort()).toEqual(['level:可选值', 'name:太长', 'website:类型', '颜色:未知字段']);
    expect(db.count('competition')).toBe(0);
  });
  test('必填没填、时间格式不对、非文字字段填空字符串都会被拒绝', () => {
    const db = open(); seed(db);
    expect(() => db.insert('edition', 'ed-x', { competition_id: 'event-math', ordinal: 9 })).toThrow('edition_name');
    expect(() => db.insert('edition', 'ed-y', { competition_id: 'event-math', ordinal: 9, edition_name: 'y', registration_end: '2026/10/01' })).toThrow('registration_end');
    expect(() => db.insert('edition', 'ed-z', { competition_id: 'event-math', ordinal: 9, edition_name: 'z', registration_url: '' })).toThrow('空字符串');
  });
  test('重复新增、同一比赛届次顺序重复：报“已存在”', () => {
    const db = open(); seed(db);
    expect(() => db.insert('competition', 'event-math', { name: 'a', level: '国家级' })).toThrow(expect.objectContaining({ kind: '已存在' }));
    expect(() => db.insert('edition', 'ed-dup', { competition_id: 'event-math', ordinal: 1, edition_name: 'dup' })).toThrow(expect.objectContaining({ kind: '已存在' }));
  });
  test('指向的比赛不存在：报“指向的记录不存在”', () => {
    const db = open();
    expect(() => db.insert('edition', 'ed-orphan', { competition_id: 'event-none', ordinal: 1, edition_name: 'x' })).toThrow(expect.objectContaining({ kind: '指向的记录不存在' }));
  });
  test('修改：合并到原记录、版本号加一；拿旧版本号再改报“版本冲突”', () => {
    const db = open(); seed(db);
    const first = db.update('edition', 'ed-art-next', { registration_end: '2027-10-31T00:00:00+08:00' }, 1);
    expect(first.version).toBe(2);
    expect(first.data.edition_name).toBe('第九届艺术展演');
    expect(() => db.update('edition', 'ed-art-next', { edition_name: '改' }, 1)).toThrow(expect.objectContaining({ kind: '版本冲突' }));
    expect(() => db.update('edition', 'ed-art-next', { edition_name: '改' })).toThrow('版本号');
  });
  test('事务里任何一步出错，整个撤回', () => {
    const db = open(); seed(db);
    expect(() => db.transaction(tx => {
      tx.update('competition', 'event-art', { organizer: '改过' }, 1);
      tx.insert('edition', 'ed-bad', { competition_id: 'event-art', ordinal: 3 });   // 缺届次全称
    })).toThrow(DbError);
    expect(db.get('competition', 'event-art')).toMatchObject({ version: 1, data: { organizer: '省教育厅' } });
  });
  test('事务里先插届次、后插比赛也可以（提交时才检查指向）', () => {
    const db = open();
    db.transaction(tx => {
      tx.insert('edition', 'ed-first', { competition_id: 'event-later', ordinal: 1, edition_name: '先插的届次' });
      tx.insert('competition', 'event-later', { name: '后插的比赛', level: '国家级' });
    });
    expect(比赛.editionsOf(db, 'event-later')).toHaveLength(1);
  });
  test('标了删除的比赛、届次默认查不到；回收站明确要“包括已删除”才看得到', () => {
    const db = open(); seed(db);
    db.update('edition', 'ed-math-2025', { deleted_at: '2026-10-30T00:00:00.000Z', deleted_by: '管理员' }, 1);
    expect(db.get('edition', 'ed-math-2025')).toBeNull();
    expect(比赛.editionsOf(db, 'event-math').map(r => r.id)).toEqual(['ed-math-2026']);
    expect(db.get('edition', 'ed-math-2025', { 包括已删除: true }).data.deleted_by).toBe('管理员');
  });
});

describe('读入', () => {
  test('get 读不到返回 null；list 返回编号、版本号和内容；列表、是否按原样读回', () => {
    const db = open(); seed(db);
    expect(db.get('competition', 'event-none')).toBeNull();
    const all = db.list('competition');
    expect(all.map(r => r.id)).toEqual(['event-art', 'event-math']);
    expect(all[1].data.aliases).toEqual(['国赛数模']);
    expect(db.get('edition', 'ed-math-2026').data.pending_announcement).toBe(false);
  });
});

describe('筛选', () => {
  test('等于、在其中、包含文字、列表里有、没填', () => {
    const db = open(); seed(db);
    const ids = (table, filter, opts) => db.find(table, filter, opts).map(r => r.id);
    expect(ids('competition', { level: '国家级' })).toEqual(['event-math']);
    expect(ids('edition', { status: { in: ['已发布'] } })).toEqual(['ed-math-2026']);
    expect(ids('competition', { name: { like: '艺术' } })).toEqual(['event-art']);
    expect(ids('competition', { professions: { contains: '计算机类' } })).toEqual(['event-math']);
    expect(ids('edition', { registration_end: null })).toEqual(['ed-art-next']);
    expect(ids('edition', { or: [{ ordinal: 2, competition_id: 'event-math' }, { edition_name: { like: '第八届' } }] }, { orderBy: 'id' })).toEqual(['ed-art-2026', 'ed-math-2026']);
    expect(db.count('edition', { competition_id: 'event-math' })).toBe(2);
  });
  test('时间按实际时刻比，不受时区写法影响；排序时没填的排最后', () => {
    const db = open(); seed(db);
    const after = db.find('edition', { registration_end: { gte: '2026-10-31T08:00:00+08:00' } }, { orderBy: 'registration_end' }).map(r => r.id);
    expect(after).toEqual(['ed-art-2026', 'ed-math-2026']);
    expect(db.find('edition', {}, { orderBy: '-registration_end' }).map(r => r.id)).toEqual(['ed-math-2026', 'ed-art-2026', 'ed-math-2025', 'ed-art-next']);
    expect(db.find('edition', {}, { orderBy: 'ordinal', limit: 1, offset: 1 })).toHaveLength(1);
  });
  test('不认识的字段、写法：报“请求有误”，不会拼进 SQL', () => {
    const db = open();
    expect(() => db.find('competition', { 'name; DROP TABLE competition': 1 })).toThrow(expect.objectContaining({ kind: '请求有误' }));
    expect(() => db.find('competition', { name: { regex: 'a' } })).toThrow(expect.objectContaining({ kind: '请求有误' }));
    expect(() => db.find('competition', {}, { orderBy: 'nope' })).toThrow(expect.objectContaining({ kind: '请求有误' }));
  });
  test('按名称或别名找比赛；某个比赛的届次按顺序', () => {
    const db = open(); seed(db);
    expect(比赛.findByName(db, '国赛数模').map(r => r.id)).toEqual(['event-math']);
    expect(比赛.editionsOf(db, 'event-math').map(r => r.ordinal)).toEqual([1, 2]);
  });
  test('届次连比赛一起筛：级别没填用比赛的、按比赛的专业、关键词查别名、报名还没截止', () => {
    const db = open(); seed(db);
    const ids = rows => rows.map(r => r.edition.id);
    expect(ids(届次.search(db, { levels: ['省级/区域级'] }))).toEqual(['ed-art-next']);   // 第八届自己填了国家级
    expect(ids(届次.search(db, { levels: ['国家级'], professions: ['艺术类'] }))).toEqual(['ed-art-2026']);
    expect(ids(届次.search(db, { keyword: '国赛' }))).toEqual(['ed-math-2025', 'ed-math-2026']);
    expect(ids(届次.openForRegistration(db, new Date('2026-10-30T00:00:00Z')))).toEqual(['ed-art-2026', 'ed-math-2026']);
    expect(ids(届次.search(db, { statuses: ['已发布'] }))).toEqual(['ed-math-2026']);
    const [row] = 届次.search(db, { keyword: '第九届' });
    expect(row).toMatchObject({ level: '省级/区域级', organizer: '省教育厅', competition: { id: 'event-art' } });
  });
  test('届次连比赛一起筛：参赛形式、费用分档、地区；地区可选“没填地区的（全国性比赛）也算”（2026-11-01 赛事助手要用）', () => {
    const db = open(); seed(db);
    db.update('edition', 'ed-math-2026', { participation_format: '团队赛', fee_type: '免费' }, 1);
    db.update('edition', 'ed-art-2026', { participation_format: '个人赛' }, 1);
    db.update('competition', 'event-art', { region: '广东省' }, 1);
    const ids = rows => rows.map(r => r.edition.id);
    expect(ids(届次.search(db, { participationFormats: ['团队赛', '个人或团队均可'] }))).toEqual(['ed-math-2026']);
    expect(ids(届次.search(db, { feeTypes: ['免费'] }))).toEqual(['ed-math-2026']);
    expect(ids(届次.search(db, { regions: ['广东省'] }))).toEqual(['ed-art-2026', 'ed-art-next']);
    expect(ids(届次.search(db, { regions: ['广东省'], includeNoRegion: true }))).toEqual(['ed-math-2025', 'ed-art-2026', 'ed-math-2026', 'ed-art-next']);
    expect(ids(届次.search(db, { regions: ['浙江省'] }))).toEqual([]);
  });
});

describe('只读副本', () => {
  test('用只读方式打开：能读，任何写入都报“只读副本”', () => {
    const db = openDb({ file: ':memory:', readOnly: true });
    expect(db.count('competition')).toBe(0);
    expect(() => db.insert('competition', 'event-x', { name: 'x', level: '国家级' })).toThrow(expect.objectContaining({ kind: '只读副本' }));
    expect(() => db.transaction(tx => tx.insert('competition', 'event-y', { name: 'y', level: '国家级' }))).toThrow(expect.objectContaining({ kind: '只读副本' }));
  });
});

describe('删除标记和连表筛选', () => {
  test('届次连比赛一起筛：已删除的届次、已删除比赛下的届次都不出现', () => {
    const db = open(); seed(db);
    db.update('competition', 'event-art', { deleted_at: '2026-10-30T00:00:00.000Z' }, 1);
    db.update('edition', 'ed-math-2025', { deleted_at: '2026-10-30T00:00:00.000Z' }, 1);
    expect(届次.search(db, {}).map(r => r.edition.id)).toEqual(['ed-math-2026']);
    expect(比赛.findByName(db, '省大学生艺术展演')).toEqual([]);
  });
});
