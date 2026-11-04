// 后台 · 比赛管理：一级比赛下面列二级届次；搜索、按状态筛选；新建、编辑、改状态、删除（进回收站）。
// 读和写都只调比赛库的函数（比赛.*、届次.*），这里只有业务和排版。用内存里的比赛库。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../../../db/test/复用/样例数据.mjs';
import { 处理后台请求 } from '../../../../接口.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { 整理, 表单初值, 表单转改动, 是海报比例, 压到上限, 加候选, 删候选 } from '../../整理.mjs';
import { 假JPG } from '../../../../../../共用/test/复用/假图片.mjs';

const 环境 = db => ({ db, 操作人: '管理员甲', now: () => new Date('2026-10-01T00:00:00.000Z') });
const 管理 = (db, 参数 = {}) => 处理后台请求('比赛管理', 参数, 环境(db));
const 回收站 = (db, 参数 = {}) => 处理后台请求('回收站', 参数, 环境(db));

function 准备() {
  const db = open(); seed(db);
  db.insert('competition', 'event-agent', { name: '智能体大赛', level: '国家级' });
  return db;
}

describe('取数据和动作（数据库.mjs）', () => {
  test('不带动作：交回没删的比赛（各带届次）、编辑表单要的字段说明、三种状态；只带给用户看的字段', async () => {
    const db = 准备();
    db.update('edition', 'ed-art-next', { deleted_at: '2026-09-30T00:00:00.000Z' }, 1);
    const 回 = await 管理(db);
    expect(回.比赛们.map(c => [c.id, c.届次们.map(e => e.id)])).toEqual([
      ['event-agent', []], ['event-art', ['ed-art-2026']], ['event-math', ['ed-math-2025', 'ed-math-2026']],
    ]);
    expect(Object.keys(回.比赛们[2])).not.toContain('created_at');
    expect(回.比赛们[2]).toMatchObject({ version: 1, name: '全国大学生数学建模竞赛', aliases: ['国赛数模'] });
    expect(Object.keys(回.比赛们[2].届次们[1]).sort()).toEqual(expect.arrayContaining(['id', 'version', 'status', 'status_reason', 'edition_name', 'registration_end']));
    expect(Object.keys(回.比赛们[2].届次们[1])).not.toContain('legacy');
    expect(回.状态们).toEqual(['已发布', '已归档', '待人工审核']);
    expect(回.字段表.比赛.find(f => f.字段 === 'level')).toEqual({ 字段: 'level', 说明: '级别', 类型: '文字', 可选值: ['国际级', '国家级', '省级/区域级', '其他/未明确'], 必填: true });
    expect(回.字段表.届次.map(f => f.字段)).toContain('format_and_rules');
    expect(回.字段表.届次.map(f => f.字段)).not.toContain('status');
  });
  test('新建比赛、在比赛下新建届次：记下操作人，列表里马上有', async () => {
    const db = 准备();
    const 回 = await 管理(db, { 动作: '新建比赛', 内容: { name: '全国大学生机器人大赛', level: '国家级' } });
    expect(回.结果).toMatchObject({ 动作: '新建比赛', 名称: '全国大学生机器人大赛' });
    const 新比赛 = 回.结果.编号;
    const 回2 = await 管理(db, { 动作: '新建届次', 比赛id: 新比赛, 内容: { edition_name: '2027 年机器人大赛' } });
    expect(回2.比赛们.find(c => c.id === 新比赛).届次们).toEqual([expect.objectContaining({ edition_name: '2027 年机器人大赛', status: '待人工审核' })]);
    expect(db.find('audit_log', { action: '新建届次' })[0].detail.操作人).toBe('管理员甲');
  });
  test('编辑：带版本号保存，交回改了哪些；版本号对不上报“版本冲突”', async () => {
    const db = 准备();
    const 回 = await 管理(db, { 动作: '编辑届次', 编号: 'ed-art-next', 改动: { fee_type: '免费', edition_name: '第九届艺术展演' }, 版本号: 1 });
    expect(回.结果).toEqual({ 动作: '编辑届次', 编号: 'ed-art-next', 名称: '第九届艺术展演', 改了: ['fee_type'] });
    await expect(管理(db, { 动作: '编辑届次', 编号: 'ed-art-next', 改动: { fee_type: '收费' }, 版本号: 1 })).rejects.toMatchObject({ kind: '版本冲突' });
    expect((await 管理(db, { 动作: '编辑比赛', 编号: 'event-art', 改动: { organizer: '省文旅厅' }, 版本号: 1 })).结果.改了).toEqual(['organizer']);
  });
  test('改状态：直接在列表里改', async () => {
    const db = 准备();
    const 回 = await 管理(db, { 动作: '改状态', 编号: 'ed-math-2025', 状态: '已归档', 版本号: 1 });
    expect(回.结果).toEqual({ 动作: '改状态', 编号: 'ed-math-2025', 名称: '2025 年数学建模', 状态: '已归档' });
    expect(回.比赛们.find(c => c.id === 'event-math').届次们[0]).toMatchObject({ status: '已归档', version: 2 });
  });
  test('删除一级比赛：连同届次一起进回收站；删除届次只删这一届；回收站里都看得到', async () => {
    const db = 准备();
    const 回 = await 管理(db, { 动作: '删除比赛', 编号: 'event-math' });
    expect(回.结果).toEqual({ 动作: '删除比赛', 编号: 'event-math', 名称: '全国大学生数学建模竞赛', 届次: 2 });
    expect(回.比赛们.map(c => c.id)).not.toContain('event-math');
    await 管理(db, { 动作: '删除届次', 编号: 'ed-art-next' });
    const 站 = await 回收站(db);
    expect(站.比赛们.map(c => [c.id, c.届次数])).toEqual([['event-math', 2]]);
    expect(站.届次们.map(e => e.id)).toEqual(['ed-art-next']);
  });
  test('不认识的动作拒绝；什么都不改', async () => {
    const db = 准备();
    await expect(管理(db, { 动作: '清空' })).rejects.toThrow('不认识的动作');
  });
});

