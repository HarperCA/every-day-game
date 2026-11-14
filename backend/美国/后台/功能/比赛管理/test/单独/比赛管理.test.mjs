// 后台 · 比赛管理：一级比赛下面列二级届次；搜索、按状态筛选；新建、编辑、改状态、删除（进回收站）。
// 读和写都只调比赛库的函数（比赛.*、届次.*），这里只有业务和排版。用内存里的比赛库。
import { describe, expect, test, vi } from 'vitest';
import { open, seed } from '../../../../../db/test/复用/样例数据.mjs';
import { 处理后台请求 } from '../../../../接口.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { 整理, 表单初值, 表单转改动, 是海报比例, 压到上限, 加候选, 删候选, 维护时间文字, 维护状态, 搜索记忆展示, 维护标记, 维护详情展示 } from '../../整理.mjs';
import { 呈现 } from '../../呈现.mjs';
import { 搜索记忆, 维护队列 } from '../../../../../db/index.mjs';
import { 假JPG } from '../../../../../../共用/test/复用/假图片.mjs';
import { 比赛公开字段, 届次公开字段 } from '../../../../../../沟通/公开比赛同步/格式.mjs';

const 环境 = db => ({ db, 操作人: '管理员甲', now: () => new Date('2026-10-01T00:00:00.000Z') });
const 管理 = (db, 参数 = {}) => 处理后台请求('比赛管理', 参数, 环境(db));
const 回收站 = (db, 参数 = {}) => 处理后台请求('回收站', 参数, 环境(db));

function 准备() {
  const db = open(); seed(db);
  db.insert('competition', 'event-agent', { name: '智能体大赛', level: '国家级' });
  return db;
}

describe('修改（2026-11-06 用户定：每行右边“修改”，给用户看的字段保存进比赛库）', () => {
  test('给用户看的字段（公开比赛同步的白名单）都在修改表单里，只有系统写的核对时间除外', async () => {
    const db = 准备();
    const 回 = await 管理(db);
    const 比赛能改 = 回.字段表.比赛.map(f => f.字段);
    const 届次能改 = 回.字段表.届次.map(f => f.字段);
    expect(比赛公开字段.filter(f => !比赛能改.includes(f))).toEqual([]);
    expect(届次公开字段.filter(f => !届次能改.includes(f))).toEqual(['last_verified_at']);
    expect(比赛能改).toEqual(expect.arrayContaining(['name', 'level']));
    expect(届次能改).toEqual(expect.arrayContaining(['registration_start', 'registration_end']));
  });
  test('改比赛和届次：写进比赛库、版本号加一（公开同步靠它发现变化）、记人工改过', async () => {
    const db = 准备();
    const 比赛前 = db.get('competition', 'event-math');
    const 届前 = db.get('edition', 'ed-math-2026');
    await 管理(db, { 动作: '编辑比赛', 编号: 'event-math', 改动: { organizer: '新主办方' }, 版本号: 比赛前.version });
    await 管理(db, { 动作: '编辑届次', 编号: 'ed-math-2026', 改动: { registration_end: '2026-12-31', rewards: '一等奖 1 万元' }, 版本号: 届前.version });
    expect(db.get('competition', 'event-math')).toMatchObject({ version: 比赛前.version + 1, data: { organizer: '新主办方' } });
    const 届后 = db.get('edition', 'ed-math-2026');
    expect(届后.version).toBe(届前.version + 1);
    expect(届后.data).toMatchObject({ registration_end: '2026-12-31', rewards: '一等奖 1 万元' });
    expect(届后.data.manual_fields).toEqual(expect.arrayContaining(['registration_end', 'rewards']));
  });
  test('别人刚改过（版本号不对）：不保存，报错', async () => {
    const db = 准备();
    const 届前 = db.get('edition', 'ed-math-2026');
    await expect(管理(db, { 动作: '编辑届次', 编号: 'ed-math-2026', 改动: { rewards: '一等奖' }, 版本号: 届前.version + 5 })).rejects.toThrow();
    expect(db.get('edition', 'ed-math-2026').data.rewards ?? null).toBe(届前.data.rewards ?? null);
  });
});

