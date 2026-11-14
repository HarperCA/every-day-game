// 找新一届（2026-11-12 用户定）：已归档的比赛，主动搜有没有新一届；发现了就入库发布，先让用户看到现在能报名的比赛。
// 追不到官方通知的用高校转发发布，来源标“高校转发”（school_repost，不算官方）；以后新维护找到官方通知时补上官方来源、按维护规则核对字段。
// 试验（线上 experiments/找新一届-20261112/，20 个发现 6 个新一届）暴露的问题在这里都由程序把关：
//   比赛名、届次程序核对（AI 只帮着筛）；招新、承办申报、校赛实施方案、获奖公示不拿来建；学校的内容不当全国的（见 06 的 整理字段/高校转发.mjs）；
//   学校页不标官方；选择题分批、token 上限调大；多届次标题认紧挨着比赛名的那个；第一次从上一届结束开始搜，不只 30 天。
//
// 流程：
//   1. 最新一届（ordinal 最大）不是已归档的不找（摘要“不用找”）。库里最新一届的届次、年份见 核对.mjs 的 最新届信息。
//   2. 搜：用途 new_edition_search（DeepSeek 搜索 API），搜“比赛名 下一年”和“比赛名 下一届”（认不出届次的只搜年份），搜索词末尾带 after:日期——
//      第一次从上一届结束（比赛结束 → 报名截止 → 比赛开始 → 报名开始，都没有就最新一届那年的 1 月 1 日，再没有就一年前）开始；
//      之后从上次找新一届（后台记录）的前 3 天开始（搜索引擎收录有延迟，多回看几天）。去掉屏蔽网站和备案、统计这类网站，同一网址只留一次，最多 20 条。
//   3. 程序先筛：标题是招新、承办、校赛/实施方案、获奖公示报道类的（国家级比赛再加赛区、省赛）排除；标题和摘要里都没有比赛名（名称写法任一）的排除；
//      标题认得出届次或年份、而且不比库里最新一届新的排除（旧届）。
//   4. DeepSeek 选择题（用途 new_edition_pick，每批最多 10 条，见 选择题.mjs）：没选上的不读。回答格式不对的那一批当没选。
//   5. 选上的按“官方网站上的在前、标题带年份的在前、日期新的在前”读页面（最多 6 条），程序再核对：
//      打得开；页面标题不是排除那类；标题或正文里有比赛名；届次、年份（搜索标题 → 页面标题 → 正文里紧挨着比赛名的）比库里最新一届新。
//      过了的按新届分组（届次相同，或一方没届次而年份相同，算同一届）：同一新届只交一条给入库，只建一次。
//      网站种类：官方（比赛 website、搜索记忆里核实过的官方域名、来源表官方有效来源的网站；学校部门网站不算）、高校转发（.edu.cn）、其他。
//   6. 不是官方网站上的：追官方原文（每个新届只追一次）——
//      a. 页面里的链接和正文里写出的网址，指向官方网站的：读，核对比赛名和同一新届；
//      b. 指向外部网站（不是学校、政府、备案统计这类，链接文字像通知、大赛、官网）的：最多读 3 个，核对过了再用 判断官网 判断它的首页，是官网才算；
//      c. 在已知官方域名下搜“site:域名 比赛名 届次 after:日期”，标题对得上的读最多 2 条核对。
//      追到了用官方通知；追不到的，高校转发（.edu.cn）的用转发发布，其他网站的不用。
//   2026-11-13 用户定（和高校转发补救同一套规矩，见 核对.mjs）：
//      a. 转发页要够新：发布日期（搜索结果的 date、网址里的日期、正文里的发布时间，取最早的）要晚于库里最新一届的结束
//         （比赛结束 → 报名截止 → 最新一届年份的年底），并且在最近 12 个月内；搜索结果认得出日期的第 3 步就筛，读到页面再按正文核一次；
//         认不出日期的要明确比库里新（读页面核对本来就要求届次或年份比库里新）。追官方原文读到的页面也一样核。
//      b. 只建比库里最新一届更新的一届，一次最多一届：同一次找到几个新届，只交最新的（届次/年份最大）。
//      c. 来源必须是通知详情页：网址像列表页、栏目页、首页的第 3 步就排除；读到的页面像列表（链接多、正文少）也不用。
//   7. 交给入库工具（pipeline/总控/入库指定网址.mjs），每个新届一条：带 比赛编号、新届 { 年份, 届次 }（程序认的）、核对说明，
//      高校转发的带 来源类型 'school_repost'；选项 更新已有 false（不改已有届次）、不审核 true（04 抽取 → 06 入库，不过发布门槛直接发布，原最新一届本来就已归档）。
//   8. 写一条后台记录（audit_log，action“找新一届”，detail { 结果, 成功, 摘要, 原因, 线索, 入库, 过程 }）；挑比赛.mjs 按它算上次找的时间。不改比赛表（不动比赛的版本号）。
//   兜底：任何异常都按失败收尾（摘要“出错”）；额度用完、余额不足、搜索超限、密钥错误收尾后往外抛（让运行入口停批，同 维护一个）。
//   试跑：照常搜、读、交入库（入库按试跑，不写主库），不写后台记录。
//
//   找新一届(比赛编号, { db, ai, 工具: { 读网页 }, 部件: { 入库, 判断官网 }, 屏蔽, now, 试跑 })
//     → { 比赛, 结果, 成功, 摘要, 原因, 线索: [{ 网址, 标题, 类, 届次, 年份, 官方? }], 入库: [{ 网址, 状态, 原因, 入库类型, 写进 }], 过程, 用量 }
//     摘要：入库 N 条 / 拟新增 N 届（试跑）/ 没发现新一届 / 不用找 → 成功；被挡掉（交了入库一条都没建）/ 出错 → 失败
import { 比赛 as 比赛表, 屏蔽网站 } from '../../index.mjs';
import { 入库指定网址 } from '../../../pipeline/总控/入库指定网址.mjs';
import { 名称写法, 规范名 } from '../找官网/核实.mjs';
import { 判断官网 } from '../判断官网.mjs';
import { 主机之, 根域, 学校站, 垃圾站, 官方主机们 } from './网站.mjs';
import { 停批错误 } from '../维护一个.mjs';
import { 认本赛届次, 是新届, 排除原因, 最新届信息, 届次文字, 有比赛名, 合并认, 同一新届, 发布日期, 上届结束, 太旧原因, 不是详情页原因, 取最新一届 } from './核对.mjs';
import { 选择题, 提问版本, 每批最多 } from './选择题.mjs';
import { 上次找新一届, 后台动作 } from './挑比赛.mjs';

