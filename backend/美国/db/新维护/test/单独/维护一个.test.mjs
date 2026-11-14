// 新维护的主流程（2026-11-08 用户定），维护一个比赛（维护主要是核对已有比赛的数据对不对，不对就改）：
//   先读搜索记忆；官网起点按 website → 记忆域名 → 来源表里主办方自己的页面（打开检查）取，都没有才用 DeepSeek 搜索 API 找，
//   找不到时有权威名单就用名单核对（不转待人工审核）；挑哪几条通知交给 挑通知（一届一条主通知）；
//   没有爬虫脚本：AI 写脚本 → 爬 → 标题带比赛名的通知（不管库里有没有）交给入库工具核对或新建（04 抽取 → 05 审核 → 06 入库）→ 记指纹 → 改搜索记忆；
//   有脚本：先按上次的版本标记和指纹比，没变就跳过（只改检查时间）；变了：标题带比赛名的新增通知交给入库工具核对；
//   旧脚本跑不通（爬不到新通知）才让 AI 按要求重写操控无头浏览器的脚本，再爬、入库。
//   每次维护（成功失败都）在搜索记忆“维护记录”写一行。
// 用假的找官网、写脚本、执行脚本、入库、挑通知（有一条用真的挑通知），真的比赛库（内存）。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../test/复用/样例数据.mjs';
import { 搜索记忆, 爬虫脚本, 指纹 } from '../../../index.mjs';
import { 维护一个 } from '../../维护一个.mjs';
import { 挑通知 } from '../../挑通知.mjs';

const 列表页 = 'https://www.mcm.edu.cn/tzgg/';
const 条 = (标题, 链接) => ({ 标题, 链接, 日期: '2026-04-01' });
const 旧条目 = [条('关于举办2025年全国大学生数学建模竞赛的通知', 'https://www.mcm.edu.cn/2025.html'), 条('网站维护公告', 'https://www.mcm.edu.cn/w.html')];
const 新通知 = 条('关于举办2026年全国大学生数学建模竞赛的通知', 'https://www.mcm.edu.cn/2026.html');
const 脚本 = { 列表页, 步骤: [{ 动作: '打开', 网址: 列表页 }, { 动作: '取列表', 条目: 'ul li' }], 要浏览器: false, 写的人: 'codex', 提示版本: 'crawl-script-v1' };
const 时刻 = new Date('2026-11-08T02:00:00.000Z');

function 库({ 官网 = 'https://www.mcm.edu.cn/' } = {}) {
  const db = open(); seed(db);
  if (官网) db.transaction(tx => { const r = tx.get('competition', 'event-math'); tx.update('competition', 'event-math', { website: 官网 }, r.version); });
  return db;
}
// 假的入库工具交回（接口照 pipeline/总控/入库指定网址.mjs 加了“更新已有”以后的样子）
// 审查 11-08：入库工具给每个条目加 写进（真的写进主库），交回 写入.error（写主库出错）
const 通过 = x => ({ 网址: x.网址, 状态: '进行中', 原因: '新一届，审核通过，发布', 入库: { decision: '新一届', editionId: 'ed-new' }, 入库类型: '新一届', 改动: [], 写进: true });
const 对上 = (改动 = []) => x => ({ 网址: x.网址, 状态: '进行中', 原因: '对上已有届次', 入库: { decision: '补来源', editionId: 'ed-math-2026' }, 入库类型: '补来源', 改动, 写进: true });
const 挡掉 = x => ({ 网址: x.网址, 状态: '已丢弃', 原因: '05 审核：不是官方通知', 入库: null, 入库类型: null, 改动: [], 写进: false });
// 假的“维护记录改动”（真的在 找官网/记忆.mjs，另一个智能体在写）：记下每次写的一行，交回空改动（不写进比赛库）
// 假的挑通知（真的在 挑通知.mjs，另一个智能体在写）：默认照旧——标题带比赛名的按列表顺序取前 3 条当新的一届
const 照旧挑 = ({ 条目们, 有比赛名 }) => ({ 核对: [], 新届: 条目们.filter(x => 有比赛名(x.标题)).slice(0, 3).map(x => ({ 网址: x.链接, 标题: x.标题 })), 排除: [], 说明: [] });
// 假的判断官网（真的在 判断官网.mjs，有它自己的测试）：判 里按网址给 { 是, 原因, 最终网址 }；没给的：屏蔽网站不是，其余是
const 在屏蔽里 = (网址, 屏蔽 = []) => { const 域 = new URL(网址).hostname.replace(/^www\./, ''); return 屏蔽.some(站 => 域 === 站 || 域.endsWith(`.${站}`)); };
// 假的来源候选：除了权威名单，来源网址原样当候选，依据写来源种类
const 照旧候选 = 来源们 => ({ 候选: 来源们.filter(s => s.source_type !== 'authority_notice').map(s => ({ 网址: s.url, 依据: s.source_type })), 跳过: [] });
// 假的第三方通知（真的在 找新一届/高校转发.mjs）：转发 是交回值（{ 条目们, 过程 }）或 Error，默认什么都没找到
function 部件({ 跑 = [], 写 = [], 找 = null, 入库结果 = 通过, 写入 = { written: 3, error: null }, 挑 = 照旧挑, 判 = {}, 候选 = 照旧候选, 转发 = { 条目们: [], 过程: [] } } = {}) {
  const 调用 = { 写脚本: [], 执行脚本: [], 入库: [], 找官网: [], 维护记录: [], 挑通知: [], 判断官网: [], 来源候选: [], 算域名比赛数: [], 第三方通知: [] };
  return {
    调用,
    判断官网: async (网址, 比赛, 参数) => {
      调用.判断官网.push({ 网址, 比赛, ...参数 });
      if (判[网址]) return { 最终网址: 网址, 对上: 判[网址].是 ? '全名' : '', 标题: '', ...判[网址] };
      return 在屏蔽里(网址, 参数.屏蔽) ? { 是: false, 原因: '屏蔽网站', 最终网址: 网址, 对上: '', 标题: '' } : { 是: true, 原因: '标题有比赛全名', 最终网址: 网址, 对上: '全名', 标题: '' };
    },
    来源候选: (来源们, 参数) => { 调用.来源候选.push({ 来源们, ...参数 }); return 候选(来源们); },
    算域名比赛数: db => { 调用.算域名比赛数.push(db); return new Map([['www.mcm.edu.cn', 1]]); },
    挑通知: 参数 => { 调用.挑通知.push(参数); return 挑(参数); },
    找官网: async (比赛, 参数) => { 调用.找官网.push(参数); return 找; },
    写脚本: async (比赛, 参数) => { 调用.写脚本.push(参数); return 写.shift(); },
    执行脚本: async (s, 参数) => { 调用.执行脚本.push({ 脚本: s, ...参数 }); return 跑.shift(); },
    入库: async (网址们, 参数) => { 调用.入库.push({ 网址们, 试跑: 参数.试跑, 更新已有: 参数.更新已有, 放宽资料: 参数.放宽资料, 不审核: 参数.不审核 }); return { 条目们: 网址们.map(入库结果), 写入 }; },
    第三方通知: async (编号, 参数) => { 调用.第三方通知.push({ 编号, ...参数 }); if (转发 instanceof Error) throw 转发; return 转发; },
    维护记录改动: (节, 一行) => { 调用.维护记录.push(一行); return {}; },
  };
}
// 假的读网页：按网址给页面，记下读了哪些；没给的算打不开
function 假读网页(页们 = {}) {
  const 读过 = [];
  const 读网页 = async 网址 => { 读过.push(网址); return 页们[网址] ?? { status: '网络错误', title: '', text: '', finalUrl: 网址, error: '连接被拒绝' }; };
  return { 读过, 读网页 };
}
const 页 = (title, text) => ({ status: '成功', title, text, finalUrl: '', error: '' });
// 有脚本、有旧指纹的库：这次爬到 条目们
function 有脚本的库() {
  const db = 库();
  爬虫脚本.写(db, 'event-math', 脚本);
  指纹.记(db, 'event-math', { 列表页, 条目们: 旧条目, 时间: '2026-11-01T00:00:00.000Z' });
  return db;
}
const 后台记录 = db => db.find('audit_log', { action: '新维护' }).at(-1)?.detail;
const 写好 = (条目们, 改 = {}) => ({ 结果: '写好', 脚本: { ...脚本, ...改 }, 试跑: { 状态: '成功', 条目们, etag: '"v1"', 最后修改: null }, 轮们: [{ 轮: 1, 状态: '规则', 说明: '' }], 用量: { tokensIn: 20000, tokensOut: 300 }, 原因: '' });
const 跑 = (条目们, etag = '"v2"') => ({ 状态: '成功', 条目们, 最终网址: 列表页, etag, 最后修改: null, 错误: '' });
const 选项 = (db, 件, 改 = {}) => ({ db, ai: null, 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: async () => ({}) }, 部件: 件, now: () => 时刻, ...改 });

