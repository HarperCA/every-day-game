// 核对原文（AI 审查，2026-11-05、11-06 用户定）：Codex 联网查这一届的官方来源，程序重新读网页、逐字核对，核不到的不算。只读比赛库，交回问题。
//   搜索轮次    每届最多 3 轮，每轮单独起一次 Codex、只搜 1 次，结束时写摘要（搜索进度、下一轮从哪里开始）交给下一轮；下一轮只看摘要，不带上一轮的全部内容（2026-11-06 用户定，省 token）
//               几轮核到的字段由程序合起来；3 轮到了没下结论：核到的照写，但不发布、不归档
//   发布前查重  同名比赛下已有同一届已发布、已归档的：进回收站，写明和哪一届重复（2026-11-07 用户定，照旧系统）。线上华为 ICT 两届年份写法不同（2026、2026—2027），所以按年份重叠算；届次或赛道两边都写了且不同的不算
//   按名称搜    不把库里的官网、报名入口、来源网址交给 Codex，让它按名称、届次、年份搜新网页；不是官方的直接放弃，不再纠缠（2026-11-07 用户定）。旧网址和新结果的对比由程序做
//   只调 Codex（AI 总管用途 audit，开内置搜索）；读网页是 ctx.web 自己的程序。不用百度、Kimi、DeepSeek。
//   每次只看 ctx.范围 给的一个比赛：待人工审核、已发布、最新一届，最多 3 届。没给范围不做全库审查（太费额度）。
//
//   待人工审核  审完只有三个去向（2026-11-07 用户定）：通过且过门槛 → 报名没截止发布、已截止（或没写截止、年份早于今年）归档；其余一律进回收站（30 天可恢复），理由写在届次上。AI 有权删，要说明理由
//               例外留在待审：校内赛（用户要留存，回收站到期会彻底删）；状态是人工定的；官方页面因技术故障读不到（超时、连不上、403、429、5xx，算这个比赛失败，下次再试，故障不能当删除理由）
//               查不到、拿不准、过不了门槛、名称不符、原文核不到 → 留着，理由写清楚（同一项换成最新的，不越堆越多）
//   已发布、已归档  只改原文写着的时间、补空字段、加来源；AI 判定不收、官网证书过期的进回收站（2026-11-07 用户定，校内赛和人工定的状态除外）；查不到不动，老届次官方页面没了很正常；AI 不改它们的状态（9 月 29 日 AI 撤下 24 条的教训）
//   证书过期    官方网页证书过期的比赛进回收站（2026-11-07 用户定），不算技术故障
//   屏蔽名单（内置 + 后台确认）里的网站及其子站不当依据，已有的这类来源也不计入发布门槛（2026-11-06 真实运行：AI 把 52jingsai 子站当官方，发布了创研杯）
//   怎么改      时间和原文不一致的改成原文的；文字、主办方、专业只补空的，有内容的不覆盖；名称不自动改；人工改过的字段不碰
//   报名入口    和官方原文不同时（2026-11-06 用户定）：待审的换成官方的；已发布、已归档的只在旧链接 404/410 或在屏蔽名单时换，其余只记下给人看
//               403、超时、网络错误不算打不开：常见的是网站拦爬虫，或美国服务器连不上国内网站，学生那边可能是通的
//
//   run(ctx) → { problems: [问题] }，问题的写法见 ../../README.md；处置：人工、回收站、只记下、新增
//   额度用完、接口出错抛给调用方（这一项算失败，批量维护决定停不停）；Codex 交回的内容用不了只记下
// 规矩：只用 ctx 给的东西，不 import 别的检查项。
import { loadPrompt } from '../../../../../共用/工具/提示词.mjs';
import { 屏蔽网站 } from '../../../index.mjs';
import { 查发布, 查门槛 } from '../../../../程序审核/index.mjs';
import { 专业分类, 字段表, 核对一项, 核对待公布 } from '../../../../补字段/index.mjs';
import { 检查, 输出格式 } from './schema.mjs';

export const meta = { title: '核对原文' };
export const 用途 = 'audit';
const 提示词文件 = new URL('./prompt.md', import.meta.url);
const 每个比赛最多届次 = 3;
const 最多网页 = 6;
const 每项最多字 = 2000;
const 最多轮 = 3;
const 摘要最多字 = 400;

