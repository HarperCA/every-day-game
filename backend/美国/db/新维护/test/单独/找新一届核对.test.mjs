// 找新一届 · 程序核对（2026-11-12 用户定）：比赛名要程序对上、届次（中文/阿拉伯互认）或年份比库里最新一届新才算新一届；
// 招新、承办申报、校赛实施方案、获奖公示这类通知不拿来建新一届。全是纯函数。
import { describe, expect, test } from 'vitest';
import { 认本赛届次, 是新届, 排除原因, 最新届信息, 届次文字, 有比赛名, 网址日期, 正文发布日期, 发布日期, 上届结束, 太旧原因, 不是详情页原因, 取最新一届 } from '../../找新一届/核对.mjs';
import { 名称写法 } from '../../找官网/核实.mjs';

const 数模 = { name: '全国大学生数学建模竞赛', aliases: ['国赛数模'] };
const 名们 = 名称写法(数模);

describe('认本赛届次', () => {
  test('标题里只有一个届次、一个年份：都认（中文、阿拉伯数字一样）', () => {
    expect(认本赛届次('关于举办2027年第十八届全国大学生数学建模竞赛的通知', 名们)).toMatchObject({ 届: 18, 年: 2027 });
    expect(认本赛届次('关于举办第18届全国大学生数学建模竞赛的通知', 名们)).toMatchObject({ 届: 18, 年: null });
  });
  test('“第十六届…暨第二十届全国…”：认紧挨着本赛名字的那个届次', () => {
    const 江苏 = { name: '江苏省大学生数学建模竞赛' };
    const 题 = '关于举办第十六届江苏省大学生数学建模竞赛暨第二十届全国大学生数学建模竞赛江苏赛区选拔赛的通知';
    expect(认本赛届次(题, 名们).届).toBe(20);
    expect(认本赛届次(题, 名称写法(江苏)).届).toBe(16);
  });
  test('多个届次都不挨着本赛名字：认不出，不猜', () => {
    expect(认本赛届次('第十六届和第二十届颁奖暨全国大学生数学建模竞赛交流会', 名们).届).toBe(null);
  });
  test('年份区间“2026—2027”：起止都认', () => {
    expect(认本赛届次('2026-2027年度全国大学生数学建模竞赛报名通知', 名们)).toMatchObject({ 年: 2026, 年止: 2027 });
  });
  test('正文：只认紧挨着比赛名的届次，不拿正文里的日期当年份', () => {
    const 正文 = '各学院：现将第十八届全国大学生数学建模竞赛有关事项通知如下。请于2026年3月10日前报送。';
    expect(认本赛届次(正文, 名们, { 兜底: false })).toMatchObject({ 届: 18, 年: null });
  });
});

describe('是新届', () => {
  const 最新 = 最新届信息([{ ordinal: 1, edition_year: '2025', edition_ordinal: '第十七届' }]);
  test('届次比库里最新一届大才算（第18届=第十八届）', () => {
    expect(是新届({ 届: 18, 年: null }, 最新)).toBe(true);
    expect(是新届({ 届: 17, 年: 2026 }, 最新)).toBe(false);   // 届次和年份冲突时以届次为准
    expect(是新届({ 届: 16, 年: null }, 最新)).toBe(false);
  });
  test('没有届次看年份：比最新一届的年份新才算；最新一届是区间的比区间后一年', () => {
    expect(是新届({ 届: null, 年: 2026 }, 最新)).toBe(true);
    expect(是新届({ 届: null, 年: 2025 }, 最新)).toBe(false);
    const 区间 = 最新届信息([{ ordinal: 3, edition_year: '2025—2026', edition_ordinal: null }]);
    expect(是新届({ 届: null, 年: 2026 }, 区间)).toBe(false);
    expect(是新届({ 届: null, 年: 2026, 年止: 2027 }, 区间)).toBe(true);
    expect(是新届({ 届: null, 年: 2027 }, 区间)).toBe(true);
  });
  test('认不出届次和年份、或库里最新一届比不了：null（不建）', () => {
    expect(是新届({ 届: null, 年: null }, 最新)).toBe(null);
    expect(是新届({ 届: 18, 年: null }, 最新届信息([{ ordinal: 1, edition_year: null, edition_ordinal: null, edition_name: '数学建模' }]))).toBe(null);
  });
  test('最新届信息：届次、年份从 edition_ordinal、edition_year 认，没写的从届次全称认', () => {
    expect(最新届信息([{ ordinal: 1, edition_name: '2024年第十五届数学建模' }, { ordinal: 2, edition_name: '2025年第十六届数学建模' }])).toMatchObject({ 届: 16, 年: 2025, 年止: 2025, 中文: true });
  });
});