describe('维护一个比赛', () => {
  test('第一次（没有脚本）：写脚本、存进比赛库；有比赛名的通知交给入库（带比赛编号、更新已有）；记指纹；搜索记忆写上通知列表页和官方域名；记维护时间', async () => {
    const db = 库();
    const 件 = 部件({ 写: [写好([...旧条目, 新通知])] });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.写脚本[0]).toMatchObject({ 起点网址: 'https://www.mcm.edu.cn/' });
    expect(件.调用.入库[0].网址们).toEqual([
      { 网址: 'https://www.mcm.edu.cn/2025.html', 标题: '关于举办2025年全国大学生数学建模竞赛的通知', 比赛名: '全国大学生数学建模竞赛', 比赛编号: 'event-math' },
      { 网址: 'https://www.mcm.edu.cn/2026.html', 标题: '关于举办2026年全国大学生数学建模竞赛的通知', 比赛名: '全国大学生数学建模竞赛', 比赛编号: 'event-math' },
    ]);
    expect(件.调用.入库[0].更新已有).toBe(true);
    expect(回).toMatchObject({ 比赛: 'event-math', 结果: '入库', 成功: true, 摘要: '入库 2 条', 入库: [{ 状态: '进行中' }, { 状态: '进行中' }] });
    expect(爬虫脚本.读(db, 'event-math')).toMatchObject({ 列表页, 写的人: 'codex', 要浏览器: false });
    expect(指纹.读(db, 'event-math')).toMatchObject({ 列表页, etag: '"v1"', 条目们: [...旧条目, 新通知] });
    // 官方域名记原样主机名（带 www 的保留 www，审查 11-08）
    expect(搜索记忆.读(db, 'event-math').节).toMatchObject({ 官方域名: ['www.mcm.edu.cn'], 通知列表页: [列表页], 往年通知标题格式: ['关于举办{年份}年全国大学生数学建模竞赛的通知'] });
    expect(db.get('competition', 'event-math').data.last_maintained_at).toBe(时刻.toISOString());
  });
  test('手动查新届：指纹已见过的通知也对照现有届次，只交新届，不覆盖定时维护的指纹', async () => {
    const db = 有脚本的库();
    const 下一届 = 条('关于举办2027年全国大学生数学建模竞赛的通知', 'https://www.mcm.edu.cn/2027.html');
    const 列表 = [...旧条目, 新通知, 下一届];
    指纹.记(db, 'event-math', { 列表页, etag: '"v2"', 条目们: 列表, 时间: '2026-11-01T00:00:00.000Z' });
    const 件 = 部件({ 跑: [跑(列表)], 挑: 挑通知 });
    const 回 = await 维护一个('event-math', 选项(db, 件, { 仅查新届: true }));
    expect(回).toMatchObject({ 成功: true, 摘要: '入库 1 条' });
    expect(件.调用.入库[0]).toMatchObject({ 更新已有: false,
      网址们: [{ 比赛编号: 'event-math', 网址: 下一届.链接 }] });
    expect(指纹.读(db, 'event-math').检查时间).toBe('2026-11-01T00:00:00.000Z');
    db.close();
  });
  test('手动查新届：库里是赛项页时补搜总赛官网，从核准的新起点抓取', async () => {
    const 赛项页 = 'https://sub.example.cn/events/race?track=3';
    const db = 库({ 官网: 赛项页 });
    const 官网 = { 首页: 'https://www.mcm.edu.cn/', 网址: 'https://www.mcm.edu.cn/' };
    const 下一届 = 条('关于举办2027年全国大学生数学建模竞赛的通知', 'https://www.mcm.edu.cn/2027.html');
    const 件 = 部件({ 找: { 结果: '找到', 官网 }, 写: [写好([下一届])], 挑: 挑通知 });
    const 回 = await 维护一个('event-math', 选项(db, 件, { 仅查新届: true }));
    expect(件.调用.找官网[0].屏蔽).toContain('sub.example.cn');
    expect(件.调用.写脚本[0].起点网址).toBe(官网.首页);
    expect(回).toMatchObject({ 成功: true, 摘要: '入库 1 条' });
    db.close();
  });
  test('有脚本、网站说没更新（304）：跳过，只改检查时间', async () => {
    const db = 库();
    爬虫脚本.写(db, 'event-math', 脚本);
    指纹.记(db, 'event-math', { 列表页, etag: '"v1"', 条目们: 旧条目, 时间: '2026-11-01T00:00:00.000Z' });
    const 件 = 部件({ 跑: [{ 状态: '没更新', 条目们: [], etag: '"v1"', 最后修改: null, 错误: '' }] });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.执行脚本[0]).toMatchObject({ etag: '"v1"' });
    expect(回).toMatchObject({ 结果: '没变' });
    expect(件.调用.写脚本).toHaveLength(0);
    expect(件.调用.入库).toHaveLength(0);
    expect(指纹.读(db, 'event-math')).toMatchObject({ 检查时间: 时刻.toISOString(), 变化时间: '2026-11-01T00:00:00.000Z' });
  });
  test('有脚本、指纹没变：跳过', async () => {
    const db = 库();
    爬虫脚本.写(db, 'event-math', 脚本);
    指纹.记(db, 'event-math', { 列表页, 条目们: 旧条目, 时间: '2026-11-01T00:00:00.000Z' });
    const 件 = 部件({ 跑: [跑([...旧条目].reverse())] });
    expect(await 维护一个('event-math', 选项(db, 件))).toMatchObject({ 结果: '没变', 成功: true, 摘要: '没有变化', 原因: '指纹和上次一样，跳过' });
    expect(件.调用.入库).toHaveLength(0);
    expect(爬虫脚本.读(db, 'event-math').上次跑通).toBe(时刻.toISOString());
    expect(db.get('competition', 'event-math').data.last_maintained_at).toBe(时刻.toISOString());
  });
  // 2026-11-08 用户定：维护主要是核对已有比赛的数据对不对，不对就改
  test('指纹变了：标题带比赛名的新增通知不管库里有没有都交给入库工具核对；对上已有届次、没有要改的 → 成功“核对无误”，更新指纹', async () => {
    const db = 库();
    爬虫脚本.写(db, 'event-math', 脚本);
    指纹.记(db, 'event-math', { 列表页, 条目们: 旧条目, 时间: '2026-11-01T00:00:00.000Z' });
    db.transaction(tx => tx.insert('source', 'src-2026', { edition_id: 'ed-math-2026', url: 新通知.链接, source_type: 'official_notice', is_official: true, validity_status: 'valid' }));
    const 件 = 部件({ 跑: [跑([条('关于端午节放假的通知', 'https://www.mcm.edu.cn/d.html'), 新通知, ...旧条目])], 入库结果: 对上() });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    // 2026-11-08 用户定“进行维护的时候不需要审核”：传 不审核（不跑 05）
    expect(件.调用.入库[0]).toMatchObject({ 更新已有: true, 不审核: true, 放宽资料: true, 网址们: [{ 网址: 新通知.链接, 比赛编号: 'event-math' }] });
    expect(件.调用.入库[0].网址们).toHaveLength(1);
    expect(回).toMatchObject({ 结果: '核对无误', 成功: true, 摘要: '核对无误', 改动: [] });
    expect(后台记录(db)).toMatchObject({ 成功: true, 摘要: '核对无误', 改动: [] });
    expect(指纹.读(db, 'event-math')).toMatchObject({ 变化时间: 时刻.toISOString() });
  });
  test('指纹变了、有库里没有的新通知：旧脚本爬到了，直接交给入库（不重写脚本）', async () => {
    const db = 库();
    爬虫脚本.写(db, 'event-math', 脚本);
    指纹.记(db, 'event-math', { 列表页, 条目们: 旧条目, 时间: '2026-11-01T00:00:00.000Z' });
    const 件 = 部件({ 跑: [跑([新通知, ...旧条目])] });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.写脚本).toHaveLength(0);
    expect(件.调用.入库[0].网址们.map(x => x.网址)).toEqual([新通知.链接]);
    expect(回).toMatchObject({ 结果: '入库' });
    expect(指纹.读(db, 'event-math').条目们).toHaveLength(3);
  });
  test('旧脚本跑不通：记失败，让 AI 按要求重写操控无头浏览器的脚本（带原因和旧脚本），新脚本爬到的新通知交给入库', async () => {
    const db = 库();
    爬虫脚本.写(db, 'event-math', 脚本);
    指纹.记(db, 'event-math', { 列表页, 条目们: 旧条目, 时间: '2026-11-01T00:00:00.000Z' });
    const 件 = 部件({ 跑: [{ 状态: '失败', 条目们: [], 错误: '取不到条目（ul li）' }], 写: [写好([新通知, ...旧条目], { 要浏览器: true })] });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.写脚本[0]).toMatchObject({ 要浏览器: true, 原因: '旧脚本跑不通：取不到条目（ul li）', 旧脚本: { 列表页 } });
    expect(爬虫脚本.读(db, 'event-math')).toMatchObject({ 要浏览器: true, version: 3, 连续失败: 0 });
    expect(件.调用.入库[0].网址们.map(x => x.网址)).toEqual([新通知.链接]);
    expect(回).toMatchObject({ 结果: '入库' });
  });
  test('写不出脚本：搜索记忆记一条教训，不记指纹', async () => {
    const db = 库();
    const 件 = 部件({ 写: [{ 结果: '写不出', 脚本: null, 试跑: null, 轮们: [], 用量: {}, 原因: '3 轮都没写出能用的脚本' }] });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(回).toMatchObject({ 结果: '写不出脚本', 原因: '3 轮都没写出能用的脚本' });
    expect(指纹.读(db, 'event-math')).toBeNull();
    expect(搜索记忆.读(db, 'event-math').节.教训).toEqual(['2026-11-08 写不出爬虫脚本：3 轮都没写出能用的脚本']);
  });
  test('没有官网：先用找官网（DeepSeek 搜索 API）找；找到了从它的首页开始写脚本；没找到就停下，记下原因', async () => {
    const db = 库({ 官网: null });
    const 找到 = { 结果: '找到', 官网: { 域名: 'mcm.edu.cn', 首页: 'https://www.mcm.edu.cn/', 网址: 'https://www.mcm.edu.cn/a.html' }, 记忆改动: { 官方域名: ['mcm.edu.cn'] } };
    const 件 = 部件({ 找: 找到, 写: [写好([新通知])] });
    expect(await 维护一个('event-math', 选项(db, 件))).toMatchObject({ 结果: '入库' });
    expect(件.调用.找官网).toHaveLength(1);
    expect(件.调用.写脚本[0].起点网址).toBe('https://www.mcm.edu.cn/');
    const db2 = 库({ 官网: null });
    const 没找到 = 部件({ 找: { 结果: '待审', 官网: null, 原因: 'DeepSeek 认为前 10 条里没有官网', 记忆改动: { 教训: ['2026-11-08 搜比赛名没找到官网：x'] } } });
    expect(await 维护一个('event-math', 选项(db2, 没找到))).toMatchObject({ 结果: '没找到官网，转待人工审核', 原因: 'DeepSeek 认为前 10 条里没有官网' });
    expect(搜索记忆.读(db2, 'event-math').节.教训).toEqual(['2026-11-08 搜比赛名没找到官网：x']);
  });
  test('比赛库官网字段指向屏蔽名单里的网站（竞赛聚合站）：当作没有官网，去找官网', async () => {
    const db = 库({ 官网: 'https://cxcy26.saikr.com/' });
    const 件 = 部件({ 找: { 结果: '待审', 官网: null, 原因: 'x', 记忆改动: {} } });
    await 维护一个('event-math', 选项(db, 件, { 屏蔽: ['saikr.com'] }));
    expect(件.调用.找官网).toHaveLength(1);
    expect(件.调用.写脚本).toHaveLength(0);
  });
  // 2026-11-08 用户定：找不到官网就先跳过，移到待审核里，要写清楚原因
  test('找不到官网：最新一届转待人工审核，状态理由写清楚哪天、搜了什么、为什么没找到；不记成人工改的；留一条后台记录', async () => {
    const db = 库({ 官网: null });
    const 没找到 = 部件({ 找: { 结果: '待审', 官网: null, 原因: 'DeepSeek 认为前 10 条里没有官网：都是学校转发', 记忆改动: {} } });
    await 维护一个('event-math', 选项(db, 没找到));
    const 届 = db.get('edition', 'ed-math-2026').data;
    expect(届.status).toBe('待人工审核');
    expect(届.status_at).toBe(时刻.toISOString());
    expect(届.status_reason.at(-1)).toBe('新维护 2026-11-08：找不到官网（搜索「全国大学生数学建模竞赛」，DeepSeek 认为前 10 条里没有官网：都是学校转发），原来是已发布，转待人工审核');
    expect(届.manual_fields || []).not.toContain('status');
    expect(db.get('edition', 'ed-math-2025').data.status).toBe('待人工审核');   // 只动最新一届
    expect(db.find('audit_log', { action: '新维护转待人工审核' })).toHaveLength(1);
  });
  test('找不到官网时不动的：人工定过状态的届次（只记原因）；官网打不开（网络问题）不转；试跑不写', async () => {
    const db = 库({ 官网: null });
    db.transaction(tx => { const r = tx.get('edition', 'ed-math-2026'); tx.update('edition', 'ed-math-2026', { manual_fields: ['status'] }, r.version); });
    const 没找到 = () => 部件({ 找: { 结果: '待审', 官网: null, 原因: 'x', 记忆改动: {} } });
    expect(await 维护一个('event-math', 选项(db, 没找到()))).toMatchObject({ 结果: '没找到官网（最新一届是人工定的状态，没转）' });
    expect(db.get('edition', 'ed-math-2026').data.status).toBe('已发布');
    const db2 = 库({ 官网: null });
    expect(await 维护一个('event-math', 选项(db2, 部件({ 找: { 结果: '网络问题', 官网: null, 打不开: ['https://a.cn/'], 原因: '官网打不开：超时', 记忆改动: {} } })))).toMatchObject({ 结果: '没找到官网（官网打不开，下次再试）' });
    expect(db2.get('edition', 'ed-math-2026').data.status).toBe('已发布');
    const db3 = 库({ 官网: null });
    await 维护一个('event-math', 选项(db3, 没找到(), { 试跑: true }));
    expect(db3.get('edition', 'ed-math-2026').data.status).toBe('已发布');
  });
  test('试跑：照常判断，但脚本、指纹、记忆、维护时间都不写，入库按试跑', async () => {
    const db = 库();
    const 件 = 部件({ 写: [写好([新通知])] });
    const 回 = await 维护一个('event-math', 选项(db, 件, { 试跑: true }));
    expect(回.结果).toBe('入库');
    expect(件.调用.入库[0].试跑).toBe(true);
    expect(爬虫脚本.读(db, 'event-math')).toBeNull();
    expect(指纹.读(db, 'event-math')).toBeNull();
    expect(搜索记忆.读(db, 'event-math')).toBeNull();
    expect(db.get('competition', 'event-math').data.last_maintained_at ?? null).toBeNull();
  });
});

// 2026-11-08 用户定：标题里没有比赛名时，读新通知全文找（程序读，不调 AI），最多读 3 条
describe('标题找不到新通知时读全文', () => {
  const 甲 = { 标题: '关于举办第十届大赛的通知', 链接: 'https://www.mcm.edu.cn/a.html', 日期: '2026-10-01' };
  const 乙 = { 标题: '关于开展暑期活动的通知', 链接: 'https://www.mcm.edu.cn/b.html', 日期: '2026-10-20' };
  const 丙 = { 标题: '报名系统升级说明', 链接: 'https://www.mcm.edu.cn/c.html', 日期: '' };
  const 丁 = { 标题: '关于端午节放假的通知', 链接: 'https://www.mcm.edu.cn/d.html', 日期: '2026-06-01' };
  const 戊 = { 标题: '专家名单公示', 链接: 'https://www.mcm.edu.cn/e.html', 日期: '2026-11-01' };

  test('新增条目标题都没有比赛名：按日期从新到旧（没日期的排最后）读最多 3 条全文，含比赛名的交给入库；每一步写进过程', async () => {
    const db = 有脚本的库();
    const 件 = 部件({ 跑: [跑([甲, 乙, 丙, 丁, 戊, ...旧条目])] });
    const 读 = 假读网页({
      [戊.链接]: 页('专家名单公示', '评审专家名单如下'),
      [乙.链接]: 页('暑期活动', '学院暑期活动安排'),
      [甲.链接]: 页('关于举办第十届大赛的通知', '第十届全国大学生数学建模竞赛将于9月举行'),
    });
    const 回 = await 维护一个('event-math', 选项(db, 件, { 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: 读.读网页 } }));
    expect(读.读过).toEqual([戊.链接, 乙.链接, 甲.链接]);   // 11-01、10-20、10-01；丁更旧、丙没日期，没轮到
    expect(件.调用.入库[0].网址们).toEqual([{ 网址: 甲.链接, 标题: 甲.标题, 比赛名: '全国大学生数学建模竞赛', 比赛编号: 'event-math' }]);
    expect(件.调用.入库[0].更新已有).toBe(true);
    expect(回).toMatchObject({ 结果: '入库', 成功: true, 摘要: '入库 1 条' });
    expect(回.过程.filter(x => x.步骤 === '读全文').map(x => x.说明)).toEqual([`${戊.链接}：没有比赛名`, `${乙.链接}：没有比赛名`, `${甲.链接}：有比赛名`]);
    expect(后台记录(db)).toMatchObject({ 结果: '入库', 成功: true, 摘要: '入库 1 条' });
  });

  test('别名、“正文太短”也算读到；读到的含比赛名的都交给入库（最多 3 条）', async () => {
    const db = 有脚本的库();
    db.transaction(tx => { const r = tx.get('competition', 'event-math'); tx.update('competition', 'event-math', { aliases: ['数模国赛'] }, r.version); });
    const 件 = 部件({ 跑: [跑([甲, 乙, ...旧条目])] });
    const 读 = 假读网页({
      [甲.链接]: { status: '正文太短', title: '数模国赛 第十届', text: '', finalUrl: 甲.链接, error: '' },
      [乙.链接]: 页('通知', '本届 数模国赛 报名开始'),
    });
    const 回 = await 维护一个('event-math', 选项(db, 件, { 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: 读.读网页 } }));
    expect(件.调用.入库[0].网址们.map(x => x.网址)).toEqual([乙.链接, 甲.链接]);
    expect(回).toMatchObject({ 成功: true, 摘要: '入库 2 条' });
  });

  test('读了 3 条全文都不是这个比赛的（打不开的也算用掉一次）：停下，算失败，原因列出每条', async () => {
    const db = 有脚本的库();
    const 件 = 部件({ 跑: [跑([甲, 乙, 戊, 丙, ...旧条目])] });
    const 读 = 假读网页({ [戊.链接]: 页('专家名单公示', '评审专家名单如下'), [甲.链接]: 页('第十届大赛', '书法大赛') });
    const 回 = await 维护一个('event-math', 选项(db, 件, { 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: 读.读网页 } }));
    expect(读.读过).toEqual([戊.链接, 乙.链接, 甲.链接]);
    expect(件.调用.入库).toHaveLength(0);
    expect(回).toMatchObject({
      结果: '读了全文，没发现这个比赛的通知', 成功: false, 摘要: '没发现这个比赛的通知',
      原因: `标题里没有比赛名；读了 3 条新通知全文，都不是这个比赛的：${戊.标题}；${乙.标题}（打不开：连接被拒绝）；${甲.标题}`,
    });
    expect(回.过程).toContainEqual({ 步骤: '读全文', 说明: `${乙.链接}：打不开：连接被拒绝` });
    expect(后台记录(db)).toMatchObject({ 成功: false, 摘要: '没发现这个比赛的通知', 原因: 回.原因 });
    expect(指纹.读(db, 'event-math').条目们).toEqual(旧条目);   // 不记指纹，下次轮到还当新增再读
  });

  // 2026-11-08 用户定：读 3 条全文都不是就标失败写原因，下次轮到还要读——不管打没打开都不记指纹
  test('读到的都不是（没有打不开的）：也不记指纹，下次轮到还读；记检查时间（维护时间）', async () => {
    const db = 有脚本的库();
    const 读 = 假读网页({ [丁.链接]: 页('放假', '端午节放假安排') });
    const 回 = await 维护一个('event-math', 选项(db, 部件({ 跑: [跑([丁, ...旧条目])] }), { 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: 读.读网页 } }));
    expect(回).toMatchObject({ 成功: false, 原因: `标题里没有比赛名；读了 1 条新通知全文，都不是这个比赛的：${丁.标题}` });
    expect(指纹.读(db, 'event-math').条目们).toEqual(旧条目);
    expect(db.get('competition', 'event-math').data.last_maintained_at).toBe(时刻.toISOString());
    const 再读 = 假读网页({ [丁.链接]: 页('放假', '端午节放假安排') });
    await 维护一个('event-math', 选项(db, 部件({ 跑: [跑([丁, ...旧条目])] }), { now: () => new Date(时刻.getTime() + 60000), 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: 再读.读网页 } }));
    expect(再读.读过).toEqual([丁.链接]);
  });

  test('候选不到 3 条：读完就停；都不是 → 失败；读网页抛错也算打不开', async () => {
    const db = 有脚本的库();
    const 件 = 部件({ 跑: [跑([丁, ...旧条目])] });
    const 读网页 = async () => { throw new Error('炸了'); };
    const 回 = await 维护一个('event-math', 选项(db, 件, { 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页 } }));
    expect(回).toMatchObject({ 成功: false, 摘要: '没发现这个比赛的通知', 原因: `标题里没有比赛名；读了 1 条新通知全文，都不是这个比赛的：${丁.标题}（打不开：炸了）` });
  });

  test('新增条目库里已经有了也照样读全文，含比赛名的交给入库核对', async () => {
    const db = 有脚本的库();
    db.transaction(tx => tx.insert('source', 'src-a', { edition_id: 'ed-math-2026', url: 甲.链接, source_type: 'official_notice', is_official: true, validity_status: 'valid' }));
    const 件 = 部件({ 跑: [跑([甲, ...旧条目])], 入库结果: 对上() });
    const 读 = 假读网页({ [甲.链接]: 页('通知', '全国大学生数学建模竞赛') });
    const 回 = await 维护一个('event-math', 选项(db, 件, { 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: 读.读网页 } }));
    expect(读.读过).toEqual([甲.链接]);
    expect(件.调用.入库[0]).toMatchObject({ 更新已有: true, 网址们: [{ 网址: 甲.链接, 比赛编号: 'event-math' }] });
    expect(回).toMatchObject({ 成功: true, 摘要: '核对无误' });
  });

  test('同一个链接标题改了也算有变化的条目（指纹按链接和标题算）', async () => {
    const db = 有脚本的库();
    const 改名 = { ...旧条目[1], 标题: '关于2026年全国大学生数学建模竞赛延期的通知' };
    const 件 = 部件({ 跑: [跑([旧条目[0], 改名])], 入库结果: 对上() });
    await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.入库[0].网址们.map(x => x.网址)).toEqual([改名.链接]);
  });

  test('只少了条目、没有新增或改了的：没有变化，记指纹', async () => {
    const db = 有脚本的库();
    const 件 = 部件({ 跑: [跑([旧条目[0]])] });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(回).toMatchObject({ 成功: true, 摘要: '没有变化' });
    expect(件.调用.入库).toHaveLength(0);
    expect(指纹.读(db, 'event-math').条目们).toEqual([旧条目[0]]);
  });

  test('试跑：照常读全文判断，入库按试跑，不写库', async () => {
    const db = 有脚本的库();
    const 件 = 部件({ 跑: [跑([甲, ...旧条目])] });
    const 读 = 假读网页({ [甲.链接]: 页('通知', '全国大学生数学建模竞赛') });
    const 回 = await 维护一个('event-math', 选项(db, 件, { 试跑: true, 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: 读.读网页 } }));
    expect(读.读过).toEqual([甲.链接]);
    expect(件.调用.入库[0]).toMatchObject({ 试跑: true, 网址们: [{ 网址: 甲.链接 }] });
    expect(回).toMatchObject({ 成功: true, 摘要: '入库 1 条' });
    expect(后台记录(db)).toBeUndefined();
    expect(指纹.读(db, 'event-math').条目们).toEqual(旧条目);
  });
});