describe('手动维护：多选的比赛排进维护队列，由新维护处理（2026-11-06 建，2026-11-12 用户定改走新维护、不限数量）', () => {
  test('列表带比赛的最新维护时间和维护队列', async () => {
    const db = 准备();
    db.update('competition', 'event-art', { last_maintained_at: '2026-10-01T06:05:00.000Z' }, db.get('competition', 'event-art').version);
    const 回 = await 管理(db);
    expect(回.比赛们.find(c => c.id === 'event-art').last_maintained_at).toBe('2026-10-01T06:05:00.000Z');
    expect(回.比赛们.find(c => c.id === 'event-agent').last_maintained_at).toBeNull();
    expect(回.维护队列).toEqual({ 排队: [], 正在: [], 最近: [] });
    expect(回).not.toHaveProperty('AI维护');
  });
  test('启动维护：多选的比赛排进队列，马上能看到排队中；提示写明个数、说的是新维护；记下操作人', async () => {
    const db = 准备();
    const 回 = await 管理(db, { 动作: '启动维护', 编号们: ['event-art', 'event-math'] });
    expect(回.维护队列.排队).toEqual(['event-art', 'event-math']);
    expect(回.结果).toMatchObject({ 动作: '启动维护', 加入: 2 });
    const 提示 = 整理(回, {}).提示;
    expect(提示).toContain('2 个比赛');
    expect(提示).toContain('维护队列');
    expect(提示).not.toMatch(/AI 维护|Codex/);
    expect(db.find('audit_log', { action: '启动维护' })[0].detail.操作人).toBe('管理员甲');
  });
  test('不限数量：一次选 120 个也都排进去', async () => {
    const db = 准备();
    db.transaction(tx => { for (let i = 0; i < 120; i += 1) tx.insert('competition', `event-n${i}`, { name: `比赛${i}`, level: '国家级' }); });
    const 编号们 = Array.from({ length: 120 }, (_, i) => `event-n${i}`);
    const 回 = await 管理(db, { 动作: '启动维护', 编号们 });
    expect(回.结果.加入).toBe(120);
    expect(回.维护队列.排队).toHaveLength(120);
  });
  test('旧动作名“启动AI维护”不认了', async () => {
    const db = 准备();
    await expect(管理(db, { 动作: '启动AI维护', 编号们: ['event-art'] })).rejects.toThrow(/不认识的动作/);
  });
  test('启动维护：没选、不是列表、比赛不存在都报错', async () => {
    const db = 准备();
    await expect(管理(db, { 动作: '启动维护', 编号们: [] })).rejects.toThrow(/至少选一个/);
    await expect(管理(db, { 动作: '启动维护', 编号们: 'event-art' })).rejects.toThrow(/至少选一个/);
    await expect(管理(db, { 动作: '启动维护', 编号们: ['event-none'] })).rejects.toThrow(/没有这个比赛/);
  });
  test('维护时间按北京时间显示；没维护过写未维护', () => {
    expect(维护时间文字('2026-11-06T06:05:00.000Z')).toBe('2026-11-06 14:05');
    expect(维护时间文字(null)).toBe('未维护');
    expect(维护时间文字('乱写')).toBe('未维护');
  });
  test('维护状态：正在维护（可以同时好几个）、排队中，其余没有', () => {
    const 队列 = { 排队: ['b', 'c'], 正在: ['a', 'd'] };
    expect(维护状态('a', 队列)).toBe('维护中');
    expect(维护状态('d', 队列)).toBe('维护中');
    expect(维护状态('b', 队列)).toBe('排队中');
    expect(维护状态('x', 队列)).toBe('');
    expect(维护状态('c', undefined)).toBe('');
  });
  test('整理把队列交给界面', async () => {
    const db = 准备();
    const 回 = await 管理(db, { 动作: '启动维护', 编号们: ['event-art'] });
    expect(整理(回, {}).维护队列.排队).toEqual(['event-art']);
  });
});

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

// 2026-11-07 用户定：点比赛展开，看这个比赛的搜索记忆。点开时才取（发请求），列表本身不带，免得一次拉一千多份。
describe('搜索记忆（点比赛展开）', () => {
  test('读搜索记忆：只交回这一个比赛的记忆，不交回整个列表、不写比赛库', async () => {
    const db = 准备();
    搜索记忆.改节(db, 'event-math', { 官方域名: ['mcm.edu.cn'], 教训: ['学校转载的要追回原文'] }, { 操作人: '新维护' });
    const 回 = await 管理(db, { 动作: '读搜索记忆', 编号: 'event-math' });
    expect(回.比赛们).toBeUndefined();
    expect(回.结果).toMatchObject({ 动作: '读搜索记忆', 编号: 'event-math', 记忆: { version: 1, updated_by: '新维护', 节: { 官方域名: ['mcm.edu.cn'], 教训: ['学校转载的要追回原文'] } } });
    expect(回.结果.记忆.内容).toContain('## 官方域名');
    expect(回.结果.节名).toEqual(搜索记忆.节名);
    expect(搜索记忆.读(db, 'event-math').version).toBe(1);
  });
  test('还没有搜索记忆的交回 null；没有这个比赛的报错', async () => {
    const db = 准备();
    expect((await 管理(db, { 动作: '读搜索记忆', 编号: 'event-agent' })).结果.记忆).toBeNull();
    await expect(管理(db, { 动作: '读搜索记忆', 编号: 'event-none' })).rejects.toThrow('没有这个比赛');
  });
  test('展示：六节按顺序，空的节写“还没有”，带最后修改时间（北京时间）和谁改的', () => {
    // 节名用比赛库 2026-11-07 的六节（比赛库后来又加了“维护记录”，见下一条）
    const 节名 = ['官方域名', '通知列表页', '往年通知标题格式', '成功过的搜索词', '往年真实发布日期', '教训'];
    const 记忆 = { version: 2, updated_at: '2026-11-07T04:05:00.000Z', updated_by: '新维护',
      节: { 官方域名: ['mcm.edu.cn'], 通知列表页: [], 往年通知标题格式: [], 成功过的搜索词: ['{年份} 数学建模 通知'], 往年真实发布日期: [], 教训: [] } };
    expect(搜索记忆展示(记忆, 节名)).toEqual({
      有: true,
      说明: '最后修改 2026-11-07 12:05 · 新维护 · 第 2 版',
      节们: [
        { 名: '官方域名', 条目们: ['mcm.edu.cn'] }, { 名: '通知列表页', 条目们: [] }, { 名: '往年通知标题格式', 条目们: [] },
        { 名: '成功过的搜索词', 条目们: ['{年份} 数学建模 通知'] }, { 名: '往年真实发布日期', 条目们: [] }, { 名: '教训', 条目们: [] },
      ],
    });
    expect(搜索记忆展示(null, 节名)).toEqual({ 有: false, 说明: '还没有搜索记忆：新维护第一次查这个比赛时会建一份', 节们: [] });
  });
  test('展示：节按比赛库给的节名逐节列出（新加的“维护记录”跟着出来，放最后）；记忆里有、节名里还没有的节也列在最后', () => {
    const 记忆 = { version: 1, updated_at: '2026-11-08T04:05:00.000Z', updated_by: '新维护', 节: { 官方域名: ['mcm.edu.cn'], 维护记录: ['2026-11-08 改了报名截止'] } };
    expect(搜索记忆展示(记忆, ['官方域名', '教训', '维护记录']).节们.map(节 => 节.名)).toEqual(['官方域名', '教训', '维护记录']);
    expect(搜索记忆展示(记忆, ['官方域名', '教训', '维护记录']).节们[2]).toEqual({ 名: '维护记录', 条目们: ['2026-11-08 改了报名截止'] });
    expect(搜索记忆展示(记忆, ['官方域名', '教训']).节们).toEqual([
      { 名: '官方域名', 条目们: ['mcm.edu.cn'] }, { 名: '教训', 条目们: [] }, { 名: '维护记录', 条目们: ['2026-11-08 改了报名截止'] },
    ]);
  });
});