describe('排除原因', () => {
  test.each([
    ['关于2027年全国大学生数学建模竞赛协会招新的通知', '招新'],
    ['关于申报承办第十八届全国大学生数学建模竞赛的通知', '承办申报'],
    ['某某大学第十八届全国大学生数学建模竞赛校赛实施方案', '校赛'],
    ['第十七届全国大学生数学建模竞赛获奖名单公示', '获奖公示'],
  ])('%s → 排除', (标题, 含) => expect(排除原因(标题)).toContain(含));
  test('举办、报名、组织参加的通知不排除', () => {
    expect(排除原因('关于组织参加第十八届全国大学生数学建模竞赛的通知')).toBe('');
    expect(排除原因('关于举办2027年全国大学生数学建模竞赛的通知')).toBe('');
  });
  test('国家级比赛的赛区、省赛通知排除（省里的截止和赛制不是全国的）', () => {
    expect(排除原因('第十八届全国大学生数学建模竞赛江苏赛区通知', { 国家级: true })).toContain('赛区');
    expect(排除原因('第十八届全国大学生数学建模竞赛江苏赛区通知')).toBe('');
  });
});

test('有比赛名：标题或正文里有名称写法任一（规范化后比）', () => {
  expect(有比赛名('关于 国赛数模 报名', 名们)).toBe(true);
  expect(有比赛名('全国大学生数学竞赛', 名们)).toBe(false);
});

test('届次文字：照库里最新一届的写法（中文或阿拉伯数字）', () => {
  expect(届次文字(18, { 中文: true })).toBe('第十八届');
  expect(届次文字(21, { 中文: true })).toBe('第二十一届');
  expect(届次文字(10, { 中文: true })).toBe('第十届');
  expect(届次文字(18, { 中文: false })).toBe('第18届');
  expect(届次文字(null, {})).toBe(null);
});

// 2026-11-13 服务器试跑抽查出的两个错（用户定三条规矩，高校转发补救和找新一届共用）：
//   全国智慧城市与智能建造大学生创新创业竞赛：用 2024-10-12 的转发页建了“第五届”——转发页太旧；
//   上海市大学生原创文学大赛：一次建了第十届、第十三届两届，第十届的来源还是列表页。
const 南通 = 'https://xgc.ntu.edu.cn/2024/1012/c2608a251445/page.psp';   // 详情页，但太旧
const 华师 = 'https://xsgzb.ecnu.edu.cn/p40114c8089/list6.htm';          // 列表页

describe('转发页要够新（发布日期）', () => {
  test('网址里的日期：/2024/1012/、/2024/10/12/、t20241012_ 都认；没有日期的是 null', () => {
    expect(网址日期(南通)).toBe('2024-10-12');
    expect(网址日期('https://jwc.a.edu.cn/2026/03/05/art_1.html')).toBe('2026-03-05');
    expect(网址日期('https://www.a.gov.cn/202410/t20241012_123.html')).toBe('2024-10-12');
    expect(网址日期('https://jwc.a.edu.cn/info/1001/20241012345.htm')).toBe(null);   // 编号不是日期
    expect(网址日期('https://jwc.a.edu.cn/info/1001/2345.htm')).toBe(null);
    expect(网址日期(华师)).toBe(null);
  });
  test('正文里的发布时间：只认“发布时间/发布日期/发表时间/更新时间”这类标出来的，不拿比赛时间、截止日期当发布日期', () => {
    expect(正文发布日期('关于组织参加竞赛的通知\n发布时间：2024-10-12 浏览次数：88\n报名截止日期：2026-12-01')).toBe('2024-10-12');
    expect(正文发布日期('发布日期: 2024年10月12日 来源：教务处')).toBe('2024-10-12');
    expect(正文发布日期('作者：教务处 时间：2025/3/8 点击：12')).toBe('2025-03-08');
    expect(正文发布日期('比赛时间：2026-05-01；报名截止日期：2026-04-01')).toBe(null);
  });
  test('发布日期：搜索结果的 date、网址里的日期、正文里的发布时间都认，取最早的（搜索引擎的日期可能是收录日期）', () => {
    expect(发布日期({ 搜索日期: '2026-11-01', 网址: 南通 })).toBe('2024-10-12');
    expect(发布日期({ 搜索日期: '2026-11-01T08:00:00+08:00', 网址: 'https://a.edu.cn/info/1.htm' })).toBe('2026-11-01');
    expect(发布日期({ 搜索日期: '', 网址: 'https://a.edu.cn/info/1.htm', 正文: '发布时间：2025-12-01' })).toBe('2025-12-01');
    expect(发布日期({ 搜索日期: '不知道', 网址: 'https://a.edu.cn/info/1.htm', 正文: '' })).toBe(null);
  });
  test('上届结束：比赛结束 → 报名截止 → 最新一届年份的年底；都没有是 null', () => {
    expect(上届结束({ competition_end: '2025-08-20', registration_end: '2025-04-15' }, { 年: 2025, 年止: 2025 })).toBe('2025-08-20');
    expect(上届结束({ registration_end: '2026-11-01T08:00:00+08:00' }, { 年: 2026 })).toBe('2026-11-01');
    expect(上届结束({}, { 年: 2024, 年止: 2025 })).toBe('2025-12-31');
    expect(上届结束({}, { 年: null, 年止: null })).toBe(null);
  });
  test('太旧原因：要在最近 12 个月内，并且晚于库里最新一届的结束；过期的写“转发页太旧：日期”', () => {
    const 今天 = '2026-11-13';
    expect(太旧原因('2024-10-12', { 今天, 上届结束: '2023-12-10' })).toContain('转发页太旧：2024-10-12');   // 南通那条：两年前的
    expect(太旧原因('2025-11-12', { 今天, 上届结束: null })).toContain('转发页太旧：2025-11-12');
    expect(太旧原因('2025-11-13', { 今天, 上届结束: null })).toBe('');
    expect(太旧原因('2026-03-01', { 今天, 上届结束: '2026-05-01' })).toContain('转发页太旧：2026-03-01');
    expect(太旧原因('2026-05-01', { 今天, 上届结束: '2026-05-01' })).toContain('转发页太旧');
    expect(太旧原因('2026-06-01', { 今天, 上届结束: '2026-05-01' })).toBe('');
  });
  test('认不出日期：标题或正文有明确比库里新的年份/届次才用，否则不用', () => {
    expect(太旧原因(null, { 今天: '2026-11-13', 上届结束: '2025-12-31', 明确更新: true })).toBe('');
    expect(太旧原因(null, { 今天: '2026-11-13', 上届结束: '2025-12-31' })).toContain('认不出发布日期');
  });
});

