// 后台用的写入：新建、编辑、改状态、删除（进回收站）、恢复、彻底删除。每个都在一个事务里，并在后台记录（audit_log）留一条。
// 只改给用户看的字段；人工改过的字段记进 manual_fields。用内存里的库跑。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../test/复用/样例数据.mjs';
import { 比赛, 届次 } from '../../../index.mjs';

const 时间 = '2026-10-01T00:00:00.000Z';
const 选项 = { 操作人: '管理员甲', at: 时间 };
const 日志 = (db, action) => db.find('audit_log', { action }, { orderBy: 'created_at' });
const 全部 = { 包括已删除: true };

function 准备() {
  const db = open(); seed(db);
  db.transaction(tx => {
    tx.insert('competition', 'event-math-sd', { name: '数学建模山东赛区', level: '省级/区域级', parent_id: 'event-math' });
    tx.insert('source', 'src-1', { edition_id: 'ed-math-2025', url: 'https://a.cn/1', source_type: 'organizer_website' });
    tx.insert('source', 'src-2', { edition_id: 'ed-math-2026', url: 'https://a.cn/2', source_type: 'organizer_website' });
    tx.insert('process_log', 'log-1', { edition_id: 'ed-math-2026', kind: 'ai_review', at: '2026-09-01T00:00:00.000Z', detail: { 结论: '通过' } });
  });
  return db;
}

describe('可改字段', () => {
  test('只有给用户看的字段；编号、版本号、时间、状态、机器记录都不在里面', () => {
    for (const 字段 of ['id', 'version', 'created_at', 'updated_at', 'deleted_at', 'manual_fields', 'parent_id', 'last_maintained_at']) expect(比赛.可改字段).not.toContain(字段);
    for (const 字段 of ['id', 'competition_id', 'ordinal', 'status', 'status_reason', 'status_at', 'legacy', 'discovery', 'version', 'deleted_at']) expect(届次.可改字段).not.toContain(字段);
    expect(比赛.可改字段).toEqual(expect.arrayContaining(['name', 'aliases', 'level', 'organizer', 'professions', 'recognition']));
    expect(届次.可改字段).toEqual(expect.arrayContaining(['edition_name', 'registration_start', 'registration_end', 'format_and_rules', 'fee_type', 'recommendation']));
  });
});

describe('新建', () => {
  test('新建比赛：生成编号，填的字段记进 manual_fields，留操作日志', () => {
    const db = 准备();
    const 新 = 比赛.新建(db, { name: '全国大学生智能体大赛', level: '国家级', professions: ['计算机与AI'] }, 选项);
    expect(新.id).toMatch(/^event-manual-[0-9a-f]{16}$/);
    expect(新.version).toBe(1);
    expect(db.get('competition', 新.id).data).toMatchObject({ name: '全国大学生智能体大赛', manual_fields: ['name', 'level', 'professions'] });
    expect(日志(db, '新建比赛')[0]).toMatchObject({ table_name: 'competition', record_id: 新.id, created_at: 时间, detail: { 名称: '全国大学生智能体大赛', 操作人: '管理员甲' } });
  });
  test('新建届次：挂在比赛下，顺序接着最大的往下排（删了的也算），状态默认待人工审核，记下谁建的', () => {
    const db = 准备();
    届次.删除(db, 'ed-math-2026', 选项);
    const 新 = 届次.新建(db, 'event-math', { edition_name: '2027 年数学建模', registration_end: '2027-09-01' }, 选项);
    expect(新.id).toMatch(/^edition-manual-[0-9a-f]{16}$/);
    expect(db.get('edition', 新.id).data).toMatchObject({ competition_id: 'event-math', ordinal: 3, status: '待人工审核', created_by: '管理员甲', manual_fields: ['edition_name', 'registration_end'] });
    expect(日志(db, '新建届次')[0]).toMatchObject({ record_id: 新.id, detail: { 名称: '2027 年数学建模', 比赛: 'event-math', 操作人: '管理员甲' } });
  });
  test('不在可改字段里的拒绝；比赛不存在或已删除时不能加届次；校验不通过什么都不写', () => {
    const db = 准备();
    expect(() => 比赛.新建(db, { name: 'x', level: '国家级', parent_id: 'event-math' }, 选项)).toThrow(expect.objectContaining({ kind: '请求有误', message: expect.stringContaining('parent_id') }));
    expect(() => 届次.新建(db, 'event-math', { edition_name: 'x', status: '已发布' }, 选项)).toThrow('status');
    比赛.删除(db, 'event-art', 选项);
    expect(() => 届次.新建(db, 'event-art', { edition_name: 'x' }, 选项)).toThrow(expect.objectContaining({ kind: '找不到' }));
    expect(() => 比赛.新建(db, { name: 'x', level: '世界级' }, 选项)).toThrow(expect.objectContaining({ kind: '校验不通过' }));
    expect(db.count('competition')).toBe(2);
    expect(日志(db, '新建比赛')).toHaveLength(0);
  });
});