// 2026-11-08 用户定：每个比赛仍只一行“最新维护 时间”；最新一条新维护记录成功是绿色、失败是红色，没有记录或没写成功的照旧；
// 只有点维护时间才展开看详情（摘要、时间、原因、入库、过程），再点收起。列表只带 { 成功, 摘要, 时间 }，详情第一次点开时再取。
// 新维护写记录时同一个事务里把比赛的 last_maintained_at 写成同一时刻（db/新维护/维护一个.mjs 的 收尾）。
function 记新维护(db, 编号, 时间, detail) {
  db.update('competition', 编号, { last_maintained_at: 时间 }, db.get('competition', 编号).version);
  db.insert('audit_log', `新维护-${编号}-${时间}`, { created_at: 时间, action: '新维护', table_name: 'competition', record_id: 编号, detail });
}
const 成功详情 = {
  成功: true, 摘要: '入库 2 条', 结果: '入库', 原因: '',
  入库: [{ 网址: 'https://mcm.edu.cn/a', 状态: '待人工审核', 原因: '新通知' }, { 网址: 'https://mcm.edu.cn/b', 状态: '已发布', 原因: '' }],
  过程: [{ 步骤: '官网', 说明: '用比赛库里的官网 https://mcm.edu.cn/' }, { 步骤: '结果', 说明: '入库' }],
};