// 2026-11-08 用户定：每次维护给出成功/失败和简短摘要，写进后台记录（和后台的接口，摘要文字固定）
describe('成功/失败和摘要', () => {
  test('没有变化、核对无误：成功', async () => {
    const db = 有脚本的库();
    expect(await 维护一个('event-math', 选项(db, 部件({ 跑: [{ 状态: '没更新', 条目们: [], 错误: '' }] })))).toMatchObject({ 成功: true, 摘要: '没有变化' });
    expect(后台记录(db)).toMatchObject({ 结果: '没变', 成功: true, 摘要: '没有变化' });
    const db2 = 有脚本的库();
    expect(await 维护一个('event-math', 选项(db2, 部件({ 跑: [跑([...旧条目])] })))).toMatchObject({ 成功: true, 摘要: '没有变化' });
    const db3 = 有脚本的库();
    db3.transaction(tx => tx.insert('source', 'src-2026', { edition_id: 'ed-math-2026', url: 新通知.链接, source_type: 'official_notice', is_official: true, validity_status: 'valid' }));
    expect(await 维护一个('event-math', 选项(db3, 部件({ 跑: [跑([新通知, ...旧条目])], 入库结果: 对上() })))).toMatchObject({ 成功: true, 摘要: '核对无误' });
    const db4 = 有脚本的库();
    const 处理过 = x => ({ 网址: x.网址, 状态: '已丢弃', 原因: '这条通知处理过了', 入库: null, 入库类型: '已处理过', 改动: [] });
    expect(await 维护一个('event-math', 选项(db4, 部件({ 跑: [跑([新通知, ...旧条目])], 入库结果: 处理过 })))).toMatchObject({ 成功: true, 摘要: '核对无误' });
  });

  test('核对改了已有届次的字段：成功“改了 M 处”；后台记录和返回值带 改动（网址是依据的通知）；过程记一条“核对”', async () => {
    const db = 有脚本的库();
    const 改 = [{ 届次: 'ed-math-2026', 字段: 'registration_end', 改前: '2026-11-01T08:00:00+08:00', 改后: '2026-11-15T08:00:00+08:00' }, { 届次: 'ed-math-2026', 字段: 'fee', 改前: null, 改后: '免费' }];
    const 回 = await 维护一个('event-math', 选项(db, 部件({ 跑: [跑([新通知, ...旧条目])], 入库结果: 对上(改) })));
    const 改动 = 改.map(c => ({ ...c, 网址: 新通知.链接 }));
    expect(回).toMatchObject({ 结果: '入库', 成功: true, 摘要: '改了 2 处', 改动 });
    expect(后台记录(db)).toMatchObject({ 成功: true, 摘要: '改了 2 处', 改动 });
    const 核对 = 回.过程.find(x => x.步骤 === '核对');
    expect(核对.说明).toContain('改了 2 处');
    expect(核对.说明).toContain('ed-math-2026 registration_end');
  });

  test('有新建也有改动：“入库 N 条，改了 M 处”；新建只数新比赛/新一届、并且真的写进库的', async () => {
    const db = 有脚本的库();
    const 二 = 条('关于举办2026年全国大学生数学建模竞赛的补充通知', 'https://www.mcm.edu.cn/2026b.html');
    const 三 = 条('全国大学生数学建模竞赛获奖名单', 'https://www.mcm.edu.cn/2026c.html');
    const 改 = [{ 届次: 'ed-math-2026', 字段: 'fee', 改前: null, 改后: '免费' }];
    const 结果 = x => x.网址 === 新通知.链接 ? 通过(x)
      : x.网址 === 二.链接 ? 对上(改)(x)
        : { ...通过(x), 状态: '已丢弃', 原因: '写入主库时字段不合格', 写进: false };   // 入库还留着、但没真的写进主库：不算
    const 回 = await 维护一个('event-math', 选项(db, 部件({ 跑: [跑([新通知, 二, 三, ...旧条目])], 入库结果: 结果 })));
    expect(回).toMatchObject({ 成功: true, 摘要: '入库 1 条，改了 1 处' });
  });

  test('入库：按真的写进库的条数；一条都没写进 → 失败“被审核挡掉”，原因写每条的状态和原因', async () => {
    const db = 有脚本的库();
    const 二 = 条('关于举办2026年全国大学生数学建模竞赛的补充通知', 'https://www.mcm.edu.cn/2026b.html');
    const 一过一挡 = x => x.网址 === 新通知.链接 ? 通过(x) : 挡掉(x);
    expect(await 维护一个('event-math', 选项(db, 部件({ 跑: [跑([新通知, 二, ...旧条目])], 入库结果: 一过一挡 })))).toMatchObject({ 结果: '入库', 成功: true, 摘要: '入库 1 条' });
    const db2 = 有脚本的库();
    const 回 = await 维护一个('event-math', 选项(db2, 部件({ 跑: [跑([新通知, ...旧条目])], 入库结果: 挡掉 })));
    expect(回).toMatchObject({ 成功: false, 摘要: '被审核挡掉', 原因: `${新通知.链接}：已丢弃（05 审核：不是官方通知）` });
    expect(后台记录(db2)).toMatchObject({ 成功: false, 摘要: '被审核挡掉', 入库: [{ 网址: 新通知.链接, 状态: '已丢弃' }] });
  });

  test('没找到官网、官网打不开、写不出脚本：失败', async () => {
    const 没找到 = await 维护一个('event-math', 选项(库({ 官网: null }), 部件({ 找: { 结果: '待审', 官网: null, 原因: 'x', 记忆改动: {} } })));
    expect(没找到).toMatchObject({ 成功: false, 摘要: '没找到官网', 原因: 'x' });
    const db = 库({ 官网: null });
    db.transaction(tx => { const r = tx.get('edition', 'ed-math-2026'); tx.update('edition', 'ed-math-2026', { manual_fields: ['status'] }, r.version); });
    expect(await 维护一个('event-math', 选项(db, 部件({ 找: { 结果: '待审', 官网: null, 原因: 'x', 记忆改动: {} } })))).toMatchObject({ 成功: false, 摘要: '没找到官网' });
    const db2 = 库({ 官网: null });
    expect(await 维护一个('event-math', 选项(db2, 部件({ 找: { 结果: '网络问题', 官网: null, 原因: '官网打不开：超时', 记忆改动: {} } })))).toMatchObject({ 成功: false, 摘要: '官网打不开', 原因: '官网打不开：超时' });
    expect(后台记录(db2)).toMatchObject({ 成功: false, 摘要: '官网打不开' });
    const 写不出 = { 结果: '写不出', 脚本: null, 试跑: null, 轮们: [], 用量: {}, 原因: '3 轮都没写出' };
    expect(await 维护一个('event-math', 选项(库(), 部件({ 写: [写不出] })))).toMatchObject({ 成功: false, 摘要: '写不出爬虫脚本', 原因: '3 轮都没写出' });
    const db3 = 有脚本的库();
    expect(await 维护一个('event-math', 选项(db3, 部件({ 跑: [{ 状态: '失败', 条目们: [], 错误: '取不到条目' }], 写: [写不出] })))).toMatchObject({ 成功: false, 摘要: '写不出爬虫脚本' });
  });
});

// 2026-11-08 用户定：一届只用一条主通知——挑哪几条交给 挑通知（新维护/挑通知.mjs），这里只管把它挑的交给入库
describe('一届一条主通知（挑通知）', () => {
  const 名 = '全国大学生数学建模竞赛';
  const a = { 标题: `关于举办2026年${名}的通知`, 链接: 'https://www.mcm.edu.cn/a.html', 日期: '2026-03-01' };
  const b = { 标题: `2025年${名}获奖名单公示`, 链接: 'https://www.mcm.edu.cn/b.html', 日期: '' };
  const c = { 标题: `关于举办2027年${名}的通知`, 链接: 'https://www.mcm.edu.cn/c.html', 日期: '2026-10-01' };
  const e = { 标题: '端午放假通知', 链接: 'https://www.mcm.edu.cn/e.html', 日期: '2026-11-01' };
  const 加来源 = (db, id, 改) => db.transaction(tx => tx.insert('source', id, { edition_id: 'ed-math-2026', is_official: true, validity_status: 'valid', ...改 }));

  test('挑通知拿到有变化的条目、届次们（从旧到新）、各届存着的官方主办方通知、判断比赛名的函数', async () => {
    const db = 有脚本的库();
    加来源(db, 's-n26', { url: 'https://www.mcm.edu.cn/n26.html', source_type: 'organizer_notice' });
    加来源(db, 's-n26-非官方', { url: 'https://x.cn/n.html', source_type: 'organizer_notice', is_official: false });
    加来源(db, 's-w26', { url: 'https://www.mcm.edu.cn/', source_type: 'organizer_website' });
    加来源(db, 's-n25-未核', { edition_id: 'ed-math-2025', url: 'https://www.mcm.edu.cn/n25.html', source_type: 'organizer_notice', validity_status: 'unchecked' });
    const 件 = 部件({ 跑: [跑([a, b, c, e, ...旧条目])] });
    await 维护一个('event-math', 选项(db, 件));
    const 参 = 件.调用.挑通知[0];
    expect(参.条目们).toEqual([a, b, c, e]);
    expect(参.届次们).toEqual([
      { id: 'ed-math-2025', edition_year: null, edition_ordinal: null, edition_name: '2025 年数学建模' },
      { id: 'ed-math-2026', edition_year: null, edition_ordinal: null, edition_name: '2026 年数学建模' },
    ]);
    expect(参.官方通知).toEqual({ 'ed-math-2026': 'https://www.mcm.edu.cn/n26.html' });
    expect(参.有比赛名(a.标题)).toBe(true);
    expect(参.有比赛名(e.标题)).toBe(false);
  });

  test('核对 和 新届 合起来交给入库（带比赛编号、更新已有）；排除、说明写进过程', async () => {
    const db = 有脚本的库();
    const 挑 = () => ({
      核对: [{ 网址: a.链接, 标题: a.标题, 届次: 'ed-math-2026' }],
      新届: [{ 网址: c.链接, 标题: c.标题 }],
      排除: [{ 标题: b.标题, 网址: b.链接, 原因: '获奖公示类' }],
      说明: ['2026 届用存着的官方通知核对'],
    });
    const 件 = 部件({ 跑: [跑([a, b, c, e, ...旧条目])], 挑 });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    // 核对的带上挑通知认出的届次（入库工具直接对这一届核对，审查 11-08）；新届不带
    expect(件.调用.入库[0].网址们).toEqual([
      { 网址: a.链接, 标题: a.标题, 比赛名: 名, 比赛编号: 'event-math', 届次: 'ed-math-2026' },
      { 网址: c.链接, 标题: c.标题, 比赛名: 名, 比赛编号: 'event-math' },
    ]);
    expect(件.调用.入库[0].更新已有).toBe(true);
    expect(回).toMatchObject({ 成功: true, 摘要: '入库 2 条' });
    expect(回.过程).toContainEqual({ 步骤: '挑通知', 说明: `排除：${b.标题}（获奖公示类）` });
    expect(回.过程).toContainEqual({ 步骤: '挑通知', 说明: '2026 届用存着的官方通知核对' });
    expect(回.过程).toContainEqual({ 步骤: '挑通知', 说明: '核对 1 条，新的一届 1 条，排除 1 条' });
  });

  test('标题带比赛名的全被挑通知排除（如都是获奖公示）：成功“没有新通知”，原因写排除了哪些；不读全文、不入库，记指纹', async () => {
    const db = 有脚本的库();
    const b2 = { 标题: `2026年${名}复赛名单`, 链接: 'https://www.mcm.edu.cn/b2.html', 日期: '2026-10-02' };
    const 挑 = () => ({ 核对: [], 新届: [], 排除: [{ 标题: b.标题, 网址: b.链接, 原因: '获奖公示类' }, { 标题: b2.标题, 网址: b2.链接, 原因: '复赛类' }], 说明: [] });
    const 读 = 假读网页();
    const 件 = 部件({ 跑: [跑([b, b2, e, ...旧条目])], 挑 });
    const 回 = await 维护一个('event-math', 选项(db, 件, { 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: 读.读网页 } }));
    expect(回).toMatchObject({ 结果: '没有新通知', 成功: true, 摘要: '没有新通知', 原因: `排除了：${b.标题}（获奖公示类）；${b2.标题}（复赛类）` });
    expect(读.读过).toEqual([]);
    expect(件.调用.入库).toHaveLength(0);
    expect(指纹.读(db, 'event-math').条目们).toHaveLength(5);
    expect(后台记录(db)).toMatchObject({ 成功: true, 摘要: '没有新通知' });
    expect(件.调用.维护记录).toEqual([`2026-11-08 成功：没有新通知（排除了：${b.标题}（获奖公示类）；${b2.标题}（复赛类））`]);
  });

  test('标题都没有比赛名：读全文确认含比赛名的再经挑通知挑一遍（确认过的标题也算有比赛名）', async () => {
    const db = 有脚本的库();
    const 甲 = { 标题: '关于举办第十届大赛的通知', 链接: 'https://www.mcm.edu.cn/jia.html', 日期: '2026-10-01' };
    const 乙 = { 标题: '第十届大赛获奖名单公示', 链接: 'https://www.mcm.edu.cn/yi.html', 日期: '2026-10-20' };
    const 读 = 假读网页({ [甲.链接]: 页('通知', `第十届${名}`), [乙.链接]: 页('公示', `第十届${名}获奖名单`) });
    // 第一次（标题）照旧挑：都没有比赛名，挑不出；第二次（读全文确认过的）：甲当新的一届，乙是获奖公示、排除
    let 次 = 0;
    const 两次 = 参数 => { 次 += 1; return 次 === 1 ? 照旧挑(参数) : { 核对: [], 新届: [{ 网址: 甲.链接, 标题: 甲.标题 }], 排除: [{ 标题: 乙.标题, 网址: 乙.链接, 原因: '获奖公示类' }], 说明: [] }; };
    const 件 = 部件({ 跑: [跑([甲, 乙, ...旧条目])], 挑: 两次 });
    const 回 = await 维护一个('event-math', 选项(db, 件, { 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: 读.读网页 } }));
    expect(件.调用.挑通知).toHaveLength(2);
    expect(件.调用.挑通知[1].条目们).toEqual([乙, 甲]);   // 读的顺序：从新到旧
    expect(件.调用.挑通知[1].有比赛名(甲.标题)).toBe(true);
    expect(件.调用.挑通知[1].有比赛名('别的标题')).toBe(false);
    expect(件.调用.入库[0].网址们).toEqual([{ 网址: 甲.链接, 标题: 甲.标题, 比赛名: 名, 比赛编号: 'event-math' }]);
    expect(回).toMatchObject({ 成功: true, 摘要: '入库 1 条' });
    expect(回.过程).toContainEqual({ 步骤: '挑通知', 说明: `排除：${乙.标题}（获奖公示类）` });
  });

  test('默认用真的挑通知（挑通知.mjs）：同届的举办通知拿去核对，获奖公示排除', async () => {
    const db = 有脚本的库();
    const 公示 = { 标题: `2026年${名}获奖名单公示`, 链接: 'https://www.mcm.edu.cn/gs.html', 日期: '2026-10-30' };
    const { 挑通知, ...其余 } = 部件({ 跑: [跑([公示, 新通知, e, ...旧条目])], 入库结果: 对上() });
    const 回 = await 维护一个('event-math', 选项(db, 其余));
    expect(其余.调用.入库[0].网址们).toEqual([{ 网址: 新通知.链接, 标题: 新通知.标题, 比赛名: 名, 比赛编号: 'event-math', 届次: 'ed-math-2026' }]);
    expect(回.过程.filter(x => x.步骤 === '挑通知').map(x => x.说明)).toContain(`排除：${公示.标题}（获奖/公示类通知，不拿来核对）`);
    expect(回).toMatchObject({ 成功: true, 摘要: '核对无误' });
  });

  test('读全文确认的也全被排除：成功“没有新通知”', async () => {
    const db = 有脚本的库();
    const 乙 = { 标题: '第十届大赛获奖名单公示', 链接: 'https://www.mcm.edu.cn/yi.html', 日期: '2026-10-20' };
    const 读 = 假读网页({ [乙.链接]: 页('公示', `第十届${名}获奖名单`) });
    let 次 = 0;
    const 挑 = 参数 => { 次 += 1; return 次 === 1 ? 照旧挑(参数) : { 核对: [], 新届: [], 排除: [{ 标题: 乙.标题, 网址: 乙.链接, 原因: '获奖公示类' }], 说明: [] }; };
    const 件 = 部件({ 跑: [跑([乙, ...旧条目])], 挑 });
    const 回 = await 维护一个('event-math', 选项(db, 件, { 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: 读.读网页 } }));
    expect(回).toMatchObject({ 结果: '没有新通知', 成功: true, 摘要: '没有新通知', 原因: `排除了：${乙.标题}（获奖公示类）` });
    expect(件.调用.入库).toHaveLength(0);
  });
});

