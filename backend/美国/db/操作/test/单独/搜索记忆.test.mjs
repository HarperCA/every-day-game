// 搜索记忆（2026-11-07 用户定）：每个比赛一份 Markdown，记官方域名、通知列表页、往年通知标题格式、
// 成功过的搜索词（年份、届次留空）、往年真实发布日期、最多 3 条教训、最近 5 条维护记录（2026-11-08 加）。存在比赛库 search_memory 表，经 db/index.mjs 的 搜索记忆.* 读写。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../test/复用/样例数据.mjs';
import { 搜索记忆, 比赛 } from '../../../index.mjs';

const 空白 = [
  '# 搜索记忆', '',
  '## 官方域名', '',
  '## 通知列表页', '',
  '## 往年通知标题格式', '',
  '## 成功过的搜索词', '',
  '## 往年真实发布日期', '',
  '## 教训', '',
  '## 维护记录', '',
].join('\n');

const 写满的 = [
  '# 搜索记忆', '',
  '## 官方域名', '', '- mcm.edu.cn', '',
  '## 通知列表页', '', '- https://mcm.edu.cn/tzgg/', '',
  '## 往年通知标题格式', '', '- 关于举办{年份}年全国大学生数学建模竞赛的通知', '',
  '## 成功过的搜索词', '', '- {年份} 全国大学生数学建模竞赛 通知 site:mcm.edu.cn', '',
  '## 往年真实发布日期', '', '- 2025：2025-05-20', '- 2024：2024-05-18', '',
  '## 教训', '', '- 学校转载的通知标题会加“转发”，要追回原文', '',
  '## 维护记录', '', '- 2026-11-08 成功：没有变化（指纹和上次一样，跳过）', '- 2026-11-01 失败：没发现这个比赛的通知', '',
].join('\n');