describe('新维护结果（维护时间着色、点开看详情）', () => {
  test('列表带每个比赛最新一条新维护的 { 成功, 摘要, 时间 }，不带过程；没有记录的给 null；旧记录没写成功的给 null；别的动作不算', async () => {
    const db = 准备();
    记新维护(db, 'event-math', '2026-11-07T07:30:00.000Z', { 成功: false, 摘要: '没找到官网', 结果: '没找到官网', 原因: '搜不到', 入库: [], 过程: [] });
    记新维护(db, 'event-math', '2026-11-08T07:30:00.000Z', 成功详情);
    记新维护(db, 'event-art', '2026-11-06T01:00:00.000Z', { 结果: '没变', 原因: '网站说没更新', 入库: [], 过程: [] });
    db.insert('audit_log', '维护比赛-event-agent', { created_at: '2026-11-08T08:00:00.000Z', action: '维护比赛', table_name: 'competition', record_id: 'event-agent', detail: { 成功: true } });
    const 回 = await 管理(db);
    const 找 = 编号 => 回.比赛们.find(c => c.id === 编号);
    expect(找('event-math').最新新维护).toEqual({ 成功: true, 摘要: '入库 2 条', 时间: '2026-11-08T07:30:00.000Z' });
    expect(找('event-art').最新新维护).toEqual({ 成功: null, 摘要: '', 时间: '2026-11-06T01:00:00.000Z' });
    expect(找('event-agent').最新新维护).toBeNull();
  });
  test('后来别的维护又改了维护时间：仍然找到这个比赛最新一条新维护记录', async () => {
    const db = 准备();
    记新维护(db, 'event-art', '2026-11-05T01:00:00.000Z', { 成功: false, 摘要: '官网打不开', 入库: [], 过程: [] });
    db.update('competition', 'event-art', { last_maintained_at: '2026-11-06T01:00:00.000Z' }, db.get('competition', 'event-art').version);
    const 回 = await 管理(db);
    expect(回.比赛们.find(c => c.id === 'event-art').最新新维护).toEqual({ 成功: false, 摘要: '官网打不开', 时间: '2026-11-05T01:00:00.000Z' });
  });
  test('取列表时 audit_log 最多查两次，不按比赛一个个查', async () => {
    const db = 准备();
    for (let i = 0; i < 20; i++) db.insert('competition', `event-多-${i}`, { name: `多比赛 ${i}`, level: '国家级' });
    for (let i = 0; i < 20; i++) 记新维护(db, `event-多-${i}`, `2026-11-0${1 + (i % 8)}T0${i % 10}:00:00.000Z`, { 成功: i % 2 === 0, 摘要: '没有变化', 入库: [], 过程: [] });
    let 次数 = 0;
    const 数着 = new Proxy(db, { get: (目标, 名) => (名 === 'find' ? (表, ...其余) => { if (表 === 'audit_log') 次数++; return 目标.find(表, ...其余); } : 目标[名]) });
    const 回 = await 管理(数着);
    expect(次数).toBeLessThanOrEqual(2);
    expect(回.比赛们.find(c => c.id === 'event-多-3').最新新维护).toMatchObject({ 成功: false, 时间: '2026-11-04T03:00:00.000Z' });
  });
  test('读维护详情：交回这个比赛最新一条新维护的全部内容，不交回整个列表', async () => {
    const db = 准备();
    记新维护(db, 'event-math', '2026-11-07T07:30:00.000Z', { 成功: false, 摘要: '没找到官网', 结果: '没找到官网', 原因: '搜不到', 入库: [], 过程: [] });
    记新维护(db, 'event-math', '2026-11-08T07:30:00.000Z', 成功详情);
    const 回 = await 管理(db, { 动作: '读维护详情', 编号: 'event-math' });
    expect(回.比赛们).toBeUndefined();
    expect(回.结果).toEqual({ 动作: '读维护详情', 编号: 'event-math', 详情: { 时间: '2026-11-08T07:30:00.000Z', ...成功详情, 改动: [] }, 届次名: {}, 字段说明: {} });
  });
  test('读维护详情：没有新维护记录的给 null；旧记录缺的字段补成空；没有这个比赛的报错', async () => {
    const db = 准备();
    expect((await 管理(db, { 动作: '读维护详情', 编号: 'event-agent' })).结果.详情).toBeNull();
    记新维护(db, 'event-art', '2026-11-06T01:00:00.000Z', { 结果: '没变' });
    expect((await 管理(db, { 动作: '读维护详情', 编号: 'event-art' })).结果.详情).toEqual({ 时间: '2026-11-06T01:00:00.000Z', 成功: null, 摘要: '', 结果: '没变', 原因: '', 入库: [], 过程: [], 改动: [] });
    await expect(管理(db, { 动作: '读维护详情', 编号: 'event-none' })).rejects.toThrow('没有这个比赛');
  });
  test('维护标记：成功绿色、失败红色，能点开；没有记录、没写成功、没维护过的不着色、不能点', () => {
    const 时间 = '2026-11-08T07:30:00.000Z';
    expect(维护标记({ last_maintained_at: 时间, 最新新维护: { 成功: true, 摘要: '入库 2 条', 时间 } })).toEqual({ 文字: '最新维护 2026-11-08 15:30', 颜色: '成功', 可展开: true });
    expect(维护标记({ last_maintained_at: 时间, 最新新维护: { 成功: false, 摘要: '被审核挡掉', 时间 } })).toEqual({ 文字: '最新维护 2026-11-08 15:30', 颜色: '失败', 可展开: true });
    expect(维护标记({ last_maintained_at: 时间, 最新新维护: { 成功: null, 摘要: '', 时间 } })).toEqual({ 文字: '最新维护 2026-11-08 15:30', 颜色: '', 可展开: false });
    expect(维护标记({ last_maintained_at: 时间, 最新新维护: null })).toEqual({ 文字: '最新维护 2026-11-08 15:30', 颜色: '', 可展开: false });
    expect(维护标记({ last_maintained_at: null })).toEqual({ 文字: '最新维护 未维护', 颜色: '', 可展开: false });
  });
  test('维护详情展示：摘要（没有就用结果）、北京时间、结果和摘要一样时不重复；入库、过程逐条；没有记录写明', () => {
    expect(维护详情展示({ 时间: '2026-11-08T07:30:00.000Z', ...成功详情 })).toEqual({
      有: true, 颜色: '成功', 摘要: '入库 2 条', 时间: '2026-11-08 15:30', 结果: '入库', 原因: '',
      入库: 成功详情.入库, 过程: 成功详情.过程, 改动: [], 改动数: 0,
    });
    expect(维护详情展示({ 时间: '2026-11-07T07:30:00.000Z', 成功: false, 摘要: '没找到官网', 结果: '没找到官网', 原因: '搜不到', 入库: null, 过程: [{ 步骤: '官网' }] })).toMatchObject({
      颜色: '失败', 摘要: '没找到官网', 结果: '', 原因: '搜不到', 入库: [], 过程: [{ 步骤: '官网', 说明: '' }],
    });
    expect(维护详情展示({ 时间: '2026-11-06T01:00:00.000Z', 成功: null, 摘要: '', 结果: '没变', 原因: '', 入库: [], 过程: [] })).toMatchObject({ 颜色: '', 摘要: '没变', 结果: '' });
    expect(维护详情展示(null)).toEqual({ 有: false, 说明: '这个比赛还没有新维护记录' });
  });
});

// 2026-11-08 用户又定：维护核对已有比赛的字段，不对就改；展开的详情里显示改了哪些字段（改前、改后）。
// 新维护写的 detail 多一项 改动 [{ 届次, 网址, 字段, 改前, 改后 }]：届次是届次编号，字段是届次表的英文字段名。
const 改动详情 = {
  成功: true, 摘要: '入库 1 条，改了 3 处', 结果: '入库', 原因: '', 入库: [], 过程: [],
  改动: [
    { 届次: 'ed-math-2026', 网址: 'https://mcm.edu.cn/tz', 字段: 'registration_end', 改前: '2026-11-01', 改后: '2026-11-15' },
    { 届次: 'ed-math-2025', 网址: 'https://mcm.edu.cn/old', 字段: 'reward_highlights', 改前: null, 改后: ['证书荣誉', '保研考研加分'] },
    { 届次: 'ed-math-2026', 网址: 'https://mcm.edu.cn/tz', 字段: 'recommendation', 改前: { 结论: '值得参加' }, 改后: '' },
  ],
};