describe('编辑', () => {
  test('只写真正变了的字段，版本号加一，并进 manual_fields（不重复），留操作日志列出改了哪些', () => {
    const db = 准备();
    const 回 = 届次.编辑(db, 'ed-art-next', { edition_name: '第九届艺术展演', registration_end: '2027-05-01', fee_type: '免费' }, 1, 选项);
    expect(回).toMatchObject({ version: 2, 改了: ['registration_end', 'fee_type'] });
    届次.编辑(db, 'ed-art-next', { registration_end: '2027-05-02' }, 2, 选项);
    expect(db.get('edition', 'ed-art-next').data).toMatchObject({ registration_end: '2027-05-02', fee_type: '免费', updated_by: '管理员甲', manual_fields: ['registration_end', 'fee_type'] });
    expect(日志(db, '编辑届次')[0]).toMatchObject({ record_id: 'ed-art-next', detail: { 改了: ['registration_end', 'fee_type'], 操作人: '管理员甲' } });
    const 比赛回 = 比赛.编辑(db, 'event-math', { aliases: ['国赛数模', '数模国赛'], organizer: '教育部' }, 1, 选项);
    expect(比赛回.改了).toEqual(['aliases', 'organizer']);
    expect(db.get('competition', 'event-math').data.manual_fields).toEqual(['aliases', 'organizer']);
  });
  test('什么都没变：不写库、版本号不变、不留日志', () => {
    const db = 准备();
    expect(比赛.编辑(db, 'event-art', { organizer: '省教育厅' }, 1, 选项)).toMatchObject({ version: 1, 改了: [] });
    expect(日志(db, '编辑比赛')).toHaveLength(0);
  });
  test('版本号对不上报“版本冲突”；不可改的字段拒绝；已删除的找不到', () => {
    const db = 准备();
    届次.编辑(db, 'ed-art-next', { fee_type: '免费' }, 1, 选项);
    expect(() => 届次.编辑(db, 'ed-art-next', { fee_type: '收费' }, 1, 选项)).toThrow(expect.objectContaining({ kind: '版本冲突' }));
    expect(() => 届次.编辑(db, 'ed-art-next', { competition_id: 'event-math' }, 2, 选项)).toThrow(expect.objectContaining({ kind: '请求有误' }));
    届次.删除(db, 'ed-art-next', 选项);
    expect(() => 届次.编辑(db, 'ed-art-next', { fee_type: '收费' }, 3, 选项)).toThrow(expect.objectContaining({ kind: '找不到' }));
  });
});

describe('改状态', () => {
  test('改成另一种状态：记下改的时间和人，status 进 manual_fields，留日志写明从哪种改成哪种', () => {
    const db = 准备();
    const 回 = 届次.改状态(db, 'ed-art-next', '已发布', 1, 选项);
    expect(回.version).toBe(2);
    expect(db.get('edition', 'ed-art-next').data).toMatchObject({ status: '已发布', status_at: 时间, updated_by: '管理员甲', manual_fields: ['status'] });
    expect(日志(db, '改状态')[0]).toMatchObject({ record_id: 'ed-art-next', detail: { 从: '待人工审核', 改成: '已发布', 操作人: '管理员甲' } });
  });
  test('人工改成待人工审核又没有理由的，补一条理由（待人工审核必须有理由）', () => {
    const db = 准备();
    届次.改状态(db, 'ed-math-2026', '待人工审核', 1, 选项);
    expect(db.get('edition', 'ed-math-2026').data.status_reason).toEqual(['管理员甲在后台改为待人工审核']);
  });
  test('状态没变不写；不认识的状态拒绝；版本号对不上报冲突', () => {
    const db = 准备();
    expect(届次.改状态(db, 'ed-math-2026', '已发布', 1, 选项)).toMatchObject({ version: 1 });
    expect(() => 届次.改状态(db, 'ed-math-2026', '已下线', 1, 选项)).toThrow(expect.objectContaining({ kind: '请求有误' }));
    届次.改状态(db, 'ed-math-2026', '已归档', 1, 选项);
    expect(() => 届次.改状态(db, 'ed-math-2026', '已发布', 1, 选项)).toThrow(expect.objectContaining({ kind: '版本冲突' }));
  });
});