// 2026-11-08 用户定：先判断是不是官网再维护。起点候选按 website 字段 → 搜索记忆里核实过的域名 → 来源候选（来源表里的官方来源推出）的顺序，
// 每个都用 判断官网 判断，第一个“是”的当起点；都不是才用 DeepSeek 找官网，找到的也要过判断；都不算就停下（失败“没找到官网”）。
describe('先判断是不是官网', () => {
  const 加来源 = (db, id, 改) => db.transaction(tx => tx.insert('source', id, { edition_id: 'ed-math-2026', is_official: true, validity_status: 'valid', ...改 }));
  const 记住域名 = (db, 域名) => 搜索记忆.改节(db, 'event-math', { 官方域名: [`${域名}（DeepSeek 搜索，2026-11-01 核实）`] });
  const 学校主站 = 'https://www.bift.edu.cn/';
  const 找到 = { 结果: '找到', 官网: { 域名: 'mcm.edu.cn', 首页: 'https://www.mcm.edu.cn/', 网址: 'https://www.mcm.edu.cn/a.html' }, 记忆改动: { 官方域名: ['mcm.edu.cn（DeepSeek 搜索）'] } };
  const 没找到 = { 结果: '待审', 官网: null, 原因: 'DeepSeek 认为前 10 条里没有官网', 记忆改动: {} };
  const 官网说明 = 回 => 回.过程.filter(x => x.步骤 === '官网' || x.步骤 === '找官网').map(x => x.说明);

  test('website 是学校主站 → 跳过；记忆里核实过的域名通过 → 用它，不调来源候选、不调找官网', async () => {
    const db = 库({ 官网: 学校主站 });
    记住域名(db, 'mcm.edu.cn');
    const 件 = 部件({ 判: { [学校主站]: { 是: false, 原因: '学校主站' } }, 写: [写好([新通知])] });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.判断官网.map(x => x.网址)).toEqual([学校主站, 'https://mcm.edu.cn/']);
    expect(件.调用.来源候选).toHaveLength(0);
    expect(件.调用.算域名比赛数).toHaveLength(0);   // 没用到来源候选就不统计
    expect(件.调用.找官网).toHaveLength(0);
    expect(件.调用.写脚本[0].起点网址).toBe('https://mcm.edu.cn/');
    expect(回).toMatchObject({ 结果: '入库', 成功: true });
    expect(官网说明(回)).toEqual([
      `官网字段 ${学校主站}：学校主站，不算官网，跳过`,
      '搜索记忆里的官方域名 https://mcm.edu.cn/：是官网（标题有比赛全名），用它当起点',
    ]);
  });

  test('记忆里的域名不带 www、打不开 → 再试加 www 的（旧记忆把 www 去掉了）；加 www 的是官网就用它', async () => {
    const db = 库({ 官网: 学校主站 });
    记住域名(db, 'mcm.edu.cn');
    const 件 = 部件({ 判: { [学校主站]: { 是: false, 原因: '学校主站' }, 'https://mcm.edu.cn/': { 是: false, 原因: '打不开：fetch failed（ECONNRESET）' } }, 写: [写好([新通知])] });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.判断官网.map(x => x.网址)).toEqual([学校主站, 'https://mcm.edu.cn/', 'https://www.mcm.edu.cn/']);
    expect(件.调用.写脚本[0].起点网址).toBe('https://www.mcm.edu.cn/');
    expect(回).toMatchObject({ 成功: true });
  });

  test('加 www 的打开了但不是官网 → 不带 www 的那次打不开不算数，不按“官网打不开”收尾，接着往下（来源候选、找官网）', async () => {
    const db = 库({ 官网: 学校主站 });
    记住域名(db, 'mcm.edu.cn');
    const 件 = 部件({ 找: 找到, 判: { [学校主站]: { 是: false, 原因: '学校主站' }, 'https://mcm.edu.cn/': { 是: false, 原因: '打不开：fetch failed（ECONNRESET）' }, 'https://www.mcm.edu.cn/': { 是: false, 原因: '页面上没有比赛名（标题：首页）' } }, 写: [写好([新通知])] });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.找官网).toHaveLength(1);
    expect(回.摘要).not.toBe('官网打不开');
  });

  test('判断官网拿到 读网页、浏览器、屏蔽、库里最新年份（最新一届 edition_year 里的四位数字）', async () => {
    const db = 库();
    db.transaction(tx => { const r = tx.get('edition', 'ed-math-2026'); tx.update('edition', 'ed-math-2026', { edition_year: '2026年' }, r.version); });
    const 读网页 = async () => ({});
    const 浏览器 = { 名: '假浏览器' };
    const 件 = 部件({ 写: [写好([新通知])] });
    await 维护一个('event-math', 选项(db, 件, { 屏蔽: ['saikr.com'], 工具: { 取源码: async () => ({}), 浏览器, 读网页 } }));
    expect(件.调用.判断官网[0]).toMatchObject({ 网址: 'https://www.mcm.edu.cn/', 比赛: { id: 'event-math', name: '全国大学生数学建模竞赛' }, 读网页, 浏览器, 屏蔽: ['saikr.com'], 库里最新年份: 2026 });
    const db2 = 库();
    const 件2 = 部件({ 写: [写好([新通知])] });
    await 维护一个('event-math', 选项(db2, 件2));
    expect(件2.调用.判断官网[0].库里最新年份).toBeNull();
  });

  test('website、记忆域名都不是 → 来源候选（各届次官方有效来源，带届次序号）里第一个通过的当起点；来源候选的跳过写进过程', async () => {
    const db = 库({ 官网: 学校主站 });
    记住域名(db, 'old.mcm.edu.cn');
    加来源(db, 'w25', { edition_id: 'ed-math-2025', url: 'https://w25.mcm.edu.cn/', source_type: 'organizer_website' });
    加来源(db, 'n26', { url: 'https://www.mcm.edu.cn/tzgg/2026.html', source_type: 'organizer_notice' });
    加来源(db, '名单', { url: 'https://jyt.cn/list.pdf', source_type: 'authority_notice' });
    加来源(db, '非官方', { url: 'https://a.cn/', source_type: 'official_website', is_official: false });
    加来源(db, '未核验', { url: 'https://b.cn/', source_type: 'official_website', validity_status: 'unchecked' });
    const 候选 = () => ({ 候选: [{ 网址: 'https://www.mcm.edu.cn/', 依据: 'organizer_notice 的网站首页' }, { 网址: 'https://w25.mcm.edu.cn/', 依据: 'organizer_website 的网站首页' }], 跳过: ['https://cxcy.saikr.com/：屏蔽网站'] });
    const 件 = 部件({ 判: { [学校主站]: { 是: false, 原因: '学校主站' }, 'https://old.mcm.edu.cn/': { 是: false, 原因: '打不开（超时）' }, 'https://www.mcm.edu.cn/': { 是: false, 原因: '标题里没有比赛名' } }, 候选, 写: [写好([新通知])] });
    const 回 = await 维护一个('event-math', 选项(db, 件, { 屏蔽: ['saikr.com'] }));
    expect(件.调用.来源候选).toHaveLength(1);
    expect(件.调用.来源候选[0].来源们).toEqual(expect.arrayContaining([
      { url: 'https://w25.mcm.edu.cn/', source_type: 'organizer_website', ordinal: 1 },
      { url: 'https://www.mcm.edu.cn/tzgg/2026.html', source_type: 'organizer_notice', ordinal: 2 },
      { url: 'https://jyt.cn/list.pdf', source_type: 'authority_notice', ordinal: 2 },
    ]));
    expect(件.调用.来源候选[0].来源们).toHaveLength(3);   // 不官方、没核验有效的不给
    expect(件.调用.来源候选[0]).toMatchObject({ 屏蔽: ['saikr.com'], 域名比赛数: new Map([['www.mcm.edu.cn', 1]]) });
    expect(件.调用.判断官网.map(x => x.网址)).toEqual([学校主站, 'https://old.mcm.edu.cn/', 'https://www.mcm.edu.cn/', 'https://w25.mcm.edu.cn/']);
    expect(件.调用.找官网).toHaveLength(0);
    expect(件.调用.写脚本[0].起点网址).toBe('https://w25.mcm.edu.cn/');
    expect(官网说明(回)).toEqual([
      `官网字段 ${学校主站}：学校主站，不算官网，跳过`,
      '搜索记忆里的官方域名 https://old.mcm.edu.cn/：打不开（超时），不算官网，跳过',
      '来源表：https://cxcy.saikr.com/：屏蔽网站',
      '来源表里的官方来源 https://www.mcm.edu.cn/（organizer_notice 的网站首页）：标题里没有比赛名，不算官网，跳过',
      '来源表里的官方来源 https://w25.mcm.edu.cn/（organizer_website 的网站首页）：是官网（标题有比赛全名），用它当起点',
    ]);
  });

  test('判断交回的最终网址和原网址不同：起点还用原网址，跳转写进过程', async () => {
    const db = 库();
    const 件 = 部件({ 判: { 'https://www.mcm.edu.cn/': { 是: true, 原因: '标题有比赛全名', 最终网址: 'https://www.mcm.edu.cn/index.html' } }, 写: [写好([新通知])] });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.写脚本[0].起点网址).toBe('https://www.mcm.edu.cn/');
    expect(官网说明(回)).toEqual(['官网字段 https://www.mcm.edu.cn/：是官网（标题有比赛全名），用它当起点（打开后跳到 https://www.mcm.edu.cn/index.html）']);
  });

  test('一次运行传了 域名比赛数 就用传的；没传就按比赛库算一次，同一个库再维护不再算', async () => {
    const 传的 = new Map([['x.cn', 2]]);
    const db = 库({ 官网: null });
    加来源(db, 'n26', { url: 'https://www.mcm.edu.cn/n26.html', source_type: 'organizer_notice' });
    const 件 = 部件({ 写: [写好([新通知])] });
    await 维护一个('event-math', 选项(db, 件, { 域名比赛数: 传的 }));
    expect(件.调用.算域名比赛数).toHaveLength(0);
    expect(件.调用.来源候选[0].域名比赛数).toBe(传的);
    const db2 = 库({ 官网: null });
    加来源(db2, 'n26', { url: 'https://www.mcm.edu.cn/n26.html', source_type: 'organizer_notice' });
    const 件2 = 部件({ 判: { 'https://www.mcm.edu.cn/n26.html': { 是: false, 原因: '没有比赛名' } }, 找: 没找到 });
    await 维护一个('event-math', 选项(db2, 件2));
    await 维护一个('event-math', 选项(db2, 件2, { now: () => new Date(时刻.getTime() + 60000) }));
    expect(件2.调用.算域名比赛数).toEqual([db2]);
    expect(件2.调用.来源候选).toHaveLength(2);
  });

  test('候选都不是官网 → 调找官网 → 找到：先判断官网首页，不是再判断找到的网址，通过的当起点，照常写脚本入库', async () => {
    const db = 库({ 官网: 学校主站 });
    const 件 = 部件({ 判: { [学校主站]: { 是: false, 原因: '学校主站' }, 'https://www.mcm.edu.cn/': { 是: false, 原因: '学校主站' } }, 找: 找到, 写: [写好([新通知])] });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.找官网).toHaveLength(1);
    expect(件.调用.判断官网.map(x => x.网址)).toEqual([学校主站, 'https://www.mcm.edu.cn/', 'https://www.mcm.edu.cn/a.html']);
    expect(件.调用.写脚本[0].起点网址).toBe('https://www.mcm.edu.cn/a.html');
    expect(回).toMatchObject({ 结果: '入库', 成功: true });
    expect(官网说明(回)).toEqual([
      `官网字段 ${学校主站}：学校主站，不算官网，跳过`,
      'DeepSeek 找到的官网首页 https://www.mcm.edu.cn/：学校主站，不算官网，跳过',
      'DeepSeek 找到的网址 https://www.mcm.edu.cn/a.html：是官网（标题有比赛全名），用它当起点',
    ]);
    expect(搜索记忆.读(db, 'event-math').节.官方域名).toEqual(['www.mcm.edu.cn']);   // 原样主机名，找官网记的 mcm.edu.cn（DeepSeek 搜索）被同一域名替换
  });

  test('找官网找到的首页通过：直接用首页，不再判断网址', async () => {
    const db = 库({ 官网: null });
    const 件 = 部件({ 找: 找到, 写: [写好([新通知])] });
    await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.判断官网.map(x => x.网址)).toEqual(['https://www.mcm.edu.cn/']);
    expect(件.调用.写脚本[0].起点网址).toBe('https://www.mcm.edu.cn/');
  });

  test('找官网找到但不算官网（附件下载链接、首页是学校主站），有官方来源：失败“没找到官网”，不写脚本、不入库、不转待审，原因写清每个候选；不把它记成官方域名', async () => {
    const db = 库({ 官网: 学校主站 });
    加来源(db, 'n26', { url: 'https://www.mcm.edu.cn/n26.html', source_type: 'organizer_notice' });
    const 附件 = { 结果: '找到', 官网: { 域名: 'jwc.bift.edu.cn', 首页: 'https://jwc.bift.edu.cn/', 网址: 'https://jwc.bift.edu.cn/fj/2026.docx' }, 记忆改动: { 官方域名: ['jwc.bift.edu.cn（DeepSeek 搜索）'] } };
    const 件 = 部件({ 判: {
      [学校主站]: { 是: false, 原因: '学校主站' },
      'https://www.mcm.edu.cn/n26.html': { 是: false, 原因: '标题里没有比赛名' },
      'https://jwc.bift.edu.cn/': { 是: false, 原因: '学校主站' },
      'https://jwc.bift.edu.cn/fj/2026.docx': { 是: false, 原因: '附件下载链接' },
    }, 找: 附件 });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.写脚本).toHaveLength(0);
    expect(件.调用.执行脚本).toHaveLength(0);
    expect(件.调用.入库).toHaveLength(0);
    expect(回).toMatchObject({ 结果: '没找到官网（有官方来源，没转待人工审核）', 成功: false, 摘要: '没找到官网' });
    expect(回.原因).toBe('DeepSeek 找到的不算官网：首页 https://jwc.bift.edu.cn/ 学校主站；网址 https://jwc.bift.edu.cn/fj/2026.docx 附件下载链接；'
      + `起点候选都不算官网：官网字段 ${学校主站} 学校主站；来源表里的官方来源 https://www.mcm.edu.cn/n26.html 标题里没有比赛名`);
    expect(db.get('edition', 'ed-math-2026').data.status).toBe('已发布');
    expect(db.find('audit_log', { action: '新维护转待人工审核' })).toHaveLength(0);
    const 节 = 搜索记忆.读(db, 'event-math').节;
    expect((节.官方域名 || []).join()).not.toContain('jwc.bift.edu.cn');
    expect(节.教训.join()).toContain('2026-11-08 找官网找到 https://jwc.bift.edu.cn/fj/2026.docx，判断不算官网');
    expect(后台记录(db)).toMatchObject({ 成功: false, 摘要: '没找到官网', 原因: 回.原因 });
  });

  test('找官网找到但不算官网，一点官方来源都没有（website 也不算）：最新一届转待人工审核', async () => {
    const db = 库({ 官网: 学校主站 });
    const 件 = 部件({ 判: { [学校主站]: { 是: false, 原因: '学校主站' }, 'https://www.mcm.edu.cn/': { 是: false, 原因: '附件下载链接' }, 'https://www.mcm.edu.cn/a.html': { 是: false, 原因: '附件下载链接' } }, 找: 找到 });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(回).toMatchObject({ 结果: '没找到官网，转待人工审核', 成功: false, 摘要: '没找到官网' });
    expect(件.调用.写脚本).toHaveLength(0);
    expect(db.get('edition', 'ed-math-2026').data.status).toBe('待人工审核');
    expect(db.get('edition', 'ed-math-2026').data.status_reason.at(-1)).toContain('DeepSeek 找到的不算官网');
  });

  test('找官网没找到，有官方来源（都不算官网）：失败“没找到官网”，不转待审；原因写 DeepSeek 为什么没找到和每个候选', async () => {
    const db = 库({ 官网: null });
    加来源(db, 'n26', { url: 'https://www.mcm.edu.cn/n26.html', source_type: 'organizer_notice' });
    const 件 = 部件({ 判: { 'https://www.mcm.edu.cn/n26.html': { 是: false, 原因: '标题里没有比赛名' } }, 找: 没找到 });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(回).toMatchObject({ 结果: '没找到官网（有官方来源，没转待人工审核）', 成功: false, 摘要: '没找到官网',
      原因: 'DeepSeek 认为前 10 条里没有官网；起点候选都不算官网：来源表里的官方来源 https://www.mcm.edu.cn/n26.html 标题里没有比赛名' });
    expect(件.调用.写脚本).toHaveLength(0);
    expect(db.get('edition', 'ed-math-2026').data.status).toBe('已发布');
    expect(db.find('audit_log', { action: '新维护转待人工审核' })).toHaveLength(0);
  });

  test('官方来源一条推不出候选（来源候选全跳过）也算有官方来源：不转待审', async () => {
    const db = 库({ 官网: null });
    加来源(db, 'n26', { url: 'https://cxcy.saikr.com/n26.html', source_type: 'organizer_notice' });
    const 件 = 部件({ 候选: () => ({ 候选: [], 跳过: ['https://cxcy.saikr.com/n26.html：屏蔽网站'] }), 找: 没找到 });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(回).toMatchObject({ 成功: false, 摘要: '没找到官网', 结果: '没找到官网（有官方来源，没转待人工审核）' });
    expect(db.get('edition', 'ed-math-2026').data.status).toBe('已发布');
  });

  test('找官网没找到、website 不算、一点官方来源都没有：转待人工审核', async () => {
    const db = 库({ 官网: 学校主站 });
    const 件 = 部件({ 判: { [学校主站]: { 是: false, 原因: '学校主站' } }, 找: 没找到 });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(回).toMatchObject({ 结果: '没找到官网，转待人工审核', 成功: false, 摘要: '没找到官网', 原因: `DeepSeek 认为前 10 条里没有官网；起点候选都不算官网：官网字段 ${学校主站} 学校主站` });
    expect(db.get('edition', 'ed-math-2026').data.status).toBe('待人工审核');
  });

  test('只有权威名单：来源候选推不出候选 → 找官网；找到但不算官网 → 用名单核对（有比赛名 → 成功“只有权威名单”），不入库不转待审', async () => {
    const 名单 = 'https://jyt.gd.gov.cn/2026竞赛名单.pdf';
    const db = 库({ 官网: null });
    加来源(db, 's-list', { url: 名单, source_type: 'authority_notice' });
    const 读 = 假读网页({ [名单]: 页('2026年省级竞赛名单', '序号 竞赛名称 1 全国大学生数学建模竞赛') });
    const 件 = 部件({ 判: { 'https://www.mcm.edu.cn/': { 是: false, 原因: '学校主站' }, 'https://www.mcm.edu.cn/a.html': { 是: false, 原因: '附件下载链接' } }, 找: 找到 });
    const 回 = await 维护一个('event-math', 选项(db, 件, { 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: 读.读网页 } }));
    expect(件.调用.来源候选[0].来源们).toEqual([{ url: 名单, source_type: 'authority_notice', ordinal: 2 }]);
    expect(件.调用.找官网).toHaveLength(1);
    expect(回).toMatchObject({ 结果: '只有权威名单', 成功: true, 摘要: '只有权威名单' });
    expect(回.原因).toBe(`没找到官网（DeepSeek 找到的不算官网：首页 https://www.mcm.edu.cn/ 学校主站；网址 https://www.mcm.edu.cn/a.html 附件下载链接）；用权威名单核对：名单里有这个比赛（${名单}）`);
    expect(件.调用.写脚本).toHaveLength(0);
    expect(件.调用.入库).toHaveLength(0);
    expect(db.find('audit_log', { action: '新维护转待人工审核' })).toHaveLength(0);
  });

  test('找官网是网络问题（官网打不开）：照旧“官网打不开”，不转待审', async () => {
    const db = 库({ 官网: 学校主站 });
    const 件 = 部件({ 判: { [学校主站]: { 是: false, 原因: '学校主站' } }, 找: { 结果: '网络问题', 官网: null, 原因: '官网打不开：超时', 记忆改动: {} } });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(回).toMatchObject({ 成功: false, 摘要: '官网打不开', 原因: '官网打不开：超时' });
    expect(db.get('edition', 'ed-math-2026').data.status).toBe('已发布');
  });

  test('默认用真的判断官网、来源候选、算域名比赛数（判断官网.mjs）：学校主站标题没有比赛名跳过，来源推出的网站首页有比赛名 → 当起点', async () => {
    const db = 库({ 官网: 学校主站 });
    加来源(db, 'n26', { url: 'https://cumcm.cnki.net/tz/2026.html', source_type: 'organizer_notice' });
    const 读 = 假读网页({
      [学校主站]: { ...页('北京服装学院', `${'学校新闻。'.repeat(60)}我校获全国大学生数学建模竞赛一等奖`), finalUrl: 学校主站 },
      'https://cumcm.cnki.net/': { ...页('全国大学生数学建模竞赛', '通知公告'), finalUrl: 'https://cumcm.cnki.net/' },
    });
    const { 判断官网, 来源候选, 算域名比赛数, ...其余 } = 部件({ 写: [写好([新通知])] });
    const 回 = await 维护一个('event-math', 选项(db, 其余, { 工具: { 取源码: async () => ({}), 浏览器: null, 读网页: 读.读网页 } }));
    expect(读.读过).toEqual([学校主站, 'https://cumcm.cnki.net/']);
    expect(其余.调用.找官网).toHaveLength(0);
    expect(其余.调用.写脚本[0].起点网址).toBe('https://cumcm.cnki.net/');
    expect(官网说明(回)[0]).toBe(`官网字段 ${学校主站}：二级 edu.cn 网站（可能是学校主站），标题里没有比赛名（标题：北京服装学院），不算官网，跳过`);
    expect(回).toMatchObject({ 成功: true });
  });

  test('判断官网抛错：算这个候选不是，原因写出错，接着试下一个', async () => {
    const db = 库();
    const 件 = 部件({ 找: 找到, 写: [写好([新通知])] });
    const 真判断 = 件.判断官网;
    件.判断官网 = async (网址, 比赛, 参数) => { if (网址 === 'https://www.mcm.edu.cn/' && !件.调用.判断官网.length) { 件.调用.判断官网.push({ 网址 }); throw new Error('浏览器炸了'); } return 真判断(网址, 比赛, 参数); };
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(官网说明(回)[0]).toBe('官网字段 https://www.mcm.edu.cn/：判断出错（浏览器炸了），不算官网，跳过');
    expect(件.调用.找官网).toHaveLength(1);
    expect(回).toMatchObject({ 成功: true });
  });
});