describe('新维护改了哪些字段（读维护详情带改动，详情里按届次显示改前、改后）', () => {
  test('读维护详情：带上改动；顺带交回这些届次的名称（只查一次这个比赛的届次）和字段说明（比赛库届次表的说明）', async () => {
    const db = 准备();
    db.insert('edition', 'ed-math-2027', { competition_id: 'event-math', ordinal: 3, edition_name: '2027 年数学建模', deleted_at: '2026-11-01T00:00:00.000Z' });
    记新维护(db, 'event-math', '2026-11-08T07:30:00.000Z', {
      ...改动详情,
      改动: [...改动详情.改动, { 届次: 'ed-math-2027', 网址: '', 字段: 'edition_name', 改前: '2027 数模', 改后: '2027 年数学建模' },
        { 届次: 'ed-不认识', 网址: '', 字段: 'no_such_field', 改前: 1, 改后: 2 }, '不是对象'],
    });
    let 查届次 = 0;
    const 数着 = new Proxy(db, { get: (目标, 名) => (名 === 'find' ? (表, ...其余) => { if (表 === 'edition') 查届次++; return 目标.find(表, ...其余); } : 目标[名]) });
    const 回 = await 管理(数着, { 动作: '读维护详情', 编号: 'event-math' });
    expect(回.结果.详情.改动).toEqual([...改动详情.改动,
      { 届次: 'ed-math-2027', 网址: '', 字段: 'edition_name', 改前: '2027 数模', 改后: '2027 年数学建模' },
      { 届次: 'ed-不认识', 网址: '', 字段: 'no_such_field', 改前: 1, 改后: 2 }]);
    expect(回.结果.届次名).toEqual({ 'ed-math-2025': '2025 年数学建模', 'ed-math-2026': '2026 年数学建模', 'ed-math-2027': '2027 年数学建模' });
    expect(回.结果.字段说明).toEqual({
      registration_end: '报名截止（原文只写日期的只存日期）', reward_highlights: '非现金回报：保研加分、实习直通……',
      recommendation: '推荐结论、理由、适合谁、准备建议、缺的信息', edition_name: '届次全称',
    });
    expect(查届次).toBeLessThanOrEqual(1);
  });
  test('读维护详情：没有改动的不查届次', async () => {
    const db = 准备();
    记新维护(db, 'event-math', '2026-11-08T07:30:00.000Z', { 成功: true, 摘要: '核对无误', 入库: [], 过程: [] });
    let 查届次 = 0;
    const 数着 = new Proxy(db, { get: (目标, 名) => (名 === 'find' ? (表, ...其余) => { if (表 === 'edition') 查届次++; return 目标.find(表, ...其余); } : 目标[名]) });
    const 回 = await 管理(数着, { 动作: '读维护详情', 编号: 'event-math' });
    expect(回.结果).toMatchObject({ 详情: { 摘要: '核对无误', 改动: [] }, 届次名: {}, 字段说明: {} });
    expect(查届次).toBe(0);
  });
  test('维护详情展示：改动按届次分组（按第一次出现的顺序），届次写名称、取不到写编号；字段写说明的短名、取不到写字段名；值：空写“（空）”、列表顿号连、对象简短 JSON、是否写是/否', () => {
    const 详情 = { 时间: '2026-11-08T07:30:00.000Z', ...改动详情, 改动: [...改动详情.改动,
      { 届次: 'ed-不认识', 网址: 'https://x.cn/n', 字段: 'pending_announcement', 改前: false, 改后: true },
      { 届次: 'ed-math-2025', 网址: '', 字段: 'no_such_field', 改前: [], 改后: 5000 }] };
    const 展示 = 维护详情展示(详情, {
      届次名: { 'ed-math-2026': '2026 年数学建模', 'ed-math-2025': '2025 年数学建模' },
      字段说明: { registration_end: '报名截止（原文只写日期的只存日期）', reward_highlights: '非现金回报：保研加分、实习直通……', recommendation: '推荐结论、理由、适合谁、准备建议、缺的信息', pending_announcement: '主办方明确说时间待公布' },
    });
    expect(展示.改动).toEqual([
      { 届次: '2026 年数学建模', 条们: [
        { 字段: '报名截止', 改前: '2026-11-01', 改后: '2026-11-15', 网址: 'https://mcm.edu.cn/tz' },
        { 字段: '推荐结论、理由、适合谁、准备建议、缺的信息', 改前: '{"结论":"值得参加"}', 改后: '（空）', 网址: 'https://mcm.edu.cn/tz' },
      ] },
      { 届次: '2025 年数学建模', 条们: [
        { 字段: '非现金回报', 改前: '（空）', 改后: '证书荣誉、保研考研加分', 网址: 'https://mcm.edu.cn/old' },
        { 字段: 'no_such_field', 改前: '（空）', 改后: '5000', 网址: '' },
      ] },
      { 届次: 'ed-不认识', 条们: [{ 字段: '主办方明确说时间待公布', 改前: '否', 改后: '是', 网址: 'https://x.cn/n' }] },
    ]);
    expect(展示.改动数).toBe(5);
    expect(维护详情展示({ 时间: '2026-11-08T07:30:00.000Z', 成功: true, 摘要: '核对无误' })).toMatchObject({ 颜色: '成功', 改动: [], 改动数: 0 });
  });
});