const 时间们 = ['registration_start', 'registration_end', 'competition_start', 'competition_end'];
const 报名时间 = ['registration_start', 'registration_end'];
const 比赛字段们 = ['organizer', 'professions'];
const 能核的字段 = [...时间们, 'participants', 'eligibility', 'format_and_rules', 'registration_url', 'registration_method', 'fees', 'rewards', ...比赛字段们];

const 空 = 值 => 值 == null || (Array.isArray(值) ? !值.length : /^\s*(暂未明确|暂未公布|待确认|待核实|未知|暂无)?\s*$/.test(String(值)));
const 压网址 = 网址 => String(网址 || '').trim().replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
const 同一链接 = (a, b) => String(a || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase() === String(b || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();

function 挑届次(全部) {
  const 排 = [...全部.filter(e => e.status === '待人工审核'), ...全部.filter(e => e.status === '已发布'), ...全部.slice(0, 1)];
  return [...new Map(排.map(e => [e.id, e])).values()].slice(0, 每个比赛最多届次);
}

function 已知信息(比赛, 届) {
  const 记录 = { 比赛名称: 比赛.name, 这一届: 届.edition_name, 年份: 届.edition_year, 届次: 届.edition_ordinal, 主办方: 届.organizer || 比赛.organizer,
    参赛对象: 届.participants, 报名开始: 届.registration_start, 报名截止: 届.registration_end, 比赛开始: 届.competition_start, 比赛结束: 届.competition_end };
  return `赛事记录：${JSON.stringify(Object.fromEntries(Object.entries(记录).filter(([, v]) => !空(v))))}`;
}

const 在屏蔽名单 = (网址, 屏蔽们) => {
  try { return 屏蔽网站.isBlockedHost(new URL(网址).hostname, 屏蔽们); } catch { return false; }
};

// 技术故障：不是页面没了，是这一次读不到；不能当成删除的理由（照旧系统）。404 不算，那是页面确实不在
const 证书坏了 = 页 => /certificate has expired|CERT_HAS_EXPIRED/i.test(页.error || '');
const 技术故障 = 页 => ['超时', '网络错误', '内部错误'].includes(页.status) || (页.status === 'HTTP错误' && (页.httpStatus === 403 || 页.httpStatus === 429 || 页.httpStatus >= 500));

async function 读网页们(data, ctx, 屏蔽们) {
  const 全部网址 = [...new Set([...data.字段们, ...(data.待公布 || []), data.不收].filter(Boolean).map(项 => 项.网址).filter(u => /^https?:\/\//i.test(u || '')))];
  const 被屏蔽 = 全部网址.filter(u => 在屏蔽名单(u, 屏蔽们));
  const 网址们 = 全部网址.filter(u => !被屏蔽.includes(u)).slice(0, 最多网页);
  const 读过 = new Map();
  const 标题 = new Map();
  const 读不到 = [];
  const 证书过期 = [];
  for (const 网址 of 网址们) {
    const 页 = await ctx.web.读网页(网址, { signal: ctx.signal });
    if (证书坏了(页)) 证书过期.push(网址);
    else if (技术故障(页)) 读不到.push(网址);
    if (!['成功', '正文太短'].includes(页.status)) continue;
    读过.set(网址, { 正文: String(页.text || ''), 链接们: (页.links || []).map(l => l.url) });
    标题.set(网址, 页.title || '');
  }
  return { 读过, 标题, 被屏蔽, 读不到, 证书过期 };
}

// 库里已有报名入口、官方写的不一样时换不换：{ 换, 说明 }
async function 换不换报名入口(待审, 旧, 新, 屏蔽们, ctx) {
  if (待审 || 在屏蔽名单(旧, 屏蔽们)) return { 换: true };
  const 页 = await ctx.web.读网页(旧, { signal: ctx.signal });
  if (页.status === 'HTTP错误' && [404, 410].includes(页.httpStatus)) return { 换: true };
  return { 换: false, 说明: `官方写的报名入口是 ${新}，和现有的不同；现有链接${['成功', '正文太短'].includes(页.status) ? '能打开' : `读不到（${页.status}${页.httpStatus ? ` ${页.httpStatus}` : ''}），不一定是坏的`}，没有换` };
}

const 年份们 = 文字 => String(文字 || '').match(/(19|20)\d{2}/g) || [];
const 都写了且不同 = (a, b) => Boolean(String(a || '').trim() && String(b || '').trim() && String(a).trim() !== String(b).trim());

function 找重复(比赛, 届, ctx) {
  const 年们 = 年份们(届.edition_year);
  if (!年们.length) return null;
  const 比赛们 = new Set([比赛.id, ...ctx.db.find('competition', { name: 比赛.name }).map(c => c.id)]);
  for (const id of 比赛们) {
    const 重复 = ctx.db.find('edition', { competition_id: id }).find(e => e.id !== 届.id && ['已发布', '已归档'].includes(e.status)
      && 年份们(e.edition_year).some(年 => 年们.includes(年))
      && !都写了且不同(e.edition_ordinal, 届.edition_ordinal) && !都写了且不同(e.track_name, 届.track_name));
    if (重复) return 重复;
  }
  return null;
}

// 同一天算一样（库里只写日期、原文带钟点，或者反过来）
const 同一天 = (a, b) => String(a || '').slice(0, 10) === String(b || '').slice(0, 10);

// 日期要属于这一届：和年份差一年以上的不采用（官网只有别的届次时 Codex 可能写错）
function 不是这一届(届, 值) {
  const 年们 = String(届.edition_year || '').match(/(19|20)\d{2}/g)?.map(Number);
  const 年 = Number(String(值).slice(0, 4));
  return Boolean(年们?.length) && (年 < Math.min(...年们) - 1 || 年 > Math.max(...年们) + 1);
}

// 报名结束了没有：写了截止看截止；没写的，届次年份（跨年按后面那年）早于今年算结束（2026-11-06 试审发现：名录里早年的届次否则永远过不了发布门槛）
const 已截止 = (记录, now) => {
  if (!记录.registration_end) {
    const 年们 = String(记录.edition_year || '').match(/(19|20)\d{2}/g)?.map(Number);
    return Boolean(年们?.length) && Math.max(...年们) < Number(new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 4));
  }
  const 值 = /^\d{4}-\d{2}-\d{2}$/.test(记录.registration_end) ? `${记录.registration_end}T23:59:59.999+08:00` : 记录.registration_end;
  const t = Date.parse(值);
  return Number.isFinite(t) && t < now.getTime();
};

// 比赛和届次合起来给程序审核看：届次写了的优先，没写的用比赛的
function 合并(比赛, 届) {
  const 记录 = { ...比赛 };
  for (const [键, 值] of Object.entries(届)) if (值 != null || !(键 in 记录)) 记录[键] = 值;
  return { ...记录, name: 比赛.name, id: 届.id };
}

const 留给人看 = (届, 依据, 出处 = []) => ({ table: 'edition', key: 届.id, 字段: '资料', 类型: '错误', 把握: '不确定', 处置: '人工', 依据, 出处, 替换旧理由: true });
const 只记下 = (届, 说明) => ({ table: 'edition', key: 届.id, 字段: '资料', 类型: '错误', 把握: '不确定', 处置: '只记下', 说明 });

// 这一届没法往下走时：待人工审核的把原因写在届次上；已发布、已归档的绝不动状态，只记下
const 进回收站 = (届, 依据, 出处 = []) => ((届.manual_fields || []).includes('status')
  ? (届.status === '待人工审核' ? 留给人看(届, `${依据}；状态是人工定的，要人决定`, 出处) : 只记下(届, `${依据}；状态是人工定的，要人决定`))
  : { table: 'edition', key: 届.id, 字段: 'status', 类型: '错误', 把握: '有把握', 处置: '回收站', 依据, 出处 });
const 没结果 = (届, 原因, 出处) => (届.status === '待人工审核' ? 进回收站(届, 原因, 出处) : 只记下(届, 原因));

function 来源改动(届, 现有来源, 已核对, 标题, data, at) {
  const 按网址 = new Map();
  for (const 项 of 已核对) {
    if (!按网址.has(项.网址)) 按网址.set(项.网址, { 网址: 项.网址, 原文: 项.原文, 字段们: [] });
    按网址.get(项.网址).字段们.push(项.字段);
  }
  const 问题们 = [];
  const 核验后 = [];
  let 序号 = 现有来源.length;
  for (const { 网址, 原文, 字段们 } of 按网址.values()) {
    const 内容 = { final_url: 网址, source_type: 'organizer_notice', is_official: true, validity_status: 'valid', title: (标题.get(网址) || 届.edition_name || '官方来源').slice(0, 200),
      content_summary: data.理由.slice(0, 每项最多字), evidence_excerpt: 原文.slice(0, 每项最多字), review_reason: `AI 审查核对原文通过：${data.理由}`.slice(0, 每项最多字), supports_fields: 字段们, last_verified_at: at };
    const 已有 = 现有来源.find(s => 压网址(s.url) === 压网址(网址) || 压网址(s.final_url) === 压网址(网址));
    if (已有) {
      问题们.push({ table: 'source', key: 已有.id, 字段: 'validity_status', 类型: '错误', 现在的值: 已有.validity_status, 建议改动: 内容, 把握: '有把握', 依据: 'AI 审查核对过这条来源', 出处: [{ 网址, 原文 }] });
      核验后.push({ ...已有, ...内容 });
    } else {
      序号 += 1;
      const id = `source-${届.id.replace(/^edition-/, '')}-审查${序号}`;
      问题们.push({ table: 'source', key: id, 字段: 'url', 处置: '新增', 行: { edition_id: 届.id, url: 网址, ...内容 }, 依据: 'AI 审查新增官方来源', 出处: [{ 网址, 原文 }] });
      核验后.push({ id, edition_id: 届.id, url: 网址, ...内容 });
    }
  }
  return { 问题们, 核验后 };
}

const 这一轮的话 = (基本, 轮, 摘要, 字段们) => [基本, `这是第 ${轮} 轮，最多 ${最多轮} 轮。${轮 === 最多轮 ? '这是最后一轮，结论不能写“继续”。' : ''}`,
  摘要 ? `上一轮摘要：进度：${摘要.进度}；下一轮从哪里开始：${摘要.下一轮从哪里开始}` : '',
  字段们.length ? `前面几轮已核到（不用再找）：${字段们.join('、')}` : ''].filter(Boolean).join('\n');

// 跑几轮，交回和一轮的答案同样格式的结果；交回 { 用不了 } 表示 Codex 的内容用不了。额度用完、接口出错照样抛出去
async function 查几轮(比赛, 届, ctx) {
  const { version, text } = loadPrompt(提示词文件, { 今天: new Date(ctx.now().getTime() + 8 * 3600000).toISOString().slice(0, 10), 专业分类: 专业分类.join('、') });
  const 基本 = 已知信息(比赛, 届);
  const 字段累计 = new Map();
  const 待公布累计 = new Map();
  let 摘要 = null;
  let 最后 = null;
  let 轮 = 0;
  while (轮 < 最多轮) {
    轮 += 1;
    ctx.报告进度?.('搜索官方资料', { 轮次: 轮, 最多轮次: 最多轮 });
    let data;
    try {
      ({ data } = await ctx.ai.chat({ purpose: 用途, json: true, schema: 输出格式, promptVersion: version, signal: ctx.signal,
        messages: [{ role: 'system', content: text }, { role: 'user', content: 这一轮的话(基本, 轮, 摘要, [...字段累计.keys()]) }] }));
    } catch (error) {
      if (error?.kind === '搜索超限') {
        ctx.log.warn(`${届.edition_name || 届.id} 第 ${轮} 轮超过搜索次数，这一轮作废`);
        摘要 = { 进度: `第 ${轮} 轮超过了搜索次数，被程序停下，没有结果`, 下一轮从哪里开始: 摘要?.下一轮从哪里开始 || '只搜 1 次，直接找官方通知' };
        continue;
      }
      if (error?.kind !== '格式不对') throw error;
      return { 用不了: `Codex 交回的内容用不了：${error.message}` };
    }
    const 格式问题 = 检查(data);
    if (格式问题) {
      ctx.ai.报告问题?.({ purpose: 用途, promptVersion: version, 原因: `${届.edition_name || 届.id}：${格式问题}` });
      return { 用不了: `Codex 交回的内容用不了：${格式问题}` };
    }
    最后 = data;
    if (data.来源性质 === '官方') {
      for (const 项 of data.字段们) 字段累计.set(项.字段, 项);
      for (const 项 of data.待公布 ?? []) 待公布累计.set(项.字段, 项);
    }
    ctx.log.info(`${届.edition_name || 届.id} 第 ${轮} 轮：${data.结论}${data.结论 === '继续' ? `；${data.搜索摘要.进度.slice(0, 120)}；下一轮从：${data.搜索摘要.下一轮从哪里开始.slice(0, 120)}` : `；${data.理由.slice(0, 120)}`}`);
    if (data.结论 !== '继续') break;
    摘要 = { 进度: data.搜索摘要.进度.slice(0, 摘要最多字), 下一轮从哪里开始: data.搜索摘要.下一轮从哪里开始.slice(0, 摘要最多字) };
  }

  if (!最后) return { 结论: '查不到', 理由: `搜了 ${轮} 轮，每轮都超过搜索次数`, 来源性质: '判断不了', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [] };
  const 合起来 = { 字段们: [...字段累计.values()], 待公布: [...待公布累计.values()] };
  if (最后.结论 === '通过') return { ...最后, ...(最后.来源性质 === '官方' ? 合起来 : {}) };
  if (最后.结论 === '不收') return 最后;
  const 经过 = [最后.理由, 最后.结论 === '继续' ? `最后的进度：${摘要.进度}` : ''].filter(Boolean).join('；');
  const 理由 = 轮 > 1 || 最后.结论 === '继续' ? `搜了 ${轮} 轮：${经过}` : 经过;
  // 前面核到了官方字段但最后没说通过：核到的不浪费，照走核对；后面不许发布、归档
  if (合起来.字段们.length || 合起来.待公布.length) return { ...最后, ...合起来, 结论: '通过', 来源性质: '官方', 理由, 没下结论: true };
  return { ...最后, 结论: '查不到', 理由 };
}

async function 审一届(比赛, 届, ctx) {
  const 现有来源 = ctx.db.find('source', { edition_id: 届.id });
  const data = await 查几轮(比赛, 届, ctx);
  if (data.用不了) return [只记下(届, data.用不了)];

  ctx.报告进度?.('读取官方原文');
  const 屏蔽们 = 屏蔽网站.当前屏蔽(ctx.db);
  const { 读过, 标题, 被屏蔽, 读不到, 证书过期 } = await 读网页们(data, ctx, 屏蔽们);
  ctx.报告进度?.('核对原文');
  const 待审 = 届.status === '待人工审核';
  const 屏蔽说明 = 被屏蔽.length ? `依据在屏蔽名单的网站上，不算数：${被屏蔽.slice(0, 3).join('、')}` : '';

  if (data.结论 === '查不到') return [没结果(届, `查不到：${data.理由}`)];
  if (data.结论 === '不收') {
    const { 类别, 网址, 原文 } = data.不收;
    const 出处 = [{ 网址, 原文 }];
    const 核到了 = 核对一项({ 字段: 'format_and_rules', 值: 原文, 网址, 原文 }, 读过).ok;
    if (类别 === '校内赛') return [待审 ? 留给人看(届, `校内赛，留存不进回收站：${data.理由}`, 出处) : 只记下(届, `校内赛，留存不进回收站：${data.理由}`)];
    return [进回收站(届, `${类别}：${data.理由}${核到了 ? '' : `（AI 给的原文程序没核到${屏蔽说明 ? `；${屏蔽说明}` : ''}）`}`, 出处)];
  }
  if (证书过期.length) return [进回收站(届, `官方网页证书过期：${证书过期.slice(0, 2).join('、')}（AI 的结论：${data.理由}）`)];
  if (data.来源性质 !== '官方') return [没结果(届, `来源不是官方的（${data.来源性质}）：${data.理由}`)];

  // 结论是通过：逐项核对
  const at = ctx.now().toISOString();
  const 没核到 = [];
  const 已核对 = [];
  for (const 项 of data.字段们) {
    if (!能核的字段.includes(项.字段) || 已核对.some(x => x.字段 === 项.字段)) continue;
    const 名 = 字段表[项.字段]?.名 || 项.字段;
    let r = 核对一项(项, 读过);
    // 日期核得到、钟点对不上（AI 多写了钟点）：只留日期，不因格式问题把真比赛删掉（2026-11-07 试跑发现）
    if (!r.ok && 时间们.includes(项.字段) && /钟点/.test(r.原因) && /^\d{4}-\d{2}-\d{2}T/.test(String(项.值))) r = 核对一项({ ...项, 值: String(项.值).slice(0, 10) }, 读过);
    if (!r.ok) { 没核到.push({ 字段: 项.字段, 文字: `${名}：${r.原因}` }); continue; }
    if (时间们.includes(项.字段) && 不是这一届(届, r.值)) { 没核到.push({ 字段: 项.字段, 文字: `${名}：${r.值} 不是这一届的日期` }); continue; }
    if (项.字段 === 'registration_url' && 在屏蔽名单(r.值, 屏蔽们)) { 没核到.push({ 字段: 项.字段, 文字: `${名}：${r.值} 在屏蔽名单，不采用` }); continue; }
    已核对.push({ 字段: 项.字段, 值: r.值, 网址: 项.网址, 原文: 项.原文 });
  }
  const 待公布 = [];
  for (const 项 of data.待公布 || []) {
    if (核对待公布(项, 读过).ok) 待公布.push({ 字段: 项.字段, 网址: 项.网址, 原文: 项.原文 });
    else 没核到.push({ 字段: 项.字段, 文字: `${字段表[项.字段]?.名 || 项.字段}（待公布）：原文核不到` });
  }

  const 问题们 = [];
  const 记下们 = [];
  const 改后比赛 = { ...比赛 };
  const 改后届 = { ...届 };
  for (const 项 of 已核对) {
    const 在比赛上 = 比赛字段们.includes(项.字段);
    const 行 = 在比赛上 ? 比赛 : 届;
    const 现值 = 行[项.字段];
    const 是时间 = 时间们.includes(项.字段);
    if (项.字段 === 'registration_url' && !空(现值)) {
      if (同一链接(现值, 项.值) || (行.manual_fields || []).includes(项.字段)) continue;   // 人工定的链接不换，也不挡发布
      const { 换, 说明 } = await 换不换报名入口(待审, 现值, 项.值, 屏蔽们, ctx);
      if (!换) { 记下们.push(说明); continue; }
    } else if (空(现值) ? false : (是时间 ? 同一天(现值, 项.值) : true)) continue;   // 一样的、文字已经有内容的不动
    if ((行.manual_fields || []).includes(项.字段)) { 记下们.push(`${字段表[项.字段]?.名 || 项.字段}：人工改过，机器不改（官方写的是 ${JSON.stringify(项.值)}）`); continue; }
    问题们.push({ table: 在比赛上 ? 'competition' : 'edition', key: 行.id, 字段: 项.字段, 类型: 空(现值) ? '缺失' : '错误', 现在的值: 现值 ?? null,
      建议改动: { [项.字段]: 项.值 }, 把握: '有把握', 依据: data.理由, 出处: [{ 网址: 项.网址, 原文: 项.原文 }] });
    (在比赛上 ? 改后比赛 : 改后届)[项.字段] = 项.值;
  }
  if (待公布.some(x => 报名时间.includes(x.字段)) && 空(改后届.registration_end) && !届.pending_announcement && !(届.manual_fields || []).includes('pending_announcement')) {
    const 项 = 待公布.find(x => 报名时间.includes(x.字段));
    问题们.push({ table: 'edition', key: 届.id, 字段: 'pending_announcement', 类型: '缺失', 现在的值: false, 建议改动: { pending_announcement: true }, 把握: '有把握', 依据: data.理由, 出处: [{ 网址: 项.网址, 原文: 项.原文 }] });
    改后届.pending_announcement = true;
  }

  const 依据们 = [...已核对, ...待公布];
  const { 问题们: 来源问题, 核验后 } = 来源改动(届, 现有来源, 依据们, 标题, data, at);
  问题们.push(...来源问题);

  const 名称不符 = data.名称.对不对 === false ? `比赛名称和官方不符，官方写法：${String(data.名称.改正 || '').slice(0, 200)}` : '';
  const 备注 = [名称不符, 屏蔽说明, ...记下们, ...没核到.map(x => x.文字)].filter(Boolean);

  if (!待审) {
    if (依据们.length) 问题们.push({ table: 'edition', key: 届.id, 字段: 'last_verified_at', 类型: '错误', 现在的值: 届.last_verified_at ?? null, 建议改动: { last_verified_at: at }, 把握: '有把握', 依据: data.理由, 出处: 依据们.slice(0, 1).map(x => ({ 网址: x.网址, 原文: x.原文 })) });
    if (备注.length) 问题们.push(只记下(届, 备注.join('；')));
    return 问题们;
  }

  // 待人工审核：过得了就发布或归档，过不了进回收站（名称不符、人工改过的字段不挡，记进后台记录）
  const 不能发布 = [];
  const 重复 = 找重复(比赛, 届, ctx);
  if (重复) 不能发布.push(`和已公开的“${重复.edition_name}”（${重复.id}）重复`);
  if (data.没下结论) 不能发布.push(`AI 没下结论（${data.理由}）`);
  if (!依据们.length) 不能发布.push('一个字段都没核到');
  不能发布.push(...没核到.filter(x => 报名时间.includes(x.字段)).map(x => x.文字));
  const 其余没核到 = 没核到.filter(x => !报名时间.includes(x.字段)).map(x => x.文字);
  const 记录 = { ...合并(改后比赛, 改后届), sources: [...现有来源.filter(s => !核验后.some(x => x.id === s.id) && !在屏蔽名单(s.url, 屏蔽们) && !在屏蔽名单(s.final_url, 屏蔽们)), ...核验后] };
  const 门槛 = 查门槛(记录);
  if (门槛.结果 === '不收') 不能发布.push(`收录门槛不收：${门槛.原因}`);
  const 截止了 = 已截止(记录, ctx.now());
  const 发布门槛 = 查发布(记录, { 归档: 截止了 });
  if (发布门槛.结果 !== '通过') 不能发布.push(...发布门槛.原因们);

  if (不能发布.length) {
    if (读不到.length) throw Object.assign(new Error(`${届.edition_name || 届.id}：官方页面这次读不到（${读不到.slice(0, 2).join('、')}），下次再试`), { kind: '网页读不到' });
    return [进回收站(届, `AI 审查没法${截止了 ? '归档' : '发布'}：${[...不能发布, 屏蔽说明, ...其余没核到].filter(Boolean).join('；')}`, 依据们.slice(0, 2).map(x => ({ 网址: x.网址, 原文: x.原文 })))];
  }
  问题们.push({ table: 'edition', key: 届.id, 字段: 'status', 类型: '错误', 现在的值: 届.status, 建议改动: { status: 截止了 ? '已归档' : '已发布', status_reason: [], last_verified_at: at }, 把握: '有把握',
    依据: `AI 审查通过：${data.理由}`, 出处: 依据们.slice(0, 2).map(x => ({ 网址: x.网址, 原文: x.原文 })) });
  const 记进后台 = [名称不符, 屏蔽说明, ...记下们, ...其余没核到].filter(Boolean);
  if (记进后台.length) 问题们.push(只记下(届, 记进后台.join('；')));
  return 问题们;
}

export async function run(ctx) {
  const 编号 = ctx.范围?.比赛编号;
  if (!编号) { ctx.log.info('没给比赛范围，不做全库审查'); return { problems: [] }; }
  const 行 = ctx.db.get('competition', 编号);
  if (!行) return { problems: [] };
  const 比赛 = { id: 编号, ...行.data };
  const 全部 = ctx.db.find('edition', { competition_id: 编号 }, { orderBy: '-ordinal' });
  const problems = [];
  const 届次们 = 挑届次(全部);
  for (const [序号, 届] of 届次们.entries()) {
    const 详情 = { 届次: 届.edition_name || 届.id, 届次序号: 序号 + 1, 届次总数: 届次们.length };
    const 报告进度 = (阶段, 补充) => ctx.报告进度?.(阶段, { ...详情, ...补充 });
    problems.push(...await 审一届(比赛, 届, { ...ctx, 报告进度 }));
  }
  return { problems };
}