// 2026-11-08 用户定：来源表里只有权威名单（如省教育厅公布的竞赛名单）的，还是先找官网；找不到就用权威名单核对，不转待人工审核
describe('只有权威名单', () => {
  const 名单 = 'https://jyt.gd.gov.cn/2026竞赛名单.pdf';
  const 加名单 = db => db.transaction(tx => tx.insert('source', 's-list', { edition_id: 'ed-math-2026', url: 名单, source_type: 'authority_notice', is_official: true, validity_status: 'valid' }));
  const 工具们 = 读网页 => ({ 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页 } });
  const 没找到 = { 结果: '待审', 官网: null, 原因: 'DeepSeek 认为前 10 条里没有官网', 记忆改动: {} };

  test('先找官网；找到 → 照常用官网往下走（不读名单）', async () => {
    const db = 库({ 官网: null }); 加名单(db);
    const 读 = 假读网页();
    const 件 = 部件({ 找: { 结果: '找到', 官网: { 域名: 'mcm.edu.cn', 首页: 'https://www.mcm.edu.cn/', 网址: 'https://www.mcm.edu.cn/a.html' }, 记忆改动: {} }, 写: [写好([新通知])] });
    const 回 = await 维护一个('event-math', 选项(db, 件, 工具们(读.读网页)));
    expect(件.调用.找官网).toHaveLength(1);
    expect(读.读过).toEqual([]);
    expect(件.调用.写脚本[0].起点网址).toBe('https://www.mcm.edu.cn/');
    expect(回).toMatchObject({ 结果: '入库', 成功: true });
  });

  test('找不到官网、名单里有比赛名：成功“只有权威名单”；不写脚本、不比指纹、不入库、不转待审；写维护时间、后台记录、维护记录', async () => {
    const db = 库({ 官网: null }); 加名单(db);
    const 读 = 假读网页({ [名单]: 页('2026年省级竞赛名单', '序号 竞赛名称 1 全国大学生数学建模竞赛') });
    const 件 = 部件({ 找: 没找到 });
    const 回 = await 维护一个('event-math', 选项(db, 件, 工具们(读.读网页)));
    const 原因 = `没找到官网（DeepSeek 认为前 10 条里没有官网）；用权威名单核对：名单里有这个比赛（${名单}）`;
    expect(回).toMatchObject({ 结果: '只有权威名单', 成功: true, 摘要: '只有权威名单', 原因 });
    expect(读.读过).toEqual([名单]);
    expect(件.调用.写脚本).toHaveLength(0);
    expect(件.调用.入库).toHaveLength(0);
    expect(指纹.读(db, 'event-math')).toBeNull();
    expect(db.get('edition', 'ed-math-2026').data.status).toBe('已发布');
    expect(db.find('audit_log', { action: '新维护转待人工审核' })).toHaveLength(0);
    expect(db.get('competition', 'event-math').data.last_maintained_at).toBe(时刻.toISOString());
    expect(后台记录(db)).toMatchObject({ 结果: '只有权威名单', 成功: true, 摘要: '只有权威名单', 原因 });
    expect(件.调用.维护记录).toEqual([`2026-11-08 成功：只有权威名单（${原因.slice(0, 120)}）`]);
  });

  test('找不到官网、名单里没有比赛名或打不开：失败“没找到官网”，原因写清楚，不转待审', async () => {
    const db = 库({ 官网: null }); 加名单(db);
    const 读 = 假读网页({ [名单]: 页('2026年省级竞赛名单', '序号 竞赛名称 1 挑战杯') });
    const 回 = await 维护一个('event-math', 选项(db, 部件({ 找: 没找到 }), 工具们(读.读网页)));
    expect(回).toMatchObject({ 成功: false, 摘要: '没找到官网', 原因: `没找到官网（DeepSeek 认为前 10 条里没有官网）；用权威名单核对：${名单} 里没有这个比赛` });
    expect(db.get('edition', 'ed-math-2026').data.status).toBe('已发布');
    const db2 = 库({ 官网: null }); 加名单(db2);
    const 回2 = await 维护一个('event-math', 选项(db2, 部件({ 找: 没找到 }), 工具们(假读网页().读网页)));
    expect(回2).toMatchObject({ 成功: false, 摘要: '没找到官网', 原因: `没找到官网（DeepSeek 认为前 10 条里没有官网）；用权威名单核对：${名单} 打不开（连接被拒绝）` });
    expect(db2.get('edition', 'ed-math-2026').data.status).toBe('已发布');
    expect(db2.find('audit_log', { action: '新维护转待人工审核' })).toHaveLength(0);
  });

  test('找官网是网络问题（官网打不开）：照旧“官网打不开”，不读名单', async () => {
    const db = 库({ 官网: null }); 加名单(db);
    const 读 = 假读网页();
    const 回 = await 维护一个('event-math', 选项(db, 部件({ 找: { 结果: '网络问题', 官网: null, 原因: '官网打不开：超时', 记忆改动: {} } }), 工具们(读.读网页)));
    expect(回).toMatchObject({ 成功: false, 摘要: '官网打不开' });
    expect(读.读过).toEqual([]);
  });
});