// 呈现在浏览器里跑；这里用一个只记标签、属性、子元素、事件的假 建 来看画出来的结构和点击行为
function 假建() {
  return (标签, 属性 = {}, ...子) => {
    const 元素 = {
      标签, 属性: {}, 子: [], 听: {}, value: 属性.value ?? '',
      // 和浏览器一样：append、replaceChildren 收到 null 会画出文字“null”（只有 建 自己会跳过空的子元素）
      append(...项们) { this.子.push(...项们.map(项 => (typeof 项 === 'object' && 项 ? 项 : String(项)))); },
      replaceChildren(...项们) { this.子 = []; this.append(...项们); },
      addEventListener(名, 函数) { this.听[名] = 函数; },
      focus() {}, setSelectionRange() {},
      get textContent() { return 文字之(this); }, set textContent(值) { this.子 = [String(值)]; },
    };
    for (const [名, 值] of Object.entries(属性)) {
      if (值 == null || 值 === false) continue;
      if (名.startsWith('on')) 元素.听[名.slice(2)] = 值; else 元素.属性[名] = 值;
    }
    元素.append(...子.flat(Infinity).filter(项 => 项 != null && 项 !== false));
    return 元素;
  };
}
const 文字之 = 节点 => (typeof 节点 === 'string' ? 节点 : 节点.子.map(文字之).join(''));
const 找元素 = (节点, 条件) => (typeof 节点 === 'string' ? [] : [...(条件(节点) ? [节点] : []), ...节点.子.flatMap(子 => 找元素(子, 条件))]);
const 有类 = 名 => 节点 => typeof 节点 !== 'string' && String(节点.属性.class || '').split(' ').includes(名);
const 等一下 = () => new Promise(好 => setTimeout(好, 0));