// 2026-11-08 以前写的记忆没有“维护记录”这一节
const 旧格式 = 写满的.replace(/\n## 维护记录[\s\S]*$/, '');

describe('格式', () => {
  test('节的名字和顺序固定', () => {
    expect(搜索记忆.节名).toEqual(['官方域名', '通知列表页', '往年通知标题格式', '成功过的搜索词', '往年真实发布日期', '教训', '维护记录']);
    expect(搜索记忆.最多教训).toBe(3);
    expect(搜索记忆.最多维护记录).toBe(5);
    expect(搜索记忆.每条维护记录最长).toBe(200);
  });
  test('解析成每节的条目，再生成回去一字不差', () => {
    const 节 = 搜索记忆.解析(写满的);
    expect(节).toEqual({
      官方域名: ['mcm.edu.cn'], 通知列表页: ['https://mcm.edu.cn/tzgg/'],
      往年通知标题格式: ['关于举办{年份}年全国大学生数学建模竞赛的通知'],
      成功过的搜索词: ['{年份} 全国大学生数学建模竞赛 通知 site:mcm.edu.cn'],
      往年真实发布日期: ['2025：2025-05-20', '2024：2024-05-18'],
      教训: ['学校转载的通知标题会加“转发”，要追回原文'],
      维护记录: ['2026-11-08 成功：没有变化（指纹和上次一样，跳过）', '2026-11-01 失败：没发现这个比赛的通知'],
    });
    expect(搜索记忆.生成(节)).toBe(写满的);
    expect(搜索记忆.解析(空白)).toEqual(Object.fromEntries(搜索记忆.节名.map(名 => [名, []])));
  });
  test.each([
    ['少了一节', 写满的.replace('## 教训\n\n- 学校转载的通知标题会加“转发”，要追回原文\n', '')],
    ['顺序不对', 写满的.replace('## 官方域名', '## 临时').replace('## 通知列表页', '## 官方域名').replace('## 临时', '## 通知列表页')],
    ['多了不认识的节', 写满的 + '\n## 别的\n'],
    ['没有总标题', 写满的.replace('# 搜索记忆\n', '')],
    ['条目不是 - 开头', 写满的.replace('- mcm.edu.cn', 'mcm.edu.cn')],
    ['教训超过 3 条', 写满的.replace('\n## 维护记录', '- 二\n- 三\n- 四\n\n## 维护记录')],
    ['维护记录超过 5 条', 写满的 + '- 三\n- 四\n- 五\n- 六\n'],
    ['维护记录放在教训前面', 旧格式.replace('## 教训', '## 维护记录\n\n- 一\n\n## 教训')],
    ['维护记录后面还有别的节', 写满的 + '\n## 教训\n'],
  ])('%s → 校验不通过', (_名, md) => {
    expect(() => 搜索记忆.解析(md)).toThrow(expect.objectContaining({ kind: '校验不通过' }));
  });
  test('生成时也检查：教训超过 3 条、不认识的节、条目里有换行', () => {
    const 基础 = 搜索记忆.解析(空白);
    expect(() => 搜索记忆.生成({ ...基础, 教训: ['一', '二', '三', '四'] })).toThrow(expect.objectContaining({ kind: '校验不通过' }));
    expect(() => 搜索记忆.生成({ ...基础, 别的: [] })).toThrow(expect.objectContaining({ kind: '校验不通过' }));
    expect(() => 搜索记忆.生成({ ...基础, 官方域名: ['a\nb'] })).toThrow(expect.objectContaining({ kind: '校验不通过' }));
  });
  test('旧的记忆没有“维护记录”这一节也能解析（当空的），生成时补上这一节；别的节照样不能少', () => {
    const 节 = 搜索记忆.解析(旧格式);
    expect(节.维护记录).toEqual([]);
    expect(节.教训).toEqual(['学校转载的通知标题会加“转发”，要追回原文']);
    expect(搜索记忆.生成(节)).toBe(`${旧格式}\n## 维护记录\n`);
    expect(() => 搜索记忆.解析(旧格式.replace(/## 教训[\s\S]*$/, ''))).toThrow(expect.objectContaining({ kind: '校验不通过' }));
  });
  test('生成时维护记录超过 5 条报校验不通过；每条的空白和换行并成一个空格，超过 200 字截断', () => {
    const 基础 = 搜索记忆.解析(空白);
    expect(() => 搜索记忆.生成({ ...基础, 维护记录: ['1', '2', '3', '4', '5', '6'] })).toThrow(expect.objectContaining({ kind: '校验不通过' }));
    const 长 = `2026-11-01 失败：${'很长的原因'.repeat(60)}`;
    const 节 = 搜索记忆.解析(搜索记忆.生成({ ...基础, 维护记录: ['2026-11-08 失败：读了\n3 条全文，  都不是', 长] }));
    expect(节.维护记录[0]).toBe('2026-11-08 失败：读了 3 条全文， 都不是');
    expect([...节.维护记录[1]].length).toBe(200);
    expect(节.维护记录[1].startsWith('2026-11-01 失败：很长的原因')).toBe(true);
    expect(节.维护记录[1].endsWith('…')).toBe(true);
  });
  test('整份超过 8000 字时先从最旧的维护记录删起；删光还超就照旧不让写', () => {
    const 基础 = 搜索记忆.解析(空白);
    const 词们 = n => Array.from({ length: n }, (_, i) => `词${i}`.padEnd(10, '的'));
    const 记录 = Array.from({ length: 5 }, (_, i) => `2026-11-0${9 - i} 成功：${'没'.repeat(150)}`);
    const md = 搜索记忆.生成({ ...基础, 成功过的搜索词: 词们(560), 维护记录: 记录 });  // 搜索词约 7300 字，5 条记录约 840 字
    expect([...md].length).toBeLessThanOrEqual(8000);
    const 留下 = 搜索记忆.解析(md).维护记录;
    expect(留下.length).toBeGreaterThan(0);
    expect(留下.length).toBeLessThan(5);
    expect(留下).toEqual(记录.slice(0, 留下.length));
    const 太长 = 搜索记忆.生成({ ...基础, 成功过的搜索词: 词们(900), 维护记录: 记录 });
    expect(搜索记忆.解析(太长).维护记录).toEqual([]);
    const db = open(); seed(db);
    expect(() => 搜索记忆.写(db, 'event-math', 太长, { 操作人: '新维护' })).toThrow(expect.objectContaining({ kind: '校验不通过' }));
  });
  test('初始：比赛库里有官网的写上域名并注明还没核实，其余留空', () => {
    expect(搜索记忆.初始({ website: 'https://www.mcm.edu.cn/html_cn/index.html' })).toBe(空白.replace('## 官方域名\n\n', '## 官方域名\n\n- www.mcm.edu.cn（比赛库官网字段，还没核实）\n\n'));
    expect(搜索记忆.初始({})).toBe(空白);
    expect(搜索记忆.初始({ website: '不是网址' })).toBe(空白);
  });
});

describe('读写比赛库', () => {
  const 准备 = () => { const db = open(); seed(db); return db; };
  test('没写过的读出来是 null', () => {
    expect(搜索记忆.读(准备(), 'event-math')).toBeNull();
  });
  test('第一次写不带版本号，之后要带读到的版本号；记下谁写的', () => {
    const db = 准备();
    expect(搜索记忆.写(db, 'event-math', 写满的, { 操作人: '新维护' })).toMatchObject({ version: 1 });
    const 读到 = 搜索记忆.读(db, 'event-math');
    expect(读到).toMatchObject({ 比赛: 'event-math', version: 1, 内容: 写满的, updated_by: '新维护' });
    expect(读到.节.官方域名).toEqual(['mcm.edu.cn']);
    expect(() => 搜索记忆.写(db, 'event-math', 空白, { 操作人: '新维护' })).toThrow(expect.objectContaining({ kind: '请求有误' }));
    expect(() => 搜索记忆.写(db, 'event-math', 空白, { 版本: 9, 操作人: '新维护' })).toThrow(expect.objectContaining({ kind: '版本冲突' }));
    expect(搜索记忆.写(db, 'event-math', 空白, { 版本: 1, 操作人: '后台' })).toMatchObject({ version: 2 });
    expect(搜索记忆.读(db, 'event-math')).toMatchObject({ 内容: 空白, updated_by: '后台' });
  });
  test('格式不对的不写', () => {
    const db = 准备();
    expect(() => 搜索记忆.写(db, 'event-math', '随便写', { 操作人: '新维护' })).toThrow(expect.objectContaining({ kind: '校验不通过' }));
    expect(搜索记忆.读(db, 'event-math')).toBeNull();
  });
  test('太长的不写（最长 8000 字）', () => {
    const db = 准备();
    const 长 = 搜索记忆.生成({ ...搜索记忆.解析(空白), 成功过的搜索词: Array.from({ length: 900 }, (_, i) => `词${i}`.padEnd(10, '的')) });
    expect(() => 搜索记忆.写(db, 'event-math', 长, { 操作人: '新维护' })).toThrow(expect.objectContaining({ kind: '校验不通过' }));
  });
  test('没有这个比赛的写不进去', () => {
    expect(() => 搜索记忆.写(准备(), 'event-none', 空白, { 操作人: '新维护' })).toThrow(expect.objectContaining({ kind: '指向的记录不存在' }));
  });
  test('改节：只换给出的节，别的节不动；还没有记忆的从初始开始', () => {
    const db = 准备();
    db.transaction(tx => tx.update('competition', 'event-math', { website: 'https://mcm.edu.cn/' }, tx.get('competition', 'event-math').version));
    expect(搜索记忆.改节(db, 'event-math', { 教训: ['一'] }, { 操作人: '新维护' })).toMatchObject({ version: 1 });
    expect(搜索记忆.读(db, 'event-math').节).toMatchObject({ 官方域名: ['mcm.edu.cn（比赛库官网字段，还没核实）'], 教训: ['一'] });
    搜索记忆.改节(db, 'event-math', { 官方域名: ['mcm.edu.cn'] }, { 版本: 1, 操作人: '新维护' });
    expect(搜索记忆.读(db, 'event-math')).toMatchObject({ version: 2, 节: { 官方域名: ['mcm.edu.cn'], 教训: ['一'] } });
    expect(() => 搜索记忆.改节(db, 'event-math', { 别的: [] }, { 版本: 2, 操作人: '新维护' })).toThrow(expect.objectContaining({ kind: '校验不通过' }));
    expect(() => 搜索记忆.改节(db, 'event-math', { 教训: ['一', '二', '三', '四'] }, { 版本: 2, 操作人: '新维护' })).toThrow(expect.objectContaining({ kind: '校验不通过' }));
    expect(() => 搜索记忆.改节(db, 'event-math', { 教训: [] }, { 版本: 1, 操作人: '新维护' })).toThrow(expect.objectContaining({ kind: '版本冲突' }));
  });
  test('改节：旧的记忆没有维护记录这一节，照样能读能改，改时补上；还没有记忆的也能直接记', () => {
    const db = 准备();
    db.transaction(tx => tx.insert('search_memory', 'event-math', { content: 旧格式, updated_by: '旧版' }));
    expect(搜索记忆.读(db, 'event-math')).toMatchObject({ version: 1, 内容: 旧格式, 节: { 维护记录: [] } });
    搜索记忆.改节(db, 'event-math', { 维护记录: ['2026-11-08 成功：没有变化（指纹和上次一样，跳过）'] }, { 版本: 1, 操作人: '新维护' });
    const 读到 = 搜索记忆.读(db, 'event-math');
    expect(读到.节).toMatchObject({ 教训: ['学校转载的通知标题会加“转发”，要追回原文'], 维护记录: ['2026-11-08 成功：没有变化（指纹和上次一样，跳过）'] });
    expect(读到.内容).toContain('## 维护记录\n\n- 2026-11-08 成功');
    搜索记忆.改节(db, 'event-art', { 维护记录: ['2026-11-08 失败：没找到官网'] }, { 操作人: '新维护' });
    expect(搜索记忆.读(db, 'event-art').节.维护记录).toEqual(['2026-11-08 失败：没找到官网']);
  });
  test('补齐：没有记忆的比赛（含回收站里的）写上初始的，已有的不动；试跑不写', () => {
    const db = 准备();
    搜索记忆.写(db, 'event-math', 写满的, { 操作人: '新维护' });
    db.标记删除('competition', 'event-art', { by: '管理员' });
    expect(搜索记忆.补齐(db, { 试跑: true, 操作人: '补齐' })).toEqual({ 新建: ['event-art'], 已有: 1 });
    expect(搜索记忆.读(db, 'event-art')).toBeNull();
    expect(搜索记忆.补齐(db, { 操作人: '补齐' })).toEqual({ 新建: ['event-art'], 已有: 1 });
    expect(搜索记忆.读(db, 'event-art')).toMatchObject({ 内容: 空白, updated_by: '补齐' });
    expect(搜索记忆.读(db, 'event-math').内容).toBe(写满的);
    expect(搜索记忆.补齐(db, { 操作人: '补齐' })).toEqual({ 新建: [], 已有: 2 });
  });
  test('比赛彻底删除时搜索记忆一起删', () => {
    const db = 准备();
    搜索记忆.写(db, 'event-art', 空白, { 操作人: '新维护' });
    db.标记删除('competition', 'event-art', { by: '管理员' });
    expect(比赛.彻底删除(db, 'event-art').连带).toMatchObject({ search_memory: 1 });
    expect(db.count('search_memory')).toBe(0);
  });
});
