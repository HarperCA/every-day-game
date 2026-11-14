// 找官网（2026-11-07 用户定改法）：记忆里没有官方域名时，像人一样搜比赛名（用途 official_search，DeepSeek 搜索 API，按次计费），
// 去掉屏蔽网站后把前 10 条交给 DeepSeek 做选择题（用途 official_pick，不联网），程序打开它选的网址核实。
// 2026-11-08 试过“没找到再加搜‘比赛名 主办单位’”：同 40 个找对 12→14，用户嫌效率低，去掉了；找不到官网的由调用方转待人工审核。
//   （11-08 测评：随机 40 个已知官网的比赛，只搜名字时官网在前 10 条里的只有 20 个；前 10 里有官网时 DeepSeek 选对 14 个。）
// 只查不写：交回结果和要写回搜索记忆的改动，写比赛库由调用方决定（写回记忆）。
//
//   找官网(比赛, { ai, 读网页, 节, 目标, 屏蔽, 今天 })
//     → { 结果: '找到' | '网络问题' | '待审' | '搜索出错', 官网, 打不开: [网址], 原因, 记忆改动, 调用: { 搜索, DeepSeek, 打开 }, 用量, 过程: [{ 步骤, 说明 }] }
//     搜索出错：DeepSeek 搜索接口出错（不是没结果）、Tavily 也没找到——接口没完成检索，不能据此转待人工审核，调用方收尾成失败下次再试；不记教训
//     比赛：{ name, aliases, organizer }   节：搜索记忆.解析 的结果（没有给 null）
//     目标：{ 年份, 届次, 已知年份, 已知届次 }（库里最新一届的年份、届次，认官网时也算对上）
//     ai：AI 总管的会话   读网页：美国/web 的 读网页（美国读不到改由北京读的，由调用方包好传进来）   屏蔽：比赛库 屏蔽网站.当前屏蔽
//   写回记忆(db, 比赛编号, 改动, { 操作人 })
//
// DeepSeek 搜索没得到可用官网时，Tavily 用同一个比赛名补搜一轮，仍由 DeepSeek 选、程序核实（只当后备：11-13 服务器重跑 23 个，Tavily 补搜后 17 个仍没找到）。
// 2026-11-13 用户定：
//   Tavily 失败（暂停、额度用完、缺密钥、接口出错，凡是带 provider 的 AI 错误）当成“后备搜索没结果”，记进过程，按 DeepSeek 那一轮的结果收尾；
//     tavily 自己的错不往外抛、不停批（以前抛出去，服务器没配密钥时 tavily 被暂停，45 个比赛里 23 个记成“出错”）。
//   DeepSeek 搜索的额度类错误（额度用完、密钥错误、搜索超限，和文字看得出的余额不足 402）照旧往外抛，让调用方停批，不再补搜。
//   DeepSeek 搜索别的接口错误（限流、对方出错、超时……）照旧补搜 Tavily；Tavily 也没找到时结果是“搜索出错”，不是“待审”。
//   会话自身的预算、配置错误（没有 provider）照旧往外抛。
import { 选择题, 提问版本 } from './问题.mjs';
import { 核实页面 } from './核实.mjs';
import { 成功改动, 教训改动 } from './记忆.mjs';

export { 写回记忆 } from './记忆.mjs';

const 交给选的条数 = 10;
const 北京今天 = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const 去www = 域名 => String(域名 || '').toLowerCase().replace(/^www\./, '');
const 域名之 = 网址 => { try { return 去www(new URL(网址).hostname); } catch { return ''; } };
const 打不开的 = new Set(['超时', '网络错误', 'HTTP错误']);
const 净 = s => String(s || '').replace(/\s+/g, ' ').trim();
// DeepSeek 搜索的额度类错误：往外抛让调用方停批（和 维护一个.mjs 的 停批错误 认法一样；余额不足 402 归成“请求有误”，按文字认）
const 停批种类 = new Set(['额度用完', '密钥错误', '搜索超限']);
const 额度类 = 错误 => 停批种类.has(错误?.kind) || /余额不足|insufficient balance|返回 402/i.test(String(错误?.message || ''));