describe('呈现：维护时间着色、点开才展开', () => {
  const 原始数据 = 记录们 => ({
    比赛们: 记录们.map(([id, last_maintained_at, 最新新维护]) => ({ id, name: `比赛${id}`, aliases: [], last_maintained_at, 最新新维护, 届次们: [] })),
    字段表: { 比赛: [], 届次: [] }, 状态们: ['已发布', '已归档', '待人工审核'], 海报规格: {}, 维护队列: { 排队: [], 正在: [], 最近: [] }, 结果: null,
  });
  function 画(原始, 发请求) {
    const 建 = 假建();
    const 容器 = 建('div');
    const 重画 = () => { 容器.replaceChildren(); 呈现(容器, 整理(原始, {}), { 条件: {}, 改条件: 重画, 提交: vi.fn(), 发请求, 重新读取: 重画, 建 }); };
    重画();
    return 容器;
  }
  const 时间 = '2026-11-08T07:30:00.000Z';

  test('成功的是绿色按钮、失败的是红色按钮，带“点开看维护详情”提示，默认收起；没写成功、没维护过的不是按钮、不着色', () => {
    const 容器 = 画(原始数据([
      ['m1', 时间, { 成功: true, 摘要: '入库 2 条', 时间 }], ['m2', 时间, { 成功: false, 摘要: '官网打不开', 时间 }],
      ['m3', 时间, { 成功: null, 摘要: '', 时间 }], ['m4', null, null],
    ]), vi.fn());
    const 全部 = 找元素(容器, 有类('维护时间'));
    expect(全部).toHaveLength(4);
    expect(全部.filter(元素 => 元素.标签 === 'button').map(元素 => [元素.属性.class, 元素.属性.type, 元素.属性.title, 元素.属性['aria-expanded'], 元素.textContent])).toEqual([
      ['维护时间 可展开 成功', 'button', '点开看维护详情', 'false', '最新维护 2026-11-08 15:30'],
      ['维护时间 可展开 失败', 'button', '点开看维护详情', 'false', '最新维护 2026-11-08 15:30'],
    ]);
    expect(全部.filter(元素 => 元素.标签 !== 'button').map(元素 => [元素.标签, 元素.属性.class, 元素.textContent, 元素.听.click])).toEqual([
      ['span', '维护时间', '最新维护 2026-11-08 15:30', undefined], ['span', '维护时间', '最新维护 未维护', undefined],
    ]);
    expect(找元素(容器, 有类('维护详情'))).toEqual([]);
  });
  test('失败的详情：没有入库也不画出多余的东西；没有新维护记录写明', async () => {
    const 详情们 = { f1: { 时间, 成功: false, 摘要: '没找到官网', 结果: '没找到官网', 原因: '搜不到', 入库: [], 过程: [] }, f2: null };
    const 容器 = 画(原始数据([['f1', 时间, { 成功: false, 摘要: '没找到官网', 时间 }], ['f2', 时间, { 成功: true, 摘要: '入库 1 条', 时间 }]]), async ({ 编号 }) => ({ 结果: { 详情: 详情们[编号] } }));
    for (const 按钮 of 找元素(容器, 有类('维护时间'))) 按钮.听.click();
    await 等一下();
    const 面板们 = 找元素(容器, 有类('维护详情')).map(面板 => 面板.textContent);
    expect(面板们).toHaveLength(2);
    expect(面板们.find(文字 => 文字.includes('没找到官网'))).toContain('搜不到');
    expect(面板们.join('')).toContain('这个比赛还没有新维护记录');
    expect(面板们.join('')).not.toContain('null');
  });
  test('搜索记忆面板：还没有搜索记忆时不画出“null”', async () => {
    const 容器 = 画(原始数据([['s1', null, null]]), async () => ({ 结果: { 节名: ['官方域名'], 记忆: null } }));
    找元素(容器, 有类('展开'))[0].听.click();
    await 等一下();
    const [面板] = 找元素(容器, 有类('搜索记忆'));
    expect(面板.textContent).toContain('还没有搜索记忆');
    expect(面板.textContent).not.toContain('null');
  });
  test('点维护时间：展开、第一次点开才请求详情并画出摘要、原因、入库、过程；再点收起；再展开用取过的，不重复请求', async () => {
    const 发请求 = vi.fn(async () => ({ 结果: { 动作: '读维护详情', 编号: 'n1', 详情: { 时间, ...成功详情, 原因: '很长的原因'.repeat(5) } } }));
    const 容器 = 画(原始数据([['n1', 时间, { 成功: true, 摘要: '入库 2 条', 时间 }]]), 发请求);
    const 按钮 = () => 找元素(容器, 有类('维护时间'))[0];
    expect(发请求).not.toHaveBeenCalled();
    按钮().听.click();
    await 等一下();
    expect(发请求).toHaveBeenCalledWith({ 动作: '读维护详情', 编号: 'n1' });
    expect(按钮().属性['aria-expanded']).toBe('true');
    const [面板] = 找元素(容器, 有类('维护详情'));
    const 文字 = 面板.textContent;
    for (const 片段 of ['入库 2 条', '2026-11-08 15:30', '很长的原因', 'https://mcm.edu.cn/a', '待人工审核', '官网', '用比赛库里的官网']) expect(文字).toContain(片段);
    expect(文字).not.toContain('null');
    // 面板紧跟在这个比赛那一行后面
    const 列表 = 找元素(容器, 有类('两级列表'))[0];
    expect(列表.子.findIndex(有类('维护详情'))).toBe(列表.子.findIndex(有类('一级行')) + 1);
    按钮().听.click();
    expect(找元素(容器, 有类('维护详情'))).toEqual([]);
    expect(按钮().属性['aria-expanded']).toBe('false');
    按钮().听.click();
    await 等一下();
    expect(找元素(容器, 有类('维护详情'))).toHaveLength(1);
    expect(发请求).toHaveBeenCalledTimes(1);
  });
  test('改动：在入库后面按届次列出“字段：改前 → 改后”，依据网址是新标签页打开的链接；没有改动不画这一块', async () => {
    const 结果们 = {
      g1: { 详情: { 时间, ...成功详情, 摘要: '入库 2 条，改了 3 处', 改动: 改动详情.改动 },
        届次名: { 'ed-math-2026': '2026 年数学建模' }, 字段说明: { registration_end: '报名截止（原文只写日期的只存日期）', reward_highlights: '非现金回报：保研加分、实习直通……' } },
      g2: { 详情: { 时间, 成功: true, 摘要: '核对无误', 结果: '', 原因: '', 入库: [], 过程: [], 改动: [] }, 届次名: {}, 字段说明: {} },
    };
    const 容器 = 画(原始数据([['g1', 时间, { 成功: true, 摘要: '入库 2 条，改了 3 处', 时间 }], ['g2', 时间, { 成功: true, 摘要: '核对无误', 时间 }]]),
      async ({ 编号 }) => ({ 结果: { 动作: '读维护详情', 编号, ...结果们[编号] } }));
    for (const 按钮 of 找元素(容器, 有类('维护时间'))) 按钮.听.click();
    await 等一下();
    const [有改动, 没改动] = 找元素(容器, 有类('维护详情'));
    const 块们 = 找元素(有改动, 有类('维护改动'));
    expect(块们).toHaveLength(1);
    const 文字 = 块们[0].textContent;
    for (const 片段 of ['改动（3 处）', '2026 年数学建模', '报名截止：', '2026-11-01 → 2026-11-15', 'ed-math-2025', '非现金回报：', '（空） → 证书荣誉、保研考研加分', 'recommendation：', '{"结论":"值得参加"} → （空）']) expect(文字).toContain(片段);
    // 入库在前、改动在后
    const 小节 = 有改动.子.filter(子 => typeof 子 !== 'string' && 子.标签 === 'section');
    expect(小节.map(节 => 节.子[0].textContent.replace(/（.*/, ''))).toEqual(['入库', '改动', '过程']);
    const 链接们 = 找元素(块们[0], 节点 => typeof 节点 !== 'string' && 节点.标签 === 'a');
    expect(链接们.map(链接 => 链接.属性.href)).toEqual(['https://mcm.edu.cn/tz', 'https://mcm.edu.cn/tz', 'https://mcm.edu.cn/old']);
    for (const 链接 of 链接们) {
      expect(链接.属性.target).toBe('_blank');
      expect(链接.属性.rel).toMatch(/noopener/);
    }
    expect(找元素(没改动, 有类('维护改动'))).toEqual([]);
    expect(没改动.textContent).toContain('核对无误');
    expect(有改动.textContent + 没改动.textContent).not.toContain('null');
  });
});