// 整理用的原始数据：和 取() 交回的同一个样子
const 原始 = {
  比赛们: [
    { id: 'c-shu', name: '数据挖掘挑战赛', aliases: ['泰迪杯'], 届次们: [{ id: 'e-shu-1', edition_name: '2025 泰迪杯', status: '已归档' }, { id: 'e-shu-2', edition_name: '2026 泰迪杯', status: '已发布' }] },
    { id: 'c-ai', name: '智能体大赛', aliases: [], 届次们: [] },
    { id: 'c-quan', name: '全国大学生数学建模竞赛', aliases: ['国赛数模'], 届次们: [{ id: 'e-quan-1', edition_name: '2026 年 CUMCM', status: '待人工审核' }] },
  ],
  字段表: { 比赛: [{ 字段: 'name', 说明: '比赛名称', 类型: '文字', 必填: true }], 届次: [{ 字段: 'registration_start', 说明: '报名开始（原文只写日期的只存日期）', 类型: '日期或时间', 必填: false }] },
  状态们: ['已发布', '已归档', '待人工审核'],
  结果: null,
};
const 看 = 数据 => 数据.组们.map(g => [g.比赛.id, g.届次们.map(e => e.id)]);

describe('整理：两级排版和筛选', () => {
  test('一级比赛按名称排（中文拼音序），届次按原来的顺序挂在下面；没有届次的比赛也列出来', () => {
    const 数据 = 整理(原始, {});
    expect(看(数据)).toEqual([['c-quan', ['e-quan-1']], ['c-shu', ['e-shu-1', 'e-shu-2']], ['c-ai', []]]);
    expect(数据.筛选项).toEqual([['全部', 3], ['已归档', 1], ['已发布', 1], ['待人工审核', 1]]);
    expect(数据.状态).toBe('全部');
  });
  test('按状态筛：只留有这种届次的比赛，下面也只列这种届次', () => {
    expect(看(整理(原始, { 状态: '已发布' }))).toEqual([['c-shu', ['e-shu-2']]]);
    expect(() => 整理(原始, { 状态: '已下线' })).toThrow('没有这个状态');
  });
  test('搜索：比赛名称或别名对上，列出它全部届次；只有届次名对上，只列那几届；不分大小写', () => {
    expect(看(整理(原始, { 关键词: '泰迪' }))).toEqual([['c-shu', ['e-shu-1', 'e-shu-2']]]);
    expect(看(整理(原始, { 关键词: 'cumcm' }))).toEqual([['c-quan', ['e-quan-1']]]);
    expect(看(整理(原始, { 关键词: '2026' }))).toEqual([['c-quan', ['e-quan-1']], ['c-shu', ['e-shu-2']]]);
    expect(整理(原始, { 关键词: '2026', 状态: '已发布' }).筛选项).toEqual([['全部', 2], ['已归档', 0], ['已发布', 1], ['待人工审核', 1]]);
  });
  test('海报规格原样交给界面（编辑框的封面海报一栏要用）', () => {
    expect(整理({ ...原始, 海报规格: { 宽: 640 } }, {}).海报规格).toEqual({ 宽: 640 });
  });
  test('字段表加上简短的标签（说明括号、分号前那段）', () => {
    expect(整理(原始, {}).字段表.届次[0]).toMatchObject({ 字段: 'registration_start', 标签: '报名开始' });
  });
  test('刚做完的动作给一句提示', () => {
    const 提示 = 结果 => 整理({ ...原始, 结果 }, {}).提示;
    expect(提示({ 动作: '新建比赛', 名称: '甲赛' })).toBe('已新建比赛“甲赛”');
    expect(提示({ 动作: '新建届次', 名称: '甲赛 2027' })).toBe('已新建届次“甲赛 2027”，状态是待人工审核');
    expect(提示({ 动作: '编辑届次', 名称: '甲赛 2027', 改了: ['fee_type', 'rewards'] })).toBe('“甲赛 2027”已保存 2 处修改');
    expect(提示({ 动作: '编辑比赛', 名称: '甲赛', 改了: [] })).toBe('“甲赛”没有改动');
    expect(提示({ 动作: '改状态', 名称: '甲赛 2027', 状态: '已发布' })).toBe('“甲赛 2027”已改为已发布');
    expect(提示({ 动作: '删除比赛', 名称: '甲赛', 届次: 2 })).toBe('“甲赛”连同 2 届已移到回收站，30 天内可以恢复');
    expect(提示({ 动作: '删除届次', 名称: '甲赛 2027' })).toBe('“甲赛 2027”已移到回收站，30 天内可以恢复');
    expect(整理(原始, {}).提示).toBe('');
  });
});