export const 默认部件 = { 入库: 入库指定网址, 判断官网 };
const 来源名 = '找新一届';
const 回看天数 = 3;
const 最多候选 = 20;
const 最多读线索 = 6;
const 最多追外链 = 3;
const 最多读站内搜索 = 2;
const 天 = 24 * 60 * 60 * 1000;
const 读到内容 = new Set(['成功', '正文太短']);
const 高校转发 = 'school_repost';

const 北京日期 = t => new Date(t + 8 * 3600000).toISOString().slice(0, 10);
const 净 = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const 日期值 = 日期 => String(日期 || '').slice(0, 10);

// 正文里写出来的网址（http(s):// 开头的、www. 开头的）
function 文中网址(文字) {
  const 出 = new Set();
  for (const m of String(文字).matchAll(/https?:\/\/[^\s"'<>（）()，。；、]+/g)) 出.add(m[0].replace(/[.,;]+$/, ''));
  for (const m of String(文字).matchAll(/(?<![\w./])www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s，。；、）)]*)?/gi)) 出.add(`http://${m[0]}`);
  return [...出];
}

// 第一次找：从上一届结束开始；之后：从上次找的前 3 天开始
function 起始日期(最新届, 最新, 上次, 今天毫秒) {
  if (上次) return 北京日期(Date.parse(上次) - 回看天数 * 天);
  const 结束 = ['competition_end', 'registration_end', 'competition_start', 'registration_start'].map(字段 => 日期值(最新届[字段])).find(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (结束) return 结束;
  if (最新.年止 ?? 最新.年) return `${最新.年止 ?? 最新.年}-01-01`;
  return 北京日期(今天毫秒 - 365 * 天);
}

export async function 找新一届(比赛编号, { db, ai = null, 工具 = {}, 部件: 给的部件 = {}, 屏蔽 = [], now = () => new Date(), 试跑 = false } = {}) {
  const 部件 = { ...默认部件, ...给的部件 };
  const 行 = db.get('competition', 比赛编号);
  if (!行) throw new Error(`比赛库里没有 ${比赛编号}（或已删除）`);
  const 比赛 = { id: 比赛编号, ...行.data };
  const 时间 = now().toISOString();
  const 今天毫秒 = now().getTime();
  const 今天 = 北京日期(今天毫秒);
  const 过程 = [];
  const 记 = (步骤, 说明) => 过程.push({ 步骤, 说明 });
  const 用量 = { tokensIn: 0, tokensOut: 0 };
  const 会话 = ai?.session ? ai.session({ source: 来源名, module: `${来源名}-${比赛编号}` }) : ai;
  const 名们 = 名称写法(比赛);
  const 线索 = [];
  let 已收尾 = false;
  let 往外抛 = null;

  const 收尾 = (结果, 原因, { 成功, 摘要, 入库 = [] }) => {
    已收尾 = true;
    记('结果', `${成功 ? '成功' : '失败'}，${结果}${原因 ? `：${原因}` : ''}`);
    const 入库简 = 入库.map(x => ({ 网址: x.网址, 状态: x.状态, 原因: x.原因, 入库类型: x.入库类型 ?? null, 写进: x.写进 === true }));
    if (!试跑) {
      db.insert('audit_log', `${来源名}-${比赛编号}-${时间}`, { created_at: 时间, action: 后台动作, table_name: 'competition', record_id: 比赛编号,
        detail: { 结果, 成功, 摘要, 原因, 线索, 入库: 入库简, 过程 } });
    }
    return { 比赛: 比赛编号, 结果, 成功, 摘要, 原因, 线索, 入库: 入库简, 过程, 用量 };
  };

  const 读 = async 网址 => {
    try { return (await 工具.读网页(网址)) || { status: '出错', error: '读网页没有交回结果' }; } catch (error) { return { status: '网络错误', error: String(error?.message || error).slice(0, 200) }; }
  };

  const 做 = async () => {
    // 1 最新一届
    const 届们 = 比赛表.editionsOf(db, 比赛编号);
    const 最新届 = 届们.at(-1);
    if (!最新届) return 收尾('没有届次', '', { 成功: true, 摘要: '不用找' });
    if (最新届.status !== '已归档') return 收尾('最新一届没归档', `最新一届 ${最新届.id} 是${最新届.status}`, { 成功: true, 摘要: '不用找' });
    const 最新 = 最新届信息(届们);
    const 今年 = Number(今天.slice(0, 4));
    const 目标 = { 年份: (最新.年止 ?? 最新.年 ?? 今年 - 1) + 1, 届次: 最新.届 != null ? 届次文字(最新.届 + 1, 最新) : null,
      已知年份: 最新届.edition_year || (最新.年 ?? null), 已知届次: 最新届.edition_ordinal || (最新.届 != null ? 届次文字(最新.届, 最新) : null) };
    const 起 = [起始日期(最新届, 最新, 上次找新一届(db, 比赛编号).get(比赛编号), 今天毫秒), 今天].sort()[0];
    const 官方们 = 官方主机们(db, 比赛, 届们, 屏蔽);
    const 国家级 = 比赛.level === '国家级';
    const 结束 = 上届结束(最新届, 最新);
    记('目标', `库里最新一届 ${最新届.id}（届次 ${最新.届 ?? '认不出'}，年份 ${最新.年 ?? '认不出'}）；找 ${[目标.年份, 目标.届次].filter(Boolean).join('、')}，after:${起}；已知官方网站：${[...官方们].join('、') || '没有'}`);

    // 2 搜
    const 名截 = 后缀 => `${净(比赛.name).slice(0, Math.max(10, 120 - 后缀.length))} ${后缀}`;
    const 搜 = async 词 => {
      const 回 = await 会话.search({ purpose: 'new_edition_search', query: 词 });
      return 回?.references || [];
    };
    const 不要 = 网址 => { const h = 主机之(网址); return !h || 屏蔽网站.isBlockedHost(h, 屏蔽) || 垃圾站(h); };
    const 候选 = [];
    const 见过 = new Set();
    for (const 后缀 of [String(目标.年份), 目标.届次].filter(Boolean)) {
      const 词 = 名截(`${后缀} after:${起}`);
      const 结果们 = await 搜(词);
      const 留 = 结果们.filter(r => !不要(r.url) && !见过.has(r.url) && 见过.add(r.url));
      记('搜索', `「${词}」${结果们.length} 条，去掉屏蔽和重复留 ${留.length} 条`);
      候选.push(...留);
    }
    候选.splice(最多候选);

    // 3 程序先筛
    const 留下 = [];
    const 排掉 = [];
    for (const r of 候选) {
      const 标题 = 净(r.title);
      const 排 = 排除原因(标题, { 国家级 }) || 不是详情页原因(r.url, null, { 高校转发: 学校站(主机之(r.url)) && !官方们.has(主机之(r.url)) });
      if (排) { 排掉.push(`${标题}（${排}）`); continue; }
      if (!有比赛名(标题, 名们) && !有比赛名(r.content, 名们)) { 排掉.push(`${标题}（没有比赛名）`); continue; }
      const 认 = 认本赛届次(标题, 名们);
      if (是新届(认, 最新) === false) { 排掉.push(`${标题}（旧届：${认.届 != null ? 届次文字(认.届, 最新) : `${认.年}年`}）`); continue; }
      const 日 = 发布日期({ 搜索日期: r.date, 网址: r.url });
      const 旧 = 日 ? 太旧原因(日, { 今天, 上届结束: 结束 }) : '';
      if (旧) { 排掉.push(`${标题}（${旧}）`); continue; }
      留下.push({ ...r, 标题, 认 });
    }
    记('程序筛', `候选 ${候选.length} 条，留 ${留下.length} 条${排掉.length ? `；排除：${排掉.join('；')}` : ''}`);

    // 4 DeepSeek 选择题（分批）
    const 选上 = [];
    for (let i = 0; i < 留下.length; i += 每批最多) {
      const 批 = 留下.slice(i, i + 每批最多);
      let 回;
      try {
        回 = await 会话.chat({ purpose: 'new_edition_pick', messages: [{ role: 'user', content: 选择题(比赛, 目标, 批) }], json: true, promptVersion: 提问版本 });
      } catch (error) {
        if (error?.kind !== '格式不对') throw error;
        记('DeepSeek', `第 ${i / 每批最多 + 1} 批没按格式回答，当没选：${error.message}`);
        continue;
      }
      用量.tokensIn += 回?.usage?.tokensIn || 0;
      用量.tokensOut += 回?.usage?.tokensOut || 0;
      const 序号们 = (Array.isArray(回?.data?.选) ? 回.data.选 : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 批.length);
      记('DeepSeek', `第 ${i / 每批最多 + 1} 批 ${批.length} 条，选 ${序号们.length ? 序号们.join('、') : '无'}${净(回?.data?.理由) ? `（${净(回.data.理由)}）` : ''}`);
      for (const n of [...new Set(序号们)]) 选上.push(批[n - 1]);
    }

    // 5 读、核对、分组
    const 类之 = 网址 => { const h = 主机之(网址); return 官方们.has(h) ? '官方' : 学校站(h) ? '高校转发' : '其他'; };
    const 排序 = [...选上].sort((a, b) => (类之(a.url) !== '官方') - (类之(b.url) !== '官方') || (a.认.年 == null) - (b.认.年 == null)
      || 日期值(b.date).localeCompare(日期值(a.date)));
    const 组们 = [];
    // 核对一个页面：交回 { 过, 原因, 认 }；对照（给了组）时要指向同一新届。
    // 源 { 网址, 搜索日期 }：要是通知详情页、发布日期够新（2026-11-13；走到日期这一步时届次年份已经核过比库里新，认不出日期的照用）
    const 核对页面 = (页, 起认 = {}, 组 = null, 源 = {}) => {
      if (!读到内容.has(页?.status)) return { 过: false, 原因: `打不开（${页?.error || 页?.status || '没有返回'}）` };
      const 题 = 净(页.title);
      const 排 = 排除原因(题, { 国家级 });
      if (排) return { 过: false, 原因: `页面标题是${排}` };
      const 最终网址 = 页.finalUrl || 源.网址 || '';
      const 非详情 = 不是详情页原因(最终网址, 页, { 高校转发: 类之(最终网址) === '高校转发' });
      if (非详情) return { 过: false, 原因: 非详情 };
      if (!有比赛名(`${题} ${页.text || ''}`, 名们)) return { 过: false, 原因: '页面上没有比赛名' };
      const 页认 = 合并认(认本赛届次(题, 名们), 认本赛届次(String(页.text || '').slice(0, 20000), 名们, { 兜底: false }));
      if (类之(最终网址) === '高校转发' && 是新届(页认, 最新) !== true) {
        return { 过: false, 原因: '通知详情未证实是新一届' };
      }
      const 认 = 合并认(页认, 起认);
      if (组) { if (!同一新届(组, 认)) return { 过: false, 原因: '不是同一届' }; } else {
        const 新 = 是新届(认, 最新);
        if (新 !== true) return { 过: false, 原因: 新 === false ? `旧届（${认.届 != null ? 届次文字(认.届, 最新) : `${认.年}年`}）` : '认不出届次年份' };
      }
      const 旧 = 太旧原因(发布日期({ 搜索日期: 源.搜索日期, 网址: [源.网址, 页.finalUrl].filter(Boolean), 正文: 页.text }), { 今天, 上届结束: 结束, 明确更新: true });
      if (旧) return { 过: false, 原因: 旧 };
      return { 过: true, 认 };
    };
    const 认文字 = 认 => ({ 届次: 认.届 != null ? 届次文字(认.届, 最新) : null, 年份: 认.年 ?? null });

    // 追官方原文：页面里指向官方网站的链接 → 外部网站（判断官网）→ 已知官方域名下站内搜
    const 追官方 = async (页, 网址, 组) => {
      const 页主机 = 主机之(页.finalUrl || 网址);
      const 链们 = [...(页.links || []).map(l => ({ 网址: l.url, 字: 净(l.text) })), ...文中网址(页.text).map(u => ({ 网址: u, 字: '' }))];
      const 已 = new Set();
      const 官方链 = [];
      const 外链 = [];
      for (const l of 链们) {
        const h = 主机之(l.网址);
        if (!h || 已.has(l.网址) || h === 页主机 || 不要(l.网址)) continue;
        已.add(l.网址);
        if (官方们.has(h)) 官方链.push(l);
        else if (!学校站(h) && !/(^|\.)gov\.cn$/.test(h) && 根域(h) !== 根域(页主机) && (/通知|大赛|竞赛|比赛|报名|官网|官方|赛事|详见/.test(l.字) || 有比赛名(l.字, 名们))) 外链.push(l);
      }
      for (const l of 官方链) {
        const 核 = 核对页面(await 读(l.网址), {}, 组, { 网址: l.网址 });
        记('追官方', `${l.网址}（官方网站上的链接）：${核.过 ? '对上了' : 核.原因}`);
        if (核.过) return { 网址: l.网址, 标题: l.字, 认: 核.认 };
      }
      for (const l of 外链.slice(0, 最多追外链)) {
        const 页2 = await 读(l.网址);
        const 核 = 核对页面(页2, {}, 组, { 网址: l.网址 });
        if (!核.过) { 记('追官方', `${l.网址}（外部链接）：${核.原因}`); continue; }
        const 首页 = `${new URL(页2.finalUrl || l.网址).origin}/`;
        let 判;
        try { 判 = await 部件.判断官网(首页, 比赛, { 读网页: 工具.读网页, 屏蔽, 库里最新年份: 最新.年止 ?? 最新.年 }); } catch (error) { 判 = { 是: false, 原因: `判断出错（${String(error?.message || error).slice(0, 100)}）` }; }
        记('追官方', `${l.网址}（外部链接）：页面对上了；首页 ${首页} ${判?.是 ? '是官网' : `不算官网（${判?.原因 || ''}）`}`);
        if (判?.是) return { 网址: l.网址, 标题: 净(页2.title), 认: 核.认 };
      }
      const 届词 = 组.届 != null ? 届次文字(组.届, 最新) : 组.年 != null ? String(组.年) : 目标.届次 || String(目标.年份);
      for (const h of [...官方们].slice(0, 2)) {
        const 词 = `site:${h} ${名截(`${届词} after:${起}`)}`;
        const 结果们 = (await 搜(词)).filter(r => 主机之(r.url) === h && !排除原因(净(r.title), { 国家级 }));
        记('追官方', `站内搜「${词}」${结果们.length} 条`);
        for (const r of 结果们.slice(0, 最多读站内搜索)) {
          const 核 = 核对页面(await 读(r.url), 认本赛届次(净(r.title), 名们), 组, { 网址: r.url, 搜索日期: r.date });
          记('追官方', `${r.url}（站内搜到）：${核.过 ? '对上了' : 核.原因}`);
          if (核.过) return { 网址: r.url, 标题: 净(r.title), 认: 核.认 };
        }
      }
      return null;
    };

    for (const r of 排序.slice(0, 最多读线索)) {
      const 页 = await 读(r.url);
      const 核 = 核对页面(页, r.认, null, { 网址: r.url, 搜索日期: r.date });
      if (!核.过) { 记('读通知', `${r.url}：${核.原因}，不用`); continue; }
      const 类 = 类之(r.url);
      const 条 = { 网址: r.url, 标题: r.标题, 类, ...认文字(核.认) };
      线索.push(条);
      let 组 = 组们.find(g => 同一新届(g, 核.认));
      if (!组) { 组 = { 届: null, 年: null, 年止: null, 官方: null, 转发: null, 追过: false }; 组们.push(组); }
      if (组.届 == null) 组.届 = 核.认.届;
      if (组.年 == null && 核.认.年 != null) Object.assign(组, { 年: 核.认.年, 年止: 核.认.年止 });
      记('读通知', `${r.url}：对上了（${类}，${[条.年份 && `${条.年份}年`, 条.届次].filter(Boolean).join('') || '新一届'}）`);
      if (组.官方) continue;
      if (类 === '官方') { 组.官方 = { 网址: r.url, 标题: r.标题 }; continue; }
      if (!组.转发 && 类 === '高校转发') 组.转发 = { 网址: r.url, 标题: r.标题 };
      if (组.追过) continue;
      组.追过 = true;
      const 官 = await 追官方(页, r.url, 组);
      if (官) {
        组.官方 = { 网址: 官.网址, 标题: 官.标题 || r.标题 };
        条.官方 = 官.网址;
        if (组.年 == null && 官.认?.年 != null) Object.assign(组, { 年: 官.认.年, 年止: 官.认.年止 });
        if (组.届 == null && 官.认?.届 != null) 组.届 = 官.认.届;
      }
    }

    // 6 新届一次最多建一届（2026-11-13 用户定）：同一次找到几个新届，只交最新的那一届
    const 最新组 = 取最新一届(组们);
    const 届名 = 组 => (组.届 != null ? 届次文字(组.届, 最新) : `${组.年}年`);
    if (组们.length > 1) 记('入库', `同时找到 ${组们.map(届名).join('、')}，只建最新的${届名(最新组)}（一次最多一届）`);
    const 条目们 = [];
    for (const 组 of 最新组 ? [最新组] : []) {
      const 用 = 组.官方 || 组.转发;
      if (!用) { 记('入库', `${组.届 != null ? 届次文字(组.届, 最新) : `${组.年}年`}：只有非高校、非官方网站的转载，不用`); continue; }
      const 年份 = 组.年 == null ? null : 组.年止 && 组.年止 !== 组.年 ? `${组.年}—${组.年止}` : String(组.年);
      const 转 = !组.官方;
      条目们.push({ 网址: 用.网址, 标题: 用.标题, 比赛名: 比赛.name, 比赛编号, 新届: { 年份, 届次: 届次文字(组.届, 最新) },
        ...(转 ? { 来源类型: 高校转发 } : {}),
        核对说明: 转
          ? `找新一届 ${今天}：高校转发（${主机之(用.网址)}），没追到官方通知，不算官方来源；程序核对过比赛名和届次（2026-11-12 用户定）`
          : `找新一届 ${今天}：官方网站上的通知，程序核对过比赛名和届次，不审核直接发布（2026-11-12 用户定）` });
    }
    if (!条目们.length) {
      const 原因 = [选上.length ? `DeepSeek 选了 ${选上.length} 条，读了核对都不是新一届` : 留下.length ? 'DeepSeek 没选' : '搜索结果里没有对得上的', 排掉.length ? `程序排除 ${排掉.length} 条` : ''].filter(Boolean).join('；');
      return 收尾('没发现新一届', 原因, { 成功: true, 摘要: '没发现新一届' });
    }

    // 7 入库（不审核、不改已有）
    const 入 = await 部件.入库(条目们, { 主库: db, ai, web: { 读网页: 工具.读网页 }, 来源: 来源名, 试跑, now, 更新已有: false, 不审核: true });
    const 结果们 = (入?.条目们 || []).map(x => ({ ...x, 入库类型: x.入库类型 ?? x.入库?.decision ?? null, 写进: x.写进 === true }));
    const 各条 = 结果们.map(x => `${x.网址}：${x.状态}${x.原因 ? `（${x.原因}）` : ''}`).join('；');
    记('入库', 各条);
    const 额度条 = 结果们.map(x => 停批错误(new Error(String(x.原因 || '')))).find(Boolean);
    if (额度条) 往外抛 = 额度条;
    if (入?.写入?.error) return 收尾('入库，写进主库出错', `写进主库出错：${String(入.写入.error?.message || 入.写入.error).slice(0, 300)}`, { 成功: false, 摘要: '出错', 入库: 结果们 });
    const 新建 = 结果们.filter(x => x.写进 && x.入库类型 === '新一届').length;
    if (新建) return 收尾('入库', '', { 成功: true, 摘要: `入库 ${新建} 条`, 入库: 结果们 });
    const 拟 = 试跑 ? 结果们.filter(x => x.状态 === '进行中' && x.入库类型 === '新一届').length : 0;
    if (拟) return 收尾('试跑发现新一届', '', { 成功: true, 摘要: `拟新增 ${拟} 届`, 入库: 结果们 });
    return 收尾('入库，一条都没建', 各条, { 成功: false, 摘要: '被挡掉', 入库: 结果们 });
  };

  let 回;
  try {
    回 = await 做();
  } catch (error) {
    if (已收尾) throw error;
    回 = 收尾('出错', String(error?.message || error).slice(0, 300), { 成功: false, 摘要: '出错' });
    往外抛 = 停批错误(error) ?? 往外抛;
  }
  if (往外抛) throw 往外抛;
  return 回;
}