// 2026-11-08 用户定：每次维护（成功失败都）在搜索记忆“维护记录”写一行
describe('搜索记忆的维护记录', () => {
  test('指纹没变、网站说没更新：写“成功：没有变化（…，跳过）”', async () => {
    const 件 = 部件({ 跑: [跑([...旧条目])] });
    await 维护一个('event-math', 选项(有脚本的库(), 件));
    expect(件.调用.维护记录).toEqual(['2026-11-08 成功：没有变化（指纹和上次一样，跳过）']);
    const 件2 = 部件({ 跑: [{ 状态: '没更新', 条目们: [], 错误: '' }] });
    await 维护一个('event-math', 选项(有脚本的库(), 件2));
    expect(件2.调用.维护记录).toEqual(['2026-11-08 成功：没有变化（网站说没更新，跳过）']);
  });
  test('成功没有原因的不带括号；失败带原因，原因截到 120 字、去掉换行', async () => {
    const 件 = 部件({ 跑: [跑([新通知, ...旧条目])] });
    await 维护一个('event-math', 选项(有脚本的库(), 件));
    expect(件.调用.维护记录).toEqual(['2026-11-08 成功：入库 1 条']);
    const 长 = `第一行\n${'很'.repeat(200)}`;
    const 件2 = 部件({ 写: [{ 结果: '写不出', 脚本: null, 试跑: null, 轮们: [], 用量: {}, 原因: 长 }] });
    await 维护一个('event-math', 选项(库(), 件2));
    const 原因 = 长.replace(/\s+/g, ' ').slice(0, 120);
    expect(件2.调用.维护记录).toEqual([`2026-11-08 失败：写不出爬虫脚本（${原因}）`]);
  });
  test('没找到官网、读全文都不是：也写一行', async () => {
    const 件 = 部件({ 找: { 结果: '待审', 官网: null, 原因: 'x', 记忆改动: {} } });
    await 维护一个('event-math', 选项(库({ 官网: null }), 件));
    expect(件.调用.维护记录).toEqual(['2026-11-08 失败：没找到官网（x）']);
    const 丁 = { 标题: '关于端午节放假的通知', 链接: 'https://www.mcm.edu.cn/d.html', 日期: '2026-06-01' };
    const 件2 = 部件({ 跑: [跑([丁, ...旧条目])] });
    await 维护一个('event-math', 选项(有脚本的库(), 件2, { 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: async () => 页('放假', '放假') } }));
    expect(件2.调用.维护记录).toEqual([`2026-11-08 失败：没发现这个比赛的通知（标题里没有比赛名；读了 1 条新通知全文，都不是这个比赛的：${丁.标题}）`]);
  });
  test('维护记录改动交回的改动写进搜索记忆；试跑不写', async () => {
    const 件 = { ...部件({ 跑: [跑([...旧条目])] }), 维护记录改动: (节, 一行) => ({ 教训: [一行] }) };   // 借教训一节看写没写
    const db = 有脚本的库();
    await 维护一个('event-math', 选项(db, 件));
    expect(搜索记忆.读(db, 'event-math').节.教训).toEqual(['2026-11-08 成功：没有变化（指纹和上次一样，跳过）']);
    const db2 = 有脚本的库();
    await 维护一个('event-math', 选项(db2, { ...部件({ 跑: [跑([...旧条目])] }), 维护记录改动: () => ({ 教训: ['x'] }) }, { 试跑: true }));
    expect(搜索记忆.读(db2, 'event-math')).toBeNull();
  });
  // 搜索记忆“维护记录”一节由另一个智能体在 db/操作/搜索记忆.mjs 里加；加好以前跳过
  test.skipIf(!搜索记忆.节名.includes('维护记录'))('默认的维护记录改动：写进搜索记忆“维护记录”，最新在前', async () => {
    const db = 有脚本的库();
    const { 维护记录改动, ...其余 } = 部件({ 跑: [跑([...旧条目])] });
    await 维护一个('event-math', 选项(db, 其余));
    expect(搜索记忆.读(db, 'event-math').节.维护记录).toEqual(['2026-11-08 成功：没有变化（指纹和上次一样，跳过）']);
  });
});

// 2026-11-08 代码审查找到的问题（逐条一个 describe）
describe('审查：入库失败、顺延不记指纹；额度类错误收尾后往外抛', () => {
  const 失败 = 原因 => x => ({ 网址: x.网址, 状态: '失败', 原因, 入库: null, 入库类型: null, 改动: [], 写进: false });
  test('入库条目是“失败”“顺延”：照常收尾，但不记指纹（下次还当变了再处理）', async () => {
    for (const 状态 of ['失败', '顺延']) {
      const db = 有脚本的库();
      const 件 = 部件({ 跑: [跑([新通知, ...旧条目])], 入库结果: x => ({ ...失败('读不到正文：超时')(x), 状态 }) });
      const 回 = await 维护一个('event-math', 选项(db, 件));
      expect(回.成功).toBe(false);
      expect(指纹.读(db, 'event-math').条目们).toEqual(旧条目);
      expect(db.get('competition', 'event-math').data.last_maintained_at).toBe(时刻.toISOString());
    }
  });
  test('一条失败一条成功：也不记指纹', async () => {
    const db = 有脚本的库();
    const 二 = 条('关于举办2026年全国大学生数学建模竞赛的补充通知', 'https://www.mcm.edu.cn/2026b.html');
    const 件 = 部件({ 跑: [跑([新通知, 二, ...旧条目])], 入库结果: x => x.网址 === 新通知.链接 ? 通过(x) : 失败('出错：网页炸了')(x) });
    expect(await 维护一个('event-math', 选项(db, 件))).toMatchObject({ 成功: true, 摘要: '入库 1 条' });
    expect(指纹.读(db, 'event-math').条目们).toEqual(旧条目);
  });
  test.each([
    ['04 抽取 DeepSeek 余额不足（失败）', '失败', '出错：deepseek 返回 402：Insufficient Balance'],
    ['04 抽取会话额度用完（失败）', '失败', '出错：会话 新维护-04-extract 的调用次数已用完（上限 5）'],
    ['05 审核 AI 再判额度用完（已丢弃）', '已丢弃', '05 审核·收录门槛：AI 再判出错：deepseek 今天的自动调用已用 30/30 次，剩下的留给手动测试'],
    ['05 三项核验 Codex 额度不足（已丢弃）', '已丢弃', '05 审核·三项核验：调用出错：Codex 订阅额度不足，稍后再试'],
  ])('条目原因里能看出 AI 额度用完/余额不足：%s → 收尾（后台记录、维护时间照写）后抛出额度类错误，不记指纹', async (_, 状态, 原因) => {
    const db = 有脚本的库();
    const 件 = 部件({ 跑: [跑([新通知, ...旧条目])], 入库结果: x => ({ ...失败(原因)(x), 状态 }) });
    const 错 = await 维护一个('event-math', 选项(db, 件)).then(() => null, e => e);
    expect(错?.kind).toBe('额度用完');
    expect(错.message).toContain(原因);
    expect(后台记录(db)).toMatchObject({ 成功: false, 入库: [{ 网址: 新通知.链接, 状态 }] });
    expect(db.get('competition', 'event-math').data.last_maintained_at).toBe(时刻.toISOString());
    expect(指纹.读(db, 'event-math').条目们).toEqual(旧条目);
  });
});

describe('审查：存了官方通知时，读全文和“没有新通知”走得到（真的挑通知）', () => {
  const 名 = '全国大学生数学建模竞赛';
  const 存的 = 'https://www.mcm.edu.cn/n26.html';
  const 存官方通知 = db => db.transaction(tx => tx.insert('source', 's-n26', { edition_id: 'ed-math-2026', url: 存的, source_type: 'organizer_notice', is_official: true, validity_status: 'valid' }));
  const 真挑 = 件 => { const { 挑通知, ...其余 } = 件; return 其余; };
  const 甲 = { 标题: '关于举办第十届大赛的通知', 链接: 'https://www.mcm.edu.cn/jia.html', 日期: '2026-10-01' };
  const 丁 = { 标题: '关于端午节放假的通知', 链接: 'https://www.mcm.edu.cn/d.html', 日期: '2026-06-01' };

  test('标题都没有比赛名：读全文；确认含比赛名的（认不出届次，当作最新一届）用存的官方通知核对，带届次交给入库', async () => {
    const db = 有脚本的库(); 存官方通知(db);
    const 读 = 假读网页({ [甲.链接]: 页('通知', `第十届${名}将于9月举行`) });
    const 件 = 真挑(部件({ 跑: [跑([甲, 丁, ...旧条目])], 入库结果: 对上() }));
    const 回 = await 维护一个('event-math', 选项(db, 件, { 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: 读.读网页 } }));
    expect(读.读过).toEqual([甲.链接, 丁.链接]);
    expect(件.调用.入库[0].网址们).toEqual([{ 网址: 存的, 标题: '（库里存的官方通知）', 比赛名: 名, 比赛编号: 'event-math', 届次: 'ed-math-2026' }]);
    expect(回).toMatchObject({ 成功: true, 摘要: '核对无误' });
  });
  test('标题都没有比赛名、读了全文都不是：失败“没发现这个比赛的通知”，不入库、不用存的核对', async () => {
    const db = 有脚本的库(); 存官方通知(db);
    const 读 = 假读网页({ [丁.链接]: 页('放假', '端午节放假安排') });
    const 件 = 真挑(部件({ 跑: [跑([丁, ...旧条目])] }));
    const 回 = await 维护一个('event-math', 选项(db, 件, { 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: 读.读网页 } }));
    expect(读.读过).toEqual([丁.链接]);
    expect(件.调用.入库).toHaveLength(0);
    expect(回).toMatchObject({ 成功: false, 摘要: '没发现这个比赛的通知' });
  });
  test('带比赛名的只有获奖公示：成功“没有新通知”，不用存的官方通知核对、不读全文', async () => {
    const db = 有脚本的库(); 存官方通知(db);
    const 公示 = { 标题: `2026年${名}获奖名单公示`, 链接: 'https://www.mcm.edu.cn/gs.html', 日期: '2026-10-30' };
    const 读 = 假读网页();
    const 件 = 真挑(部件({ 跑: [跑([公示, 丁, ...旧条目])] }));
    const 回 = await 维护一个('event-math', 选项(db, 件, { 工具: { 取源码: async () => ({}), 浏览器: {}, 读网页: 读.读网页 } }));
    expect(回).toMatchObject({ 结果: '没有新通知', 成功: true, 摘要: '没有新通知' });
    expect(读.读过).toEqual([]);
    expect(件.调用.入库).toHaveLength(0);
  });
  test('有指向最新一届的主通知：用存的官方通知核对（带届次）', async () => {
    const db = 有脚本的库(); 存官方通知(db);
    const 件 = 真挑(部件({ 跑: [跑([新通知, ...旧条目])], 入库结果: 对上() }));
    await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.入库[0].网址们).toEqual([{ 网址: 存的, 标题: '（库里存的官方通知）', 比赛名: 名, 比赛编号: 'event-math', 届次: 'ed-math-2026' }]);
  });
});

describe('审查：起点候选打不开（超时、5xx 等）不当成“不是官网”', () => {
  const 加来源 = (db, id, 改) => db.transaction(tx => tx.insert('source', id, { edition_id: 'ed-math-2026', is_official: true, validity_status: 'valid', ...改 }));
  test('没有候选是官网、有候选打不开：失败“官网打不开”（原因写哪个打不开），不调找官网、不转待人工审核、不写教训', async () => {
    const db = 库({ 官网: 'https://www.mcm.edu.cn/' });
    const 件 = 部件({ 判: { 'https://www.mcm.edu.cn/': { 是: false, 原因: '打不开（超时）' } }, 找: { 结果: '待审', 官网: null, 原因: 'x', 记忆改动: {} } });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.找官网).toHaveLength(0);
    expect(件.调用.写脚本).toHaveLength(0);
    expect(回).toMatchObject({ 成功: false, 摘要: '官网打不开', 原因: '起点候选打不开：官网字段 https://www.mcm.edu.cn/ 打不开（超时）' });
    expect(db.get('edition', 'ed-math-2026').data.status).toBe('已发布');
    expect(搜索记忆.读(db, 'event-math')?.节?.教训 ?? []).toEqual([]);
    expect(后台记录(db)).toMatchObject({ 成功: false, 摘要: '官网打不开' });
  });
  test('一个打不开、一个“不是”、没有“是”：也按官网打不开；一个打不开、后面有“是”：照常用“是”的', async () => {
    const db = 库({ 官网: 'https://www.bift.edu.cn/' });
    加来源(db, 'n26', { url: 'https://www.mcm.edu.cn/n26.html', source_type: 'organizer_notice' });
    const 件 = 部件({ 判: { 'https://www.bift.edu.cn/': { 是: false, 原因: '学校主站' }, 'https://www.mcm.edu.cn/n26.html': { 是: false, 原因: '打不开（HTTP错误 503）' } } });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.找官网).toHaveLength(0);
    expect(回).toMatchObject({ 成功: false, 摘要: '官网打不开', 原因: '起点候选打不开：来源表里的官方来源 https://www.mcm.edu.cn/n26.html 打不开（HTTP错误 503）' });
    const db2 = 库({ 官网: 'https://www.bift.edu.cn/' });
    加来源(db2, 'n26', { url: 'https://www.mcm.edu.cn/n26.html', source_type: 'organizer_notice' });
    const 件2 = 部件({ 判: { 'https://www.bift.edu.cn/': { 是: false, 原因: '打不开（超时）' } }, 写: [写好([新通知])] });
    expect(await 维护一个('event-math', 选项(db2, 件2))).toMatchObject({ 成功: true });
    expect(件2.调用.写脚本[0].起点网址).toBe('https://www.mcm.edu.cn/n26.html');
  });
});