describe('删除（进回收站）和恢复', () => {
  test('删除比赛：比赛和它还没删的届次一起标删除（同一时间），可记进不收录名单，留日志', () => {
    const db = 准备();
    expect(比赛.删除(db, 'event-math', { ...选项, 不再收录: true, 理由: '不是大学生比赛' })).toEqual({ 届次: 2 });
    expect(db.get('competition', 'event-math')).toBeNull();
    expect(db.find('edition', { competition_id: 'event-math' }, 全部).map(e => e.deleted_at)).toEqual([时间, 时间]);
    expect(db.find('blocked_competition', {})).toEqual([expect.objectContaining({ name: '全国大学生数学建模竞赛', aliases: ['国赛数模'], competition_id: 'event-math', reason: '不是大学生比赛', created_by: '管理员甲' })]);
    expect(日志(db, '标记删除比赛')[0]).toMatchObject({ record_id: 'event-math', detail: { 名称: '全国大学生数学建模竞赛', 届次: 2, 操作人: '管理员甲', 不再收录: true } });
  });
  test('删除届次只标这一届；删不存在的、已删过的报“找不到”', () => {
    const db = 准备();
    届次.删除(db, 'ed-math-2025', 选项);
    expect(db.get('edition', 'ed-math-2025')).toBeNull();
    expect(db.get('competition', 'event-math')).not.toBeNull();
    expect(日志(db, '标记删除届次')[0]).toMatchObject({ record_id: 'ed-math-2025', detail: { 名称: '2025 年数学建模', 比赛: 'event-math' } });
    expect(() => 届次.删除(db, 'ed-math-2025', 选项)).toThrow(expect.objectContaining({ kind: '找不到' }));
    expect(() => 比赛.删除(db, 'event-none', 选项)).toThrow(expect.objectContaining({ kind: '找不到' }));
  });
  test('恢复比赛：只回来跟它同一次删的届次，不收录名单去掉；恢复届次时比赛还在回收站要先恢复比赛', () => {
    const db = 准备();
    届次.删除(db, 'ed-math-2025', { ...选项, at: '2026-09-20T00:00:00.000Z' });
    比赛.删除(db, 'event-math', { ...选项, 不再收录: true });
    expect(() => 届次.恢复(db, 'ed-math-2026', 选项)).toThrow('先恢复比赛');
    expect(比赛.恢复(db, 'event-math', 选项)).toEqual({ 届次: 1 });
    expect(db.get('edition', 'ed-math-2026')).not.toBeNull();
    expect(db.get('edition', 'ed-math-2025')).toBeNull();
    expect(db.count('blocked_competition')).toBe(0);
    届次.恢复(db, 'ed-math-2025', 选项);
    expect(db.get('edition', 'ed-math-2025')).not.toBeNull();
    expect(日志(db, '恢复比赛')[0].detail).toMatchObject({ 名称: '全国大学生数学建模竞赛', 届次: 1 });
    expect(日志(db, '恢复届次')).toHaveLength(1);
    expect(() => 比赛.恢复(db, 'event-math', 选项)).toThrow(expect.objectContaining({ kind: '找不到' }));
  });
});