describe('编辑表单的换算（纯计算）', () => {
  const 字段们 = [
    { 字段: 'edition_name', 标签: '届次全称', 类型: '文字' },
    { 字段: 'aliases', 标签: '别名', 类型: '列表' },
    { 字段: 'reward_highlights', 标签: '非现金回报', 类型: '列表', 可选值: ['证书荣誉', '现金奖金'] },
    { 字段: 'reward_amount', 标签: '现金奖金总额', 类型: '整数' },
    { 字段: 'pending_announcement', 标签: '主办方明确说时间待公布', 类型: '是否' },
    { 字段: 'recommendation', 标签: '推荐结论', 类型: '对象' },
    { 字段: 'registration_end', 标签: '报名截止', 类型: '日期或时间' },
  ];
  test('初值：列表用顿号连起来，对象写成缩进的 JSON，没填的给空', () => {
    expect(表单初值(字段们[1], ['国赛数模', '数模国赛'])).toBe('国赛数模、数模国赛');
    expect(表单初值(字段们[2], ['证书荣誉'])).toEqual(['证书荣誉']);
    expect(表单初值(字段们[5], { 结论: '强烈推荐' })).toBe('{\n  "结论": "强烈推荐"\n}');
    expect(表单初值(字段们[3], null)).toBe('');
    expect(表单初值(字段们[4], null)).toBe(false);
  });
  test('换回来：去掉首尾空格，空的算没填；列表按顿号、逗号、换行拆；整数、JSON 换成值；只交回真正变了的', () => {
    const 原 = { edition_name: '甲赛', aliases: ['甲'], reward_highlights: [], reward_amount: null, pending_announcement: false, recommendation: { 结论: '值得参加' }, registration_end: null };
    const 输入 = { edition_name: ' 甲赛 ', aliases: '甲，甲杯、 乙\n', reward_highlights: ['现金奖金'], reward_amount: '50000', pending_announcement: false, recommendation: '{"结论":"值得参加"}', registration_end: '' };
    expect(表单转改动(字段们, 原, 输入)).toEqual({ aliases: ['甲', '甲杯', '乙'], reward_highlights: ['现金奖金'], reward_amount: 50000 });
  });
  test('清空原来有的值交回 null；新建（原来什么都没有）时空的不交', () => {
    expect(表单转改动(字段们, { registration_end: '2026-10-01', aliases: ['甲'] }, { registration_end: ' ', aliases: '' })).toEqual({ registration_end: null, aliases: null });
    expect(表单转改动(字段们, {}, { edition_name: '新的一届', aliases: '', reward_amount: '', recommendation: '' })).toEqual({ edition_name: '新的一届' });
  });
  test('整数、JSON 填错了报出是哪一项', () => {
    expect(() => 表单转改动(字段们, {}, { reward_amount: '五万' })).toThrow('现金奖金总额要填整数');
    expect(() => 表单转改动(字段们, {}, { recommendation: '{结论' })).toThrow('推荐结论不是合法的 JSON');
  });
});