describe('审查：整个维护一个兜底', () => {
  const 写脚本炸 = 错 => ({ ...部件(), 写脚本: async () => { throw 错; } });
  test('任何异常都按失败收尾：摘要“出错”，原因写错误；照常写后台记录、维护记录、维护时间；不往外抛', async () => {
    const db = 库();
    const 件 = 写脚本炸(new Error('浏览器炸了'));
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(回).toMatchObject({ 比赛: 'event-math', 结果: '出错', 成功: false, 摘要: '出错', 原因: '浏览器炸了' });
    expect(后台记录(db)).toMatchObject({ 结果: '出错', 成功: false, 摘要: '出错', 原因: '浏览器炸了' });
    expect(件.调用.维护记录).toEqual(['2026-11-08 失败：出错（浏览器炸了）']);
    expect(db.get('competition', 'event-math').data.last_maintained_at).toBe(时刻.toISOString());
  });
  test.each(['额度用完', '密钥错误', '搜索超限'])('AI 错误种类“%s”：收尾后原样往外抛', async 种类 => {
    const db = 库();
    const 错 = Object.assign(new Error(`AI ${种类}`), { kind: 种类 });
    const 抛 = await 维护一个('event-math', 选项(db, 写脚本炸(错))).then(() => null, e => e);
    expect(抛).toBe(错);
    expect(后台记录(db)).toMatchObject({ 摘要: '出错', 原因: `AI ${种类}` });
  });
  test('入库工具抛的普通错误里能看出余额不足（模块出错被包了一层，丢了种类）：收尾后抛额度类错误', async () => {
    const db = 有脚本的库();
    const 件 = { ...部件({ 跑: [跑([新通知, ...旧条目])] }), 入库: async () => { throw new Error('04-extract 出错：deepseek 返回 402：Insufficient Balance'); } };
    const 抛 = await 维护一个('event-math', 选项(db, 件)).then(() => null, e => e);
    expect(抛?.kind).toBe('额度用完');
    expect(抛.message).toContain('Insufficient Balance');
    expect(后台记录(db)).toMatchObject({ 摘要: '出错' });
    expect(指纹.读(db, 'event-math').条目们).toEqual(旧条目);
  });
  test('其他种类的 AI 错误（如请求有误）：不往外抛', async () => {
    const 回 = await 维护一个('event-math', 选项(库(), 写脚本炸(Object.assign(new Error('400'), { kind: '请求有误' }))));
    expect(回).toMatchObject({ 摘要: '出错', 原因: '400' });
  });
});

describe('审查：旧脚本网络失败不马上重写', () => {
  const 打不开 = { 状态: '失败', 条目们: [], 错误: `打开 ${列表页}：超时 超过 20 秒没下载完` };
  test.each([
    ['取源码超时', 打不开, false],
    ['HTTP 错误', { 状态: '失败', 条目们: [], 错误: `打开 ${列表页}：HTTP错误 对方返回 503` }, false],
    ['robots 不允许', { 状态: '失败', 条目们: [], 错误: `打开 ${列表页}：robots不允许 网站的 robots.txt 不允许抓取` }, false],
    ['网络错误', { 状态: '失败', 条目们: [], 错误: `打开 ${列表页}：网络错误 fetch failed` }, false],
    ['浏览器打开失败', { 状态: '失败', 条目们: [], 错误: '第 1 步打开：net::ERR_CONNECTION_REFUSED' }, true],
    ['浏览器先开列表页失败', { 状态: '失败', 条目们: [], 错误: `打开 ${列表页}：Timeout 30000ms exceeded` }, true],
  ])('网络类（%s）：不重写，失败“官网打不开”，累计失败次数，不记指纹', async (_, 跑结果, 要浏览器) => {
    const db = 库();
    爬虫脚本.写(db, 'event-math', { ...脚本, 要浏览器 });
    指纹.记(db, 'event-math', { 列表页, 条目们: 旧条目, 时间: '2026-11-01T00:00:00.000Z' });
    const 件 = 部件({ 跑: [跑结果] });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.写脚本).toHaveLength(0);
    expect(回).toMatchObject({ 成功: false, 摘要: '官网打不开', 原因: 跑结果.错误 });
    expect(爬虫脚本.读(db, 'event-math')).toMatchObject({ 连续失败: 1, 上次错误: 跑结果.错误 });
    expect(指纹.读(db, 'event-math').条目们).toEqual(旧条目);
  });
  test('网络类失败累计到第 3 次：重写（带原因和旧脚本）', async () => {
    const db = 有脚本的库();
    爬虫脚本.记结果(db, 'event-math', { 成功: false, 错误: '超时' });
    爬虫脚本.记结果(db, 'event-math', { 成功: false, 错误: '超时' });
    const 件 = 部件({ 跑: [打不开], 写: [写好([新通知, ...旧条目], { 要浏览器: true })] });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.写脚本[0]).toMatchObject({ 要浏览器: true, 原因: `旧脚本连续 3 次打不开：${打不开.错误}`, 旧脚本: { 列表页 } });
    expect(回).toMatchObject({ 成功: true, 摘要: '入库 1 条' });
  });
  test('取不到条目、选择器出错、点击要浏览器：立刻重写（照旧）', async () => {
    for (const 错误 of ['取不到条目（ul li）', '第 2 步取列表：选择器出错 Unexpected', '第 2 步点击要浏览器']) {
      const db = 有脚本的库();
      const 件 = 部件({ 跑: [{ 状态: '失败', 条目们: [], 错误 }], 写: [写好([新通知, ...旧条目])] });
      await 维护一个('event-math', 选项(db, 件));
      expect(件.调用.写脚本).toHaveLength(1);
    }
  });
});

describe('审查：按“写进”数入库条数；写入出错算失败', () => {
  test('新一届没真的写进主库：不算入库 → 被审核挡掉', async () => {
    const db = 有脚本的库();
    const 回 = await 维护一个('event-math', 选项(db, 部件({ 跑: [跑([新通知, ...旧条目])], 入库结果: x => ({ ...通过(x), 写进: false }) })));
    expect(回).toMatchObject({ 成功: false, 摘要: '被审核挡掉' });
  });
  test('补来源没写进：不算核对无误；已处理过不用写进也算', async () => {
    const db = 有脚本的库();
    expect(await 维护一个('event-math', 选项(db, 部件({ 跑: [跑([新通知, ...旧条目])], 入库结果: x => ({ ...对上()(x), 写进: false }) })))).toMatchObject({ 成功: false, 摘要: '被审核挡掉' });
    const db2 = 有脚本的库();
    const 处理过 = x => ({ 网址: x.网址, 状态: '已丢弃', 原因: '这条通知处理过了', 入库: { decision: '已处理过' }, 入库类型: '已处理过', 改动: [], 写进: false });
    expect(await 维护一个('event-math', 选项(db2, 部件({ 跑: [跑([新通知, ...旧条目])], 入库结果: 处理过 })))).toMatchObject({ 成功: true, 摘要: '核对无误' });
  });
  test('写入.error 有值：失败，摘要“出错”，原因写错误，不记指纹', async () => {
    const db = 有脚本的库();
    const 回 = await 维护一个('event-math', 选项(db, 部件({ 跑: [跑([新通知, ...旧条目])], 写入: { written: 0, error: '数据库被锁住' } })));
    expect(回).toMatchObject({ 成功: false, 摘要: '出错', 原因: '写进主库出错：数据库被锁住' });
    expect(后台记录(db)).toMatchObject({ 成功: false, 摘要: '出错' });
    expect(指纹.读(db, 'event-math').条目们).toEqual(旧条目);
  });
});

describe('审查：记忆里的官方域名记原样主机名', () => {
  test('记忆里是 www 主机名：起点用 https://www.…/，维护后不重复、不去掉 www', async () => {
    const db = 库({ 官网: null });
    搜索记忆.改节(db, 'event-math', { 官方域名: ['www.mcm.edu.cn（DeepSeek 搜索，2026-11-01 核实）'] });
    const 件 = 部件({ 写: [写好([新通知])] });
    await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.写脚本[0].起点网址).toBe('https://www.mcm.edu.cn/');
    expect(搜索记忆.读(db, 'event-math').节.官方域名).toEqual(['www.mcm.edu.cn（DeepSeek 搜索，2026-11-01 核实）']);
  });
  test('起点换了带 www 的主机名：放最前，旧的同域名（去不去 www）去掉，别的域名留着', async () => {
    const db = 库();
    搜索记忆.改节(db, 'event-math', { 官方域名: ['mcm.edu.cn（DeepSeek 搜索，2026-11-01 核实）', 'old.cn'] });
    await 维护一个('event-math', 选项(db, 部件({ 写: [写好([新通知])] })));
    expect(搜索记忆.读(db, 'event-math').节.官方域名).toEqual(['www.mcm.edu.cn', 'old.cn']);
  });
});

describe('审查：维护时比赛被删', () => {
  test('收尾时读不到比赛：不写维护时间，只写后台记录，不出错', async () => {
    const db = 有脚本的库();
    const 件 = 部件({ 跑: [跑([新通知, ...旧条目])], 入库结果: x => { db.标记删除('competition', 'event-math'); return 通过(x); } });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(回).toMatchObject({ 成功: true, 摘要: '入库 1 条' });
    expect(后台记录(db)).toMatchObject({ 成功: true, 摘要: '入库 1 条' });
    expect(db.get('competition', 'event-math', { 包括已删除: true }).data.last_maintained_at ?? null).toBeNull();
  });
});

// ===================== 2026-11-13 用户定的几处改动 =====================
describe('找官网搜索接口出错（2026-11-13）', () => {
  test('找官网交回“搜索出错”（DeepSeek 搜索接口出错、Tavily 也没找到）：失败“出错”，下次再试；不转待人工审核、不记教训、不找第三方通知', async () => {
    const db = 库({ 官网: null });
    const 件 = 部件({ 找: { 结果: '搜索出错', 官网: null, 原因: 'DeepSeek 搜索接口出错：deepseek 返回 503；Tavily 搜索：后备搜索失败（tavily 暂停中），当没结果', 记忆改动: {} } });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(回).toMatchObject({ 成功: false, 摘要: '出错', 结果: '没找到官网（搜索接口出错，下次再试）', 原因: expect.stringContaining('DeepSeek 搜索接口出错') });
    expect(db.get('edition', 'ed-math-2026').data.status).toBe('已发布');
    expect(搜索记忆.读(db, 'event-math')?.节?.教训 ?? []).toEqual([]);
    expect(件.调用.写脚本).toHaveLength(0);
    expect(件.调用.第三方通知).toHaveLength(0);
  });
});

describe('官网打不开：先无头浏览器，还不行用第三方通知（2026-11-13）', () => {
  const 本届转发 = { 网址: 'https://jwc.abc.edu.cn/info/1/2.htm', 标题: '关于组织参加2026年全国大学生数学建模竞赛的通知', 比赛名: '全国大学生数学建模竞赛', 比赛编号: 'event-math', 届次: 'ed-math-2026', 来源类型: 'school_repost', 核对说明: '官网打不开，用高校转发' };
  const 新届转发 = { 网址: 'https://jwc.def.edu.cn/info/3.htm', 标题: '关于组织参加2027年全国大学生数学建模竞赛的通知', 比赛名: '全国大学生数学建模竞赛', 比赛编号: 'event-math', 新届: { 年份: '2027', 届次: null }, 来源类型: 'school_repost', 核对说明: 'x' };
  const 起点打不开 = () => ({ 判: { 'https://www.mcm.edu.cn/': { 是: false, 原因: '打不开：超时；无头浏览器也打不开：Timeout' } } });
  test('找官网用的读网页带浏览器：直接读打不开时换无头浏览器再开一次', async () => {
    const db = 库({ 官网: null });
    const 件 = 部件({ 找: { 结果: '待审', 官网: null, 原因: 'x', 记忆改动: {} } });
    const 浏览器 = { async 新页面() { return { 页: { async 打开() { return { httpStatus: 200 }; }, async 源码() { return '<title>全国大学生数学建模竞赛</title>'; }, 网址: () => 'https://a.cn/' }, async 关() {} }; } };
    const 读网页 = async 网址 => ({ url: 网址, status: '超时', title: '', text: '', error: '20 秒没响应' });
    await 维护一个('event-math', 选项(db, 件, { 工具: { 取源码: async () => ({}), 浏览器, 读网页 } }));
    expect(await 件.调用.找官网[0].读网页('https://a.cn/')).toMatchObject({ status: '成功', title: '全国大学生数学建模竞赛', 用了浏览器: true });
  });
  test('起点候选打不开（浏览器也打不开）：找第三方通知；这一届的高校转发交给入库（比赛编号、高校转发、更新已有、不审核），改了字段 → 成功；不写脚本、不记指纹', async () => {
    const db = 库();
    const 件 = 部件({ ...起点打不开(), 转发: { 条目们: [本届转发], 过程: [{ 步骤: '高校转发', 说明: '交给入库 1 条' }] },
      入库结果: 对上([{ 届次: 'ed-math-2026', 字段: 'registration_start', 改前: null, 改后: '2026-04-01' }]) });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.找官网).toHaveLength(0);
    expect(件.调用.第三方通知[0]).toMatchObject({ 编号: 'event-math', db, 屏蔽: [], 今天: '2026-11-08' });
    expect(件.调用.入库[0]).toMatchObject({ 网址们: [本届转发], 更新已有: true, 不审核: true, 试跑: false });
    expect(件.调用.写脚本).toHaveLength(0);
    expect(指纹.读(db, 'event-math')).toBeNull();
    expect(回).toMatchObject({ 成功: true, 摘要: '改了 1 处', 结果: '官网打不开，用高校转发通知入库' });
    expect(回.原因).toContain('起点候选打不开');
    expect(回.过程).toContainEqual({ 步骤: '高校转发', 说明: '交给入库 1 条' });
    expect(后台记录(db)).toMatchObject({ 成功: true, 摘要: '改了 1 处' });
  });
  test('新一届的高校转发：新建发布 → 成功“入库 N 条”', async () => {
    const db = 库();
    const 件 = 部件({ ...起点打不开(), 转发: { 条目们: [新届转发], 过程: [] } });
    expect(await 维护一个('event-math', 选项(db, 件))).toMatchObject({ 成功: true, 摘要: '入库 1 条' });
  });
  test('高校转发入库只补了来源、没改字段，或被挡掉：失败“官网打不开”，原因带高校转发入库的情况', async () => {
    const 回 = await 维护一个('event-math', 选项(库(), 部件({ ...起点打不开(), 转发: { 条目们: [本届转发], 过程: [] }, 入库结果: 对上() })));
    expect(回).toMatchObject({ 成功: false, 摘要: '官网打不开' });
    expect(回.原因).toContain('高校转发');
    const 挡 = await 维护一个('event-math', 选项(库(), 部件({ ...起点打不开(), 转发: { 条目们: [本届转发], 过程: [] }, 入库结果: 挡掉 })));
    expect(挡).toMatchObject({ 成功: false, 摘要: '官网打不开' });
  });
  test('第三方通知什么都没找到：照旧失败“官网打不开”，原因不变；找第三方通知出错也一样（额度类错误收尾后往外抛）', async () => {
    const 回 = await 维护一个('event-math', 选项(库(), 部件(起点打不开())));
    expect(回).toMatchObject({ 成功: false, 摘要: '官网打不开', 原因: '起点候选打不开：官网字段 https://www.mcm.edu.cn/ 打不开：超时；无头浏览器也打不开：Timeout' });
    const 出错 = await 维护一个('event-math', 选项(库(), 部件({ ...起点打不开(), 转发: new Error('搜索崩了') })));
    expect(出错).toMatchObject({ 成功: false, 摘要: '官网打不开' });
    expect(出错.过程.map(x => x.说明).join('\n')).toContain('搜索崩了');
    const db = 库();
    await expect(维护一个('event-math', 选项(db, 部件({ ...起点打不开(), 转发: Object.assign(new Error('余额不足'), { kind: '额度用完' }) })))).rejects.toThrow('余额不足');
    expect(后台记录(db)).toMatchObject({ 成功: false, 摘要: '官网打不开' });
  });
  test('找官网找到的官网打不开（网络问题）：也找第三方通知', async () => {
    const db = 库({ 官网: null });
    const 件 = 部件({ 找: { 结果: '网络问题', 官网: null, 打不开: ['https://a.cn/'], 原因: '官网打不开：超时', 记忆改动: {} }, 转发: { 条目们: [新届转发], 过程: [] } });
    expect(await 维护一个('event-math', 选项(db, 件))).toMatchObject({ 成功: true, 摘要: '入库 1 条', 结果: '官网打不开，用高校转发通知入库' });
    expect(件.调用.第三方通知).toHaveLength(1);
  });
  test('试跑：入库按试跑；手动查新届不找第三方通知', async () => {
    const 件 = 部件({ ...起点打不开(), 转发: { 条目们: [新届转发], 过程: [] } });
    await 维护一个('event-math', 选项(库(), 件, { 试跑: true }));
    expect(件.调用.入库[0].试跑).toBe(true);
    const db = 库({ 官网: null });
    const 件2 = 部件({ 找: { 结果: '网络问题', 官网: null, 打不开: ['https://a.cn/'], 原因: '官网打不开：超时', 记忆改动: {} }, 转发: { 条目们: [新届转发], 过程: [] } });
    await 维护一个('event-math', 选项(db, 件2, { 仅查新届: true }));
    expect(件2.调用.第三方通知).toHaveLength(0);
  });
});

