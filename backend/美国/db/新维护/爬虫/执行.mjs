// 爬虫执行（2026-11-08 用户定）：按比赛库里的爬虫脚本取通知列表。脚本是一串步骤（格式见 db/操作/爬虫脚本.mjs），这里只照着做，不运行 AI 写的代码。
//
//   执行脚本({ 列表页, 步骤, 要浏览器 }, { 取源码, 浏览器, etag, 最后修改, signal })
//     → { 状态: '成功' | '没更新' | '失败', 条目们: [{ 标题, 链接, 日期 }], 最终网址, etag, 最后修改, 错误, 失败类 }
//     不要浏览器：用 取源码（美国/web）打开；只有一次打开时带上次的 etag、最后修改问有没有更新，网站说没更新就交回“没更新”。
//                 点击要浏览器，碰到就失败。
//     要浏览器：用 浏览器（美国/web 的 建浏览器）开一个页面，照步骤打开、点击、等待，取列表时读当前页面源码；用完关掉页面。
//     第一步不是打开时，先打开列表页。取不到条目、选择器写错、打开失败都算失败，写明哪一步、什么原因。
//     浏览器起不来（新页面抛错）、没给浏览器都不抛出，交回失败，错误以“浏览器打不开：”开头。
//     失败类（2026-11-08，维护一个按它决定要不要重写脚本；成功、没更新时为 null）：
//       '网络'：打不开、超时、HTTP 错误、robots 不允许、浏览器打不开或中途关掉、页面跳到不安全的地址——重写脚本也没用；
//       '取不到'：取不到条目、选择器出错、点击/等待找不到元素、步骤不对、脚本里的网址不安全、列表页不是网页——要重写脚本。
//   取条目(html, 基准网址, { 条目, 标题, 链接, 日期 }) → [{ 标题, 链接, 日期 }]
//     标题、链接、日期是相对条目的选择器；不给链接就用条目本身（是链接时）或条目里第一个链接；不给标题用链接的 title 或文字。
//     没标题或没链接的不要；同一链接只留一条；最多 100 条。选择器写错抛错。
import { createRequire } from 'node:module';

const cheerio = createRequire(new URL('../../../../Environment/package.json', import.meta.url))('cheerio');
const 最多条目 = 100;
const 净 = s => String(s ?? '').replace(/\s+/g, ' ').trim();

export function 取条目(html, 基准网址, { 条目, 标题 = '', 链接 = '', 日期 = '' }) {
  const $ = cheerio.load(html || '');
  const 见过 = new Set();
  const 结果 = [];
  for (const el of $(条目).toArray()) {
    const 块 = $(el);
    const a = 链接 ? 块.find(链接).first() : (块.is('a') ? 块 : 块.find('a').first());
    const 题 = 净(标题 ? 块.find(标题).first().text() : (a.attr('title') || a.text() || 块.text()));
    let 址 = '';
    try { 址 = a.attr('href') ? new URL(a.attr('href'), 基准网址).href : ''; } catch { 址 = ''; }
    if (!题 || !/^https?:/i.test(址) || 见过.has(址)) continue;
    见过.add(址);
    结果.push({ 标题: 题.slice(0, 200), 链接: 址, 日期: 净(日期 ? 块.find(日期).first().text() : '').slice(0, 40) });
    if (结果.length >= 最多条目) break;
  }
  return 结果;
}

const 失败 = (错误, 失败类) => ({ 状态: '失败', 条目们: [], 最终网址: null, etag: null, 最后修改: null, 错误, 失败类 });
const 错误文字 = error => String(error?.message || error).split('\n')[0].slice(0, 120);
// 取源码打开失败时：这两种是脚本的问题（网址写成了内网地址、列表页换成了文件），重写脚本才有用；其余算网络
const 脚本问题的状态 = new Set(['网址不安全', '不支持的类型']);
// 浏览器里出错时，浏览器或页面被关掉（崩溃、被安全检查拦下）算网络
const 浏览器没了 = /Target page, context or browser has been closed|browser has been closed|Browser closed|页面请求了不安全的地址/i;