describe('呈现：维护选中（2026-11-12 用户定：改走新维护，任意数量）', () => {
  const 原始数据 = 个数 => ({
    比赛们: Array.from({ length: 个数 }, (_, i) => ({ id: `m${i}`, name: `比赛${String(i).padStart(3, '0')}`, aliases: [], last_maintained_at: null, 最新新维护: null, 届次们: [] })),
    字段表: { 比赛: [], 届次: [] }, 状态们: ['已发布', '已归档', '待人工审核'], 海报规格: {}, 维护队列: { 排队: ['m1'], 正在: ['m0'], 最近: [] }, 结果: null,
  });
  function 画(原始, 提交) {
    const 建 = 假建();
    const 容器 = 建('div');
    const 重画 = () => { 容器.replaceChildren(); 呈现(容器, 整理(原始, {}), { 条件: {}, 改条件: 重画, 提交, 发请求: vi.fn(), 重新读取: 重画, 建 }); };
    重画();
    return 容器;
  }
  const 按钮 = (容器, 开头) => 找元素(容器, 节点 => 节点.标签 === 'button' && 节点.textContent.startsWith(开头))[0];

  test('按钮叫“维护选中”；全选 120 个不拦；确认框说新维护、不提 Codex；提交 启动维护 带全部编号', async () => {
    const 弹过 = [];
    const 问过 = [];
    globalThis.window = { alert: x => 弹过.push(x), confirm: x => { 问过.push(x); return true; } };
    try {
      const 提交 = vi.fn(async () => {});
      const 容器 = 画(原始数据(120), 提交);
      expect(按钮(容器, '维护选中').textContent).toBe('维护选中（0）');
      expect(按钮(容器, 'AI 维护')).toBeUndefined();
      按钮(容器, '全选本页').听.click();
      expect(弹过).toEqual([]);
      expect(按钮(容器, '维护选中').textContent).toBe('维护选中（120）');
      按钮(容器, '维护选中').听.click();
      await 等一下();
      expect(问过).toHaveLength(1);
      expect(问过[0]).toContain('120 个比赛');
      expect(问过[0]).toContain('新维护');
      expect(问过[0]).not.toMatch(/Codex|AI 维护/);
      expect(提交).toHaveBeenCalledTimes(1);
      const [{ 动作, 编号们 }] = 提交.mock.calls[0];
      expect(动作).toBe('启动维护');
      expect(new Set(编号们)).toEqual(new Set(Array.from({ length: 120 }, (_, i) => `m${i}`)));
    } finally { delete globalThis.window; }
  });
  test('一个个勾也不限数量；比赛行照旧显示维护中、排队中', () => {
    const 弹过 = [];
    globalThis.window = { alert: x => 弹过.push(x), confirm: () => false };
    try {
      const 容器 = 画(原始数据(60), vi.fn());
      for (const 框 of 找元素(容器, 有类('选比赛'))) 框.听.change({ target: { checked: true } });
      expect(弹过).toEqual([]);
      expect(按钮(容器, '维护选中').textContent).toBe('维护选中（60）');
      const 状态们 = 找元素(容器, 有类('维护状态')).map(x => x.textContent);
      expect(状态们).toEqual(['维护中', '排队中']);
      按钮(容器, '全选本页').听.click();   // 全选了再点是全不选，清掉，免得影响别的测试
    } finally { delete globalThis.window; }
  });
});


test('本周维护按北京时间和维护计划统计，三个状态不重复，并可叠加届次状态', async () => {
  const db = open();
  const 比赛们 = [
    ['done', '2026-11-08T16:00:00.000Z'],
    ['outside', '2026-11-08T15:59:59.000Z'],
    ['due', '2026-10-13T00:00:00.000Z'],
    ['edge', '2026-10-19T16:00:00.000Z'],
    ['queued', '2026-11-06T00:00:00.000Z'],
    ['running', '2026-11-09T00:00:00.000Z'],
    ['never', null],
  ];
  for (const [id, at] of 比赛们) {
    db.insert('competition', id, { name: '测试比赛 ' + id, level: '国家级', last_maintained_at: at });
    db.insert('edition', 'edition-' + id, { competition_id: id, ordinal: 1, edition_name: '测试届次 ' + id, status: '已归档' });
  }
  db.insert('edition', 'edition-due-2', { competition_id: 'due', ordinal: 2, edition_name: '第二届', status: '已归档' });
  const 当前时间 = () => new Date('2026-11-13T02:00:00.000Z');
  维护队列.加入(db, ['running', 'queued'], { at: 当前时间().toISOString() });
  维护队列.领下一个(db, { at: 当前时间().toISOString() });
  const 数据 = await 处理后台请求('比赛管理', {}, { db, now: 当前时间 });
  const 本周 = 整理(数据, { 状态: '已归档', 本周维护: '本周需要维护' });
  expect(Object.fromEntries(本周.本周筛选项)).toEqual({
    全部维护状态: 7, 本周需要维护: 5, 本周未维护: 3, 本周已维护: 1, 维护中: 1,
  });
  expect(本周.组们.map(x => x.比赛.id).sort()).toEqual(['done', 'due', 'never', 'queued', 'running']);
  expect(整理(数据, { 本周维护: '维护中' }).组们.map(x => x.比赛.id)).toEqual(['running']);
  expect(整理(数据, { 本周维护: '本周已维护' }).组们.map(x => x.比赛.id)).toEqual(['done']);
  expect(整理(数据, { 关键词: 'due', 本周维护: '本周未维护' }).组们.map(x => x.比赛.id)).toEqual(['due']);
});

test('本周维护下拉紧跟届次状态，切换时只更新本周维护条件', () => {
  const 建 = 假建();
  const 容器 = 建('div');
  const 改条件 = vi.fn();
  const 数据 = 整理({ 比赛们: [], 字段表: { 比赛: [], 届次: [] } });
  呈现(容器, 数据, { 条件: {}, 建, 改条件 });
  const 工具栏 = 找元素(容器, 有类('工具栏'))[0];
  const [状态, 本周] = 工具栏.子.filter(x => x.标签 === 'select');
  expect(工具栏.子.indexOf(本周)).toBe(工具栏.子.indexOf(状态) + 1);
  expect(本周.子.map(x => x.属性.value)).toEqual(['全部维护状态', '本周需要维护', '本周未维护', '本周已维护', '维护中']);
  本周.听.change({ target: { value: '本周未维护' } });
  expect(改条件).toHaveBeenCalledWith({ 本周维护: '本周未维护' });
});