export async function 找官网(比赛, { ai, 读网页, 节 = null, 目标, 屏蔽 = [], 今天 = 北京今天(), 核准官网 } = {}) {
  const 调用 = { 搜索: 0, DeepSeek: 0, 打开: 0 };
  const 过程 = [];
  const 记 = (步骤, 说明) => 过程.push({ 步骤, 说明 });
  const 用量 = { tokensIn: 0, tokensOut: 0 };
  let 有用量 = false;
  const 屏蔽的 = 屏蔽.map(去www);

  const 搜索词 = 净(比赛.name).slice(0, 128);

  async function 一轮(purpose, 搜索来源) {
    调用.搜索 += 1;
    let 搜;
    try {
      搜 = await ai.search({ purpose, query: 搜索词 });
    } catch (错误) {
      // 会话自身的预算或配置错误应直接交给调用方。
      if (!错误?.provider) throw 错误;
      // 后备搜索（Tavily）失败：当没结果，不抛、不停批
      if (purpose === 'official_tavily') {
        记('搜索', `${搜索来源}失败：${错误.message || 错误.kind}，当后备搜索没结果`);
        return { 没找到: `后备搜索失败（${错误.message || 错误.kind}），当没结果` };
      }
      // DeepSeek 搜索额度类错误：往外抛停批
      if (额度类(错误)) throw 错误;
      记('搜索', `${搜索来源}失败：${错误.kind || 错误.message}`);
      return { 搜索错误: 错误 };
    }
    const 全部 = 搜.references || [];
    const 见过 = new Set();
    const 候选 = 全部.filter(r => {
      const 域名 = 域名之(r.url);
      if (!域名 || 见过.has(r.url) || 屏蔽的.some(站 => 域名 === 站 || 域名.endsWith(`.${站}`))) return false;
      见过.add(r.url);
      return true;
    }).slice(0, 交给选的条数);
    记('搜索', `${搜索来源}「${搜索词}」：${全部.length} 条，去掉屏蔽和重复后交 ${候选.length} 条：${候选.map(r => 域名之(r.url)).join('、')}`);
    if (!全部.length) return { 没找到: '搜比赛名没有结果' };
    if (!候选.length) return { 没找到: `搜到的 ${全部.length} 条都是屏蔽名单里的网站` };

    调用.DeepSeek += 1;
    let 回;
    try {
      回 = await ai.chat({ purpose: 'official_pick', messages: [{ role: 'user', content: 选择题(比赛, 目标, 候选, 节) }], json: true, promptVersion: 提问版本 });
    } catch (错误) {
      if (错误?.kind !== '格式不对') throw 错误;
      记('DeepSeek', 错误.message);
      return { 没找到: 'DeepSeek 没按格式回答' };
    }
    if (回.usage) { 有用量 = true; 用量.tokensIn += 回.usage.tokensIn || 0; 用量.tokensOut += 回.usage.tokensOut || 0; }
    const 选 = Number(回.data?.选);
    const 理由 = String(回.data?.理由 || '').trim();
    记('DeepSeek', `选 ${回.data?.选 ?? '空'}${理由 ? `（${理由}）` : ''}`);
    if (选 === 0) return { 没找到: `DeepSeek 认为前 ${候选.length} 条里没有官网${理由 ? `：${理由}` : ''}` };
    if (!Number.isInteger(选) || 选 < 1 || 选 > 候选.length) return { 没找到: `DeepSeek 选的序号不对：${回.data?.选 ?? '空'}` };
    const 中 = 候选[选 - 1];
    const 网址 = 中.url;
    const 域名 = 域名之(网址);

    // 打开核实：页面文字加上搜索结果的标题、摘要
    调用.打开 += 1;
    const 页 = await 读网页(网址);
    if (打不开的.has(页?.status)) {
      记('核实', `${网址}：打不开（${页.error || 页.status}）`);
      return { 打不开: { 网址, 域名, 原因: 页.error || 页.status } };
    }
    const 合起来 = { status: '成功', title: 页?.title || '', text: [页?.text, 中.title, 中.content].filter(Boolean).join('\n') };
    const 判 = 核实页面(合起来, 比赛, 目标);
    记('核实', `${网址}（${页?.status}）：${判.结果}${判.缺.length ? `（缺 ${判.缺.join('、')}）` : ''}`);
    if (判.结果 !== '合格') return { 没找到: `选的页面上没有比赛名称：${域名}` };
    const 标题 = 页?.title || 中.title || '';
    const 官网 = { 域名, 首页: `${new URL(页?.finalUrl || 网址).origin}/`, 网址, 标题, 理由, 第几条: 选, 权威: 中.authority ?? null, 搜索词, 搜索来源,
      有新一届: 判.有新一届, 年份对上: 判.年份对上, 主办单位对上: 判.主办单位对上 };
    if (!核准官网) return { 官网 };
    const 核准 = await 核准官网(官网);
    if (核准.起点) return { 官网: { ...官网, 起点: 核准.起点 } };
    return { 没找到: 核准.原因, 打不开: 核准.打不开 };
  }

  const 收 = 回 => ({ ...回, 调用, 用量: 有用量 ? 用量 : null, 过程 });
  const 找到 = 官网 => 收({ 结果: '找到', 官网, 打不开: [], 原因: '', 记忆改动: 成功改动(节, {
    域名: 官网.域名, 搜索词们: [搜索词], 搜索: 官网.搜索来源, 标题: 官网.标题,
  }, 目标) });
  const 主 = await 一轮('official_search', 'DeepSeek 搜索');
  if (主.官网) return 找到(主.官网);
  const 备用 = await 一轮('official_tavily', 'Tavily 搜索');
  if (备用.官网) return 找到(备用.官网);

  const 打不开 = [主.打不开, 备用.打不开].filter(Boolean);
  if (打不开.length) {
    return 收({ 结果: '网络问题', 官网: null, 打不开: [...new Set(打不开.map(项 => 项.网址))],
      原因: `官网打不开：${打不开.map(项 => 项.原因).join('；')}`,
      记忆改动: 教训改动(节, `${今天} 官网 ${[...new Set(打不开.map(项 => 项.域名))].join('、')} 打不开，按频率再读`) });
  }
  // 接口没完成检索，不能据此把赛事转待人工审核：DeepSeek 搜索接口出错、Tavily 也没找到 → 搜索出错（调用方收尾成失败，下次再试），不记教训
  if (主.搜索错误) {
    const 原因 = `DeepSeek 搜索接口出错：${主.搜索错误.message || 主.搜索错误.kind}；Tavily 搜索：${备用.没找到}`;
    记('结果', `搜索出错：${原因}`);
    return 收({ 结果: '搜索出错', 官网: null, 打不开: [], 原因, 记忆改动: {} });
  }
  const 原因 = [主.没找到, `Tavily 搜索：${备用.没找到}`].filter(Boolean).join('；');
  记('结果', `待审：${原因}`);
  return 收({ 结果: '待审', 官网: null, 打不开: [], 原因, 记忆改动: 教训改动(节, `${今天} 搜比赛名没找到官网：${原因}`) });
}