describe('彻底删除（回收站到期清理用）', () => {
  test('比赛：届次、来源、处理记录连带删，下级比赛断开上级，留日志', () => {
    const db = 准备();
    比赛.删除(db, 'event-math', 选项);
    比赛.彻底删除(db, 'event-math', { at: '2026-11-01T00:00:00.000Z' });
    expect(db.get('competition', 'event-math', 全部)).toBeNull();
    expect(db.count('edition', { competition_id: 'event-math' }, 全部)).toBe(0);
    expect(db.count('source')).toBe(0);
    expect(db.get('competition', 'event-math-sd').data.parent_id).toBeNull();
    expect(日志(db, '回收站清理')[0]).toMatchObject({ table_name: 'competition', record_id: 'event-math', created_at: '2026-11-01T00:00:00.000Z',
      detail: { 名称: '全国大学生数学建模竞赛', 标记时间: 时间, 标记人: '管理员甲', 连带: { edition: 2, source: 2, process_log: 1 }, 断开的下级比赛: ['event-math-sd'] } });
  });
  test('届次：来源连带删；没进回收站的不能彻底删', () => {
    const db = 准备();
    expect(() => 届次.彻底删除(db, 'ed-math-2025', { at: 时间 })).toThrow(expect.objectContaining({ kind: '找不到' }));
    届次.删除(db, 'ed-math-2025', 选项);
    届次.彻底删除(db, 'ed-math-2025', { at: 时间 });
    expect(db.get('edition', 'ed-math-2025', 全部)).toBeNull();
    expect(db.count('source')).toBe(1);
    expect(日志(db, '回收站清理')[0].detail).toMatchObject({ 名称: '2025 年数学建模', 比赛: 'event-math', 连带: { source: 1 } });
  });
});

describe('全部连届次（后台列表读这个）', () => {
  test('每个没删的比赛带上它没删的届次（按届次顺序），没有届次的比赛也在', () => {
    const db = 准备();
    届次.删除(db, 'ed-art-2026', 选项);
    const 回 = 比赛.全部连届次(db);
    expect(回.map(c => [c.id, c.届次们.map(e => e.id)])).toEqual([
      ['event-art', ['ed-art-next']],
      ['event-math', ['ed-math-2025', 'ed-math-2026']],
      ['event-math-sd', []],
    ]);
    expect(回[0].version).toBe(1);
    expect(回[0].届次们[0]).toMatchObject({ version: 1, status: '待人工审核' });
  });
});

describe('海报字段（届次的 poster、poster_candidates）', () => {
  const 文件 = `${'a'.repeat(64)}.jpg`;
  const 海报 = { file: 文件, source: 'official', sourceUrl: 'https://a.cn/x', updatedAt: 时间 };
  const 候选 = n => ({ file: `${String(n).padStart(64, 'b')}.png`, width: 1200, height: 800, bytes: 3000, source: 'manual', sourceUrl: '', addedAt: 时间 });
  test('后台能改：设海报、加候选图都走编辑，记进 manual_fields；去掉海报填 null', () => {
    const db = 准备();
    expect(届次.可改字段).toEqual(expect.arrayContaining(['poster', 'poster_candidates']));
    届次.编辑(db, 'ed-art-next', { poster: 海报, poster_candidates: [候选(1)] }, 1, 选项);
    expect(db.get('edition', 'ed-art-next').data).toMatchObject({ poster: 海报, poster_candidates: [候选(1)], manual_fields: ['poster', 'poster_candidates'] });
    届次.编辑(db, 'ed-art-next', { poster: null }, 2, 选项);
    expect(db.get('edition', 'ed-art-next').data.poster).toBeNull();
  });
  test('格式不对的拒绝：海报文件名不是哈希.jpg、来源不认识、候选超过 10 张或缺字段', () => {
    const db = 准备();
    const 拒 = 改动 => expect(() => 届次.编辑(db, 'ed-art-next', 改动, 1, 选项)).toThrow(expect.objectContaining({ kind: '请求有误' }));
    拒({ poster: { ...海报, file: '../x.jpg' } });
    拒({ poster: { ...海报, file: `${'a'.repeat(64)}.png` } });
    拒({ poster: { ...海报, source: '网上找的' } });
    拒({ poster: { file: 文件 } });
    拒({ poster_candidates: Array.from({ length: 11 }, (_, i) => 候选(i)) });
    拒({ poster_candidates: [{ file: 候选(1).file }] });
    拒({ poster_candidates: 候选(1) });
    expect(() => 届次.新建(db, 'event-math', { edition_name: 'x', poster: { ...海报, source: '网上找的' } }, 选项)).toThrow(expect.objectContaining({ kind: '请求有误' }));
  });
});