// 2026-11-13 用户定：没找到官网（DeepSeek 搜索、Tavily 补搜都没有官网，候选也都不算）时也用高校转发补救（同一套搜索和三条规矩）
describe('没找到官网：用高校转发补救（2026-11-13）', () => {
  const 学校主站 = 'https://www.bift.edu.cn/';
  const 没找到 = { 结果: '待审', 官网: null, 原因: 'DeepSeek 认为前 10 条里没有官网', 记忆改动: {} };
  const 新届转发 = { 网址: 'https://jwc.def.edu.cn/info/3.htm', 标题: '关于组织参加2027年全国大学生数学建模竞赛的通知', 比赛名: '全国大学生数学建模竞赛', 比赛编号: 'event-math', 新届: { 年份: '2027', 届次: null }, 来源类型: 'school_repost', 核对说明: 'x' };
  test('高校转发入库了：成功“入库 N 条”，结果“没找到官网，用高校转发通知入库”；不转待人工审核、不写脚本', async () => {
    const db = 库({ 官网: 学校主站 });
    const 件 = 部件({ 判: { [学校主站]: { 是: false, 原因: '学校主站' } }, 找: 没找到, 转发: { 条目们: [新届转发], 过程: [{ 步骤: '高校转发', 说明: '交给入库 1 条' }] } });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.第三方通知).toHaveLength(1);
    expect(件.调用.第三方通知[0]).toMatchObject({ 编号: 'event-math', db, 今天: '2026-11-08' });
    expect(件.调用.入库[0]).toMatchObject({ 网址们: [新届转发], 更新已有: true, 不审核: true });
    expect(回).toMatchObject({ 成功: true, 摘要: '入库 1 条', 结果: '没找到官网，用高校转发通知入库' });
    expect(回.原因).toContain('DeepSeek 认为前 10 条里没有官网');
    expect(件.调用.写脚本).toHaveLength(0);
    expect(db.get('edition', 'ed-math-2026').data.status).toBe('已发布');
    expect(db.find('audit_log', { action: '新维护转待人工审核' })).toHaveLength(0);
    expect(后台记录(db)).toMatchObject({ 成功: true, 摘要: '入库 1 条' });
  });
  test('高校转发什么都没找到：照旧——一点官方来源都没有就转待人工审核，原因不变', async () => {
    const db = 库({ 官网: 学校主站 });
    const 件 = 部件({ 判: { [学校主站]: { 是: false, 原因: '学校主站' } }, 找: 没找到 });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.第三方通知).toHaveLength(1);
    expect(回).toMatchObject({ 结果: '没找到官网，转待人工审核', 成功: false, 摘要: '没找到官网', 原因: `DeepSeek 认为前 10 条里没有官网；起点候选都不算官网：官网字段 ${学校主站} 学校主站` });
    expect(db.get('edition', 'ed-math-2026').data.status).toBe('待人工审核');
  });
  test('高校转发交了入库但一条都没写进（被挡掉）：照旧往下走（转待人工审核），原因带高校转发入库的情况', async () => {
    const db = 库({ 官网: 学校主站 });
    const 件 = 部件({ 判: { [学校主站]: { 是: false, 原因: '学校主站' } }, 找: 没找到, 转发: { 条目们: [新届转发], 过程: [] }, 入库结果: 挡掉 });
    const 回 = await 维护一个('event-math', 选项(db, 件));
    expect(回).toMatchObject({ 结果: '没找到官网，转待人工审核', 成功: false, 摘要: '没找到官网' });
    expect(回.原因).toContain('高校转发');
  });
  test('手动查新届不找高校转发', async () => {
    const db = 库({ 官网: 学校主站 });
    const 件 = 部件({ 判: { [学校主站]: { 是: false, 原因: '学校主站' } }, 找: 没找到, 转发: { 条目们: [新届转发], 过程: [] } });
    await 维护一个('event-math', 选项(db, 件, { 仅查新届: true }));
    expect(件.调用.第三方通知).toHaveLength(0);
  });
});

describe('找到的官网写回官网字段（2026-11-13）', () => {
  const 学校主站 = 'https://www.bift.edu.cn/';
  const 记住域名 = (db, 域名) => 搜索记忆.改节(db, 'event-math', { 官方域名: [`${域名}（DeepSeek 搜索，2026-11-01 核实）`] });
  const 改官网记录 = db => db.find('audit_log', { action: '新维护改官网' });
  test('官网字段被判断不是官网（非网络原因）：起点写进 website，后台记录写改前改后和依据', async () => {
    const db = 库({ 官网: 学校主站 });
    记住域名(db, 'mcm.edu.cn');
    const 件 = 部件({ 判: { [学校主站]: { 是: false, 原因: '学校主站' } }, 写: [写好([新通知])] });
    await 维护一个('event-math', 选项(db, 件));
    expect(db.get('competition', 'event-math').data.website).toBe('https://mcm.edu.cn/');
    expect(改官网记录(db)).toHaveLength(1);
    expect(改官网记录(db)[0].detail).toMatchObject({ 字段: 'website', 改前: 学校主站, 改后: 'https://mcm.edu.cn/',
      依据: expect.stringContaining('搜索记忆里的官方域名 https://mcm.edu.cn/：标题有比赛全名') });
    expect(改官网记录(db)[0].detail.依据).toContain('原官网字段不算官网：学校主站');
  });
  test('官网字段空着：找官网找到、判断通过的写进 website', async () => {
    const db = 库({ 官网: null });
    const 件 = 部件({ 找: { 结果: '找到', 官网: { 域名: 'mcm.edu.cn', 首页: 'https://www.mcm.edu.cn/', 网址: 'https://www.mcm.edu.cn/a.html' }, 记忆改动: {} }, 写: [写好([新通知])] });
    await 维护一个('event-math', 选项(db, 件));
    expect(db.get('competition', 'event-math').data.website).toBe('https://www.mcm.edu.cn/');
    expect(改官网记录(db)[0].detail).toMatchObject({ 改前: null, 改后: 'https://www.mcm.edu.cn/', 依据: expect.stringContaining('原官网字段空着') });
  });
  test('不写的：官网字段本身就是起点、官网字段只是打不开、人工改过官网字段、试跑', async () => {
    const 本身 = 库();
    await 维护一个('event-math', 选项(本身, 部件({ 写: [写好([新通知])] })));
    expect(改官网记录(本身)).toHaveLength(0);
    const 打不开 = 库({ 官网: 学校主站 });
    记住域名(打不开, 'mcm.edu.cn');
    await 维护一个('event-math', 选项(打不开, 部件({ 判: { [学校主站]: { 是: false, 原因: '打不开：超时' } }, 写: [写好([新通知])] })));
    expect(打不开.get('competition', 'event-math').data.website).toBe(学校主站);
    const 人工 = 库({ 官网: 学校主站 });
    记住域名(人工, 'mcm.edu.cn');
    人工.transaction(tx => { const r = tx.get('competition', 'event-math'); tx.update('competition', 'event-math', { manual_fields: ['website'] }, r.version); });
    const 回 = await 维护一个('event-math', 选项(人工, 部件({ 判: { [学校主站]: { 是: false, 原因: '学校主站' } }, 写: [写好([新通知])] })));
    expect(人工.get('competition', 'event-math').data.website).toBe(学校主站);
    expect(回.过程.map(x => x.说明).join('\n')).toContain('人工改过官网字段');
    const 试 = 库({ 官网: 学校主站 });
    记住域名(试, 'mcm.edu.cn');
    await 维护一个('event-math', 选项(试, 部件({ 判: { [学校主站]: { 是: false, 原因: '学校主站' } }, 写: [写好([新通知])] }), { 试跑: true }));
    expect(试.get('competition', 'event-math').data.website).toBe(学校主站);
  });
});

describe('来源表里不算官网的官方来源记进搜索记忆，以后不当起点候选（2026-11-13）', () => {
  const 加来源 = (db, id, 改) => db.transaction(tx => tx.insert('source', id, { edition_id: 'ed-math-2026', is_official: true, validity_status: 'valid', ...改 }));
  test('判断不算官网（非网络原因）的来源候选记进“不算官网的网址”（网址、原因、日期，最新在前）；打不开的不记；来源本身不动', async () => {
    const db = 库({ 官网: null });
    加来源(db, 'a', { url: 'https://a.org/n/1.html', source_type: 'organizer_notice' });
    加来源(db, 'b', { url: 'https://b.org/n/1.html', source_type: 'organizer_notice' });
    const 件 = 部件({ 判: { 'https://a.org/n/1.html': { 是: false, 原因: '页面上没有比赛名（标题：首页）' }, 'https://b.org/n/1.html': { 是: false, 原因: '打不开：超时' } }, 找: { 结果: '待审', 官网: null, 原因: 'x', 记忆改动: {} } });
    await 维护一个('event-math', 选项(db, 件));
    expect(搜索记忆.读(db, 'event-math').节.不算官网的网址).toEqual(['https://a.org/n/1.html（页面上没有比赛名（标题：首页），2026-11-08）']);
    expect(db.get('source', 'a').data).toMatchObject({ is_official: true, validity_status: 'valid' });
  });
  test('来源候选拿到记忆里的不算官网的网址', async () => {
    const db = 库({ 官网: null });
    加来源(db, 'a', { url: 'https://a.org/n/1.html', source_type: 'organizer_notice' });
    搜索记忆.改节(db, 'event-math', { 不算官网的网址: ['https://a.org/（学校主站，2026-11-01）'] });
    const 件 = 部件({ 找: { 结果: '待审', 官网: null, 原因: 'x', 记忆改动: {} } });
    await 维护一个('event-math', 选项(db, 件));
    expect(件.调用.来源候选[0].不算官网).toEqual(['https://a.org/（学校主站，2026-11-01）']);
  });
});

describe('写不出脚本（2026-11-13）', () => {
  const 写不出 = 原因 => ({ 结果: '写不出', 脚本: null, 试跑: null, 轮们: [], 用量: {}, 原因 });
  const 在 = 日期 => ({ now: () => new Date(`${日期}T02:00:00.000Z`) });
  test.each([
    ['起点超时', '起点打不开：超时 20 秒没响应'],
    ['起点 HTTP 503', '起点打不开：HTTP错误 对方返回 503'],
    ['起点连接错误', '起点打不开：网络错误 fetch failed（ECONNREFUSED）'],
    ['浏览器也打不开起点', '做不到：要登录；浏览器也打不开起点：net::ERR_CONNECTION_TIMED_OUT'],
    ['浏览器起不来', '起点打不开：浏览器打不开：browserType.launch: Executable does not exist'],
  ])('起点打不开这类网络问题（%s）：失败“官网打不开”，不记教训、不算写不出的次数', async (_, 原因) => {
    const db = 库();
    const 回 = await 维护一个('event-math', 选项(db, 部件({ 写: [写不出(原因)] })));
    expect(回).toMatchObject({ 成功: false, 摘要: '官网打不开', 原因 });
    const 节 = 搜索记忆.读(db, 'event-math')?.节;
    expect(节?.教训 ?? []).toEqual([]);
    expect(节?.写不出脚本 ?? []).toEqual([]);
  });
  test('起点 HTTP 404：不算网络问题，照旧“写不出爬虫脚本”', async () => {
    const 回 = await 维护一个('event-math', 选项(库(), 部件({ 写: [写不出('起点打不开：HTTP错误 对方返回 404')] })));
    expect(回).toMatchObject({ 摘要: '写不出爬虫脚本' });
  });
  test('非网络原因连续写不出：记次数；到 3 次后 30 天内不调 AI 写，直接失败，原因写“连续 N 次写不出，YYYY-MM-DD 再试”；过了日子再写，还写不出接着加', async () => {
    const db = 库();
    const 跑一次 = async (日期, 写 = [写不出('3 轮都没写出能用的脚本')]) => { const 件 = 部件({ 写 }); const 回 = await 维护一个('event-math', 选项(db, 件, 在(日期))); return { 件, 回 }; };
    await 跑一次('2026-11-08');
    expect(搜索记忆.读(db, 'event-math').节.写不出脚本).toEqual(['连续 1 次写不出']);
    await 跑一次('2026-11-09');
    expect(搜索记忆.读(db, 'event-math').节.写不出脚本).toEqual(['连续 2 次写不出']);
    const 三 = await 跑一次('2026-11-10');
    expect(三.回).toMatchObject({ 摘要: '写不出爬虫脚本' });
    expect(搜索记忆.读(db, 'event-math').节.写不出脚本).toEqual(['连续 3 次写不出，2026-12-10 再试']);
    const 跳 = await 跑一次('2026-12-09');
    expect(跳.件.调用.写脚本).toHaveLength(0);
    expect(跳.回).toMatchObject({ 成功: false, 摘要: '写不出爬虫脚本', 结果: '写不出脚本', 原因: '连续 3 次写不出，2026-12-10 再试' });
    const 再 = await 跑一次('2026-12-10');
    expect(再.件.调用.写脚本).toHaveLength(1);
    expect(搜索记忆.读(db, 'event-math').节.写不出脚本).toEqual(['连续 4 次写不出，2027-01-09 再试']);
  });
  test('写出脚本后清零；旧脚本跑不通要重写时也按 30 天跳过', async () => {
    const db = 库();
    搜索记忆.改节(db, 'event-math', { 写不出脚本: ['连续 2 次写不出'] });
    await 维护一个('event-math', 选项(db, 部件({ 写: [写好([新通知])] })));
    expect(搜索记忆.读(db, 'event-math').节.写不出脚本).toEqual([]);
    const db2 = 有脚本的库();
    搜索记忆.改节(db2, 'event-math', { 写不出脚本: ['连续 3 次写不出，2026-12-01 再试'] });
    const 件 = 部件({ 跑: [{ 状态: '失败', 条目们: [], 错误: '取不到条目' }] });
    expect(await 维护一个('event-math', 选项(db2, 件))).toMatchObject({ 摘要: '写不出爬虫脚本', 原因: '连续 3 次写不出，2026-12-01 再试' });
    expect(件.调用.写脚本).toHaveLength(0);
  });
  test('试跑：次数不写进比赛库', async () => {
    const db = 库();
    await 维护一个('event-math', 选项(db, 部件({ 写: [写不出('3 轮都没写出')] }), { 试跑: true }));
    expect(搜索记忆.读(db, 'event-math')).toBeNull();
  });
});
