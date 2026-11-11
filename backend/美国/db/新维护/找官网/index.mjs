// 找官网（2026-11-07 用户定改法）：记忆里没有官方域名时，像人一样搜比赛名（用途 official_search，DeepSeek 搜索 API，按次计费），
// 去掉屏蔽网站后把前 10 条交给 DeepSeek 做选择题（用途 official_pick，不联网），程序打开它选的网址核实。
// 2026-11-08 试过“没找到再加搜‘比赛名 主办单位’”：同 40 个找对 12→14，用户嫌效率低，去掉了；找不到官网的由调用方转待人工审核。
//   （11-08 测评：随机 40 个已知官网的比赛，只搜名字时官网在前 10 条里的只有 20 个；前 10 里有官网时 DeepSeek 选对 14 个。）
// 只查不写：交回结果和要写回搜索记忆的改动，写比赛库由调用方决定（写回记忆）。
//
//   找官网(比赛, { ai, 读网页, 节, 目标, 屏蔽, 今天 })
//     → { 结果: '找到' | '网络问题' | '待审', 官网, 打不开: [网址], 原因, 记忆改动, 调用: { 搜索, DeepSeek, 打开 }, 用量, 过程: [{ 步骤, 说明 }] }
//     比赛：{ name, aliases, organizer }   节：搜索记忆.解析 的结果（没有给 null）
//     目标：{ 年份, 届次, 已知年份, 已知届次 }（库里最新一届的年份、届次，认官网时也算对上）
//     ai：AI 总管的会话   读网页：美国/web 的 读网页（美国读不到改由北京读的，由调用方包好传进来）   屏蔽：比赛库 屏蔽网站.当前屏蔽
//   写回记忆(db, 比赛编号, 改动, { 操作人 })
//
// 只搜一次比赛名 → DeepSeek 选 → 核实，哪一步不过就停：
//   搜不到、搜到的都是屏蔽网站、DeepSeek 没按格式回答、说都不是、序号不对、选的页面和搜索结果里都没有比赛名称 → 待审，写一条教训；
//   选的网址打不开 → 网络问题（记下网址，以后按频率重读）；找到 → 结束。别的出错照样抛出（额度用完、余额不足，交给调用方顺延）。
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

export async function 找官网(比赛, { ai, 读网页, 节 = null, 目标, 屏蔽 = [], 今天 = 北京今天() } = {}) {
  const 调用 = { 搜索: 0, DeepSeek: 0, 打开: 0 };
  const 过程 = [];
  const 记 = (步骤, 说明) => 过程.push({ 步骤, 说明 });
  const 用量 = { tokensIn: 0, tokensOut: 0 };
  let 有用量 = false;
  const 屏蔽的 = 屏蔽.map(去www);

  async function 一轮(搜索词) {
    调用.搜索 += 1;
    const 搜 = await ai.search({ purpose: 'official_search', query: 搜索词 });
    const 全部 = 搜.references || [];
    const 见过 = new Set();
    const 候选 = 全部.filter(r => {
      const 域名 = 域名之(r.url);
      if (!域名 || 见过.has(r.url) || 屏蔽的.some(站 => 域名 === 站 || 域名.endsWith(`.${站}`))) return false;
      见过.add(r.url);
      return true;
    }).slice(0, 交给选的条数);
    记('搜索', `「${搜索词}」：${全部.length} 条，去掉屏蔽和重复后交 ${候选.length} 条：${候选.map(r => 域名之(r.url)).join('、')}`);
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
    return { 官网: { 域名, 首页: `${new URL(页?.finalUrl || 网址).origin}/`, 网址, 标题, 理由, 第几条: 选, 权威: 中.authority ?? null, 搜索词,
      有新一届: 判.有新一届, 年份对上: 判.年份对上, 主办单位对上: 判.主办单位对上 } };
  }

  const 收 = 回 => ({ ...回, 调用, 用量: 有用量 ? 用量 : null, 过程 });
  const 处理 = (回, 搜索词) => {
    if (回.官网) return 收({ 结果: '找到', 官网: 回.官网, 打不开: [], 原因: '', 记忆改动: 成功改动(节, { 域名: 回.官网.域名, 搜索词们: [搜索词], 搜索: 'DeepSeek 搜索', 标题: 回.官网.标题 }, 目标) });
    if (回.打不开) return 收({ 结果: '网络问题', 官网: null, 打不开: [回.打不开.网址], 原因: `官网打不开：${回.打不开.原因}`, 记忆改动: 教训改动(节, `${今天} 官网 ${回.打不开.域名} 打不开，按频率再读`) });
    return null;
  };

  const 搜索词 = 净(比赛.name).slice(0, 128);
  const 回 = await 一轮(搜索词);
  const 有结果 = 处理(回, 搜索词);
  if (有结果) return 有结果;
  const 原因 = 回.没找到;
  记('结果', `待审：${原因}`);
  return 收({ 结果: '待审', 官网: null, 打不开: [], 原因, 记忆改动: 教训改动(节, `${今天} 搜比赛名没找到官网：${原因}`) });
}