describe('来源必须是通知详情页', () => {
  test('真实网址：南通大学那条是详情页；华东师大那条 list6.htm 是列表页', () => {
    expect(不是详情页原因(南通)).toBe('');
    expect(不是详情页原因(华师)).toContain('列表页');
  });
  test.each([
    'https://jwc.a.edu.cn/',
    'https://jwc.a.edu.cn',
    'https://jwc.a.edu.cn/index.htm',
    'https://jwc.a.edu.cn/tzgg/index.html',
    'https://jwc.a.edu.cn/list/12.htm',
    'https://www.a.gov.cn/col/col123/index.html',
    'https://jwc.a.edu.cn/tzgg/',
    'https://jwc.a.edu.cn/xwdt/list.jsp?page=2',
  ])('%s：首页、栏目页、列表页不算', 网址 => expect(不是详情页原因(网址)).not.toBe(''));
  test.each([
    'https://jwc.a.edu.cn/info/1001/2345.htm',
    'https://jwc.a.edu.cn/2026/0301/c123a456/page.htm',
    'https://www.a.gov.cn/art/2026/3/1/art_1_2.html',
    'https://jwc.a.edu.cn/tzgg/20260301/123.html',
  ])('%s：通知详情页', 网址 => expect(不是详情页原因(网址)).toBe(''));
  test('页面像列表（链接多、正文几乎都是链接文字）也不算；正文长的详情页带一堆相关链接照样算', () => {
    const 链们 = Array.from({ length: 15 }, (_, i) => ({ url: `https://a.edu.cn/info/${i}.htm`, text: `关于第${i + 1}届某某大赛的通知公告` }));
    const 列表文 = 链们.map(l => `${l.text} 2026-0${(l.text.length % 9) + 1}-01`).join('\n');
    expect(不是详情页原因('https://a.edu.cn/info/1.htm', { links: 链们, text: 列表文 })).toContain('像列表');
    const 详情文 = `各学院：${'现将有关事项通知如下，请认真组织学生报名参赛。'.repeat(40)}`;
    expect(不是详情页原因('https://a.edu.cn/info/1.htm', { links: 链们, text: 详情文 })).toBe('');
  });
});

describe('只建最新的一届', () => {
  test('同一次找到多个更新的届次：只取届次（没有届次比年份）最大的那一届', () => {
    expect(取最新一届([{ 届: 10, 年: null }, { 届: 13, 年: null }, { 届: 11, 年: 2026 }])).toMatchObject({ 届: 13 });
    expect(取最新一届([{ 届: null, 年: 2026, 年止: 2026 }, { 届: null, 年: 2027, 年止: 2027 }])).toMatchObject({ 年: 2027 });
    expect(取最新一届([])).toBe(null);
  });
});

test('高校搜索结果命中的独立附件不作为通知详情来源', () => {
  const 附件 = 'https://www.sumhs.edu.cn/_upload/article/files/e3/db/ad0696b844a7966ade6830c56aed/85889113-378f-42e1-9ae6-2109086fb5c7.docx#1#1#1';
  expect(不是详情页原因(附件, null, { 高校转发: true })).toContain('独立附件');
  expect(不是详情页原因('https://news.swmu.edu.cn/info/1005/26099.htm', null, { 高校转发: true })).toBe('');
});

test('排除高校获奖报道，防止当成可报名的通知', () => {
  expect(排除原因('北航代表队在第十九届北京市大学生物理实验竞赛中斩获3项一等奖')).toContain('报道');
});