describe('海报（图片存进图片总库，届次里只记文件名）', () => {
  const 图片目录 = () => fs.mkdtempSync(path.join(os.tmpdir(), '后台海报-'));
  const 带图 = (db, 目录) => ({ ...环境(db), 图片目录: 目录 });
  test('存图片：只存文件、交回文件名和宽高，不写比赛库、不交回整个列表；读不出的报错', async () => {
    const db = 准备(); const 目录 = 图片目录();
    const 图 = 假JPG(640, 360, 2000).toString('base64');
    const 回 = await 处理后台请求('比赛管理', { 动作: '存图片', 图片: `data:image/jpeg;base64,${图}`, 种类: '海报' }, 带图(db, 目录));
    expect(Object.keys(回)).toEqual(['结果']);
    expect(回.结果).toMatchObject({ 动作: '存图片', 宽: 640, 高: 360, 字节: 2000, 是海报比例: true });
    expect(fs.existsSync(path.join(目录, 回.结果.文件))).toBe(true);
    await expect(处理后台请求('比赛管理', { 动作: '存图片', 图片: 'bm90IGFuIGltYWdl', 种类: '候选' }, 带图(db, 目录))).rejects.toThrow('读不出');
  });
  test('编辑届次设海报：图片总库里得有这张图；有就保存', async () => {
    const db = 准备(); const 目录 = 图片目录();
    const 海报 = { file: `${'c'.repeat(64)}.jpg`, source: 'manual', sourceUrl: '', updatedAt: '2026-10-01T00:00:00.000Z' };
    await expect(处理后台请求('比赛管理', { 动作: '编辑届次', 编号: 'ed-art-next', 改动: { poster: 海报 }, 版本号: 1 }, 带图(db, 目录))).rejects.toThrow('图片总库里没有');
    const { 结果 } = await 处理后台请求('比赛管理', { 动作: '存图片', 图片: 假JPG(640, 360).toString('base64'), 种类: '海报' }, 带图(db, 目录));
    const 回 = await 处理后台请求('比赛管理', { 动作: '编辑届次', 编号: 'ed-art-next', 改动: { poster: { ...海报, file: 结果.文件 } }, 版本号: 1 }, 带图(db, 目录));
    expect(回.结果.改了).toEqual(['poster']);
    expect(回.比赛们.find(c => c.id === 'event-art').届次们.find(e => e.id === 'ed-art-next').poster.file).toBe(结果.文件);
  });
  test('列表里届次带海报和候选图；编辑表单的普通字段里没有它们（单独一栏）；交回海报规格给网页用', async () => {
    const 回 = await 管理(准备());
    expect(Object.keys(回.比赛们[2].届次们[0])).toEqual(expect.arrayContaining(['poster', 'poster_candidates']));
    expect(回.字段表.届次.map(f => f.字段)).not.toContain('poster');
    expect(回.海报规格).toEqual({ 宽: 640, 高: 360, 最大字节: 61440, 候选最大字节: 5242880, 最多候选: 10, 比例下限: 1.76, 比例上限: 1.79 });
  });
  test('网页里用的海报规则（纯计算）：16:9 判断、按质量从高到低压到上限、候选去重最多 10 张', async () => {
    const 规格 = { 比例下限: 1.76, 比例上限: 1.79 };
    expect([是海报比例(规格, 1920, 1080), 是海报比例(规格, 1200, 800)]).toEqual([true, false]);
    const 试过 = [];
    const 压 = await 压到上限(async 质量 => { 试过.push(质量); return { size: 质量 > 0.7 ? 70000 : 50000 }; }, 61440);
    expect(压.质量).toBe(0.7);
    expect(试过).toEqual([0.9, 0.85, 0.8, 0.75, 0.7]);
    expect(await 压到上限(async () => ({ size: 99999 }), 61440)).toBeNull();
    const 列表 = Array.from({ length: 10 }, (_, i) => ({ file: `f${i}` }));
    expect(加候选(列表, { file: 'f3' }, 10).map(x => x.file)).toEqual(['f0', 'f1', 'f2', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f3']);
    expect(加候选(列表, { file: 'new' }, 10).map(x => x.file)[0]).toBe('f1');
    expect(删候选(列表, 'f0')).toHaveLength(9);
  });
});