// 打开出错算网络（打开前就查出网址不安全的除外）；点击、等待、取列表出错算取不到
function 浏览器失败类(动作, error) {
  const 文字 = String(error?.message || error);
  if (浏览器没了.test(文字)) return '网络';
  if (动作 === '打开') return 文字.startsWith('网址不安全') ? '取不到' : '网络';
  return '取不到';
}

function 取列表(html, 基准网址, 步, 第) {
  let 条目们;
  try { 条目们 = 取条目(html, 基准网址, 步); } catch (error) { return 失败(`第 ${第} 步取列表：选择器出错 ${String(error?.message || error).slice(0, 100)}`, '取不到'); }
  if (!条目们.length) return 失败(`取不到条目（${步.条目}）`, '取不到');
  return { 状态: '成功', 条目们, 最终网址: 基准网址, etag: null, 最后修改: null, 错误: '', 失败类: null };
}

async function 不用浏览器(脚本, { 取源码, etag, 最后修改, signal }) {
  const 步骤 = 脚本.步骤[0]?.动作 === '打开' ? 脚本.步骤 : [{ 动作: '打开', 网址: 脚本.列表页, 补的: true }, ...脚本.步骤];
  const 只打开一次 = 步骤.filter(步 => 步.动作 === '打开').length === 1;
  let 当前 = null;
  for (const [i, 步] of 步骤.entries()) {
    const 第 = 步骤[0].补的 ? i : i + 1;
    if (步.动作 === '点击') return 失败(`第 ${第} 步点击要浏览器`, '取不到');
    if (步.动作 === '等待') continue;
    if (步.动作 === '打开') {
      const 页 = await 取源码(步.网址, { signal, ...(只打开一次 ? { etag, 最后修改 } : {}) });
      if (页.status === '没更新') return { 状态: '没更新', 条目们: [], 最终网址: 页.finalUrl || 步.网址, etag: 页.etag ?? etag ?? null, 最后修改: 页.最后修改 ?? 最后修改 ?? null, 错误: '', 失败类: null };
      if (页.status !== '成功') return 失败(`打开 ${步.网址}：${页.status}${页.error ? ` ${页.error}` : ''}`, 脚本问题的状态.has(页.status) ? '取不到' : '网络');
      当前 = 页;
      continue;
    }
    const 回 = 取列表(当前.html, 当前.finalUrl || 步.网址, 步, 第);
    return 回.状态 === '成功' ? { ...回, etag: 当前.etag ?? null, 最后修改: 当前.最后修改 ?? null } : 回;
  }
  return 失败('脚本没有取列表', '取不到');
}

async function 用浏览器(脚本, { 浏览器 }) {
  let 页, 关;
  try { ({ 页, 关 } = await 浏览器.新页面()); } catch (error) { return 失败(`浏览器打不开：${错误文字(error)}`, '网络'); }
  try {
    if (脚本.步骤[0]?.动作 !== '打开') {
      try { await 页.打开(脚本.列表页); } catch (error) { return 失败(`打开 ${脚本.列表页}：${错误文字(error)}`, 浏览器失败类('打开', error)); }
    }
    for (const [i, 步] of 脚本.步骤.entries()) {
      const 第 = i + 1;
      try {
        if (步.动作 === '打开') await 页.打开(步.网址);
        else if (步.动作 === '点击') await 页.点击(步.选择器);
        else if (步.动作 === '等待') await 页.等待(步.选择器 ? { 选择器: 步.选择器 } : { 毫秒: 步.毫秒 });
        else return 取列表(await 页.源码(), 页.网址(), 步, 第);
      } catch (error) {
        return 失败(`第 ${第} 步${步.动作}：${错误文字(error)}`, 浏览器失败类(步.动作, error));
      }
    }
    return 失败('脚本没有取列表', '取不到');
  } finally {
    await 关();
  }
}

export async function 执行脚本(脚本, 选项 = {}) {
  if (脚本.要浏览器) {
    if (!选项.浏览器) return 失败('浏览器打不开：脚本要浏览器，但没有给浏览器', '网络');
    return 用浏览器(脚本, 选项);
  }
  return 不用浏览器(脚本, 选项);
}
