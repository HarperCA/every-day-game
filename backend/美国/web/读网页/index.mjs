// 读网页：抓网页唯一的总函数，统一管整个流程。谁要读网页都调它（03 追溯、04 读详情、05 核验、维护的检查）；
// 读出来以后怎么用（补读附件、截短、取片段、比对公告栏）由各模块自己的函数处理，不放在这里。
//
//   读网页(网址, 选项) → 统一结果（结果.mjs）：{ url, finalUrl, status, httpStatus, contentType, title, text, links, error, ms, fetchedAt }
//
// 流程（每一步出问题都交回对应的状态和原因，不抛错）：
//   规范化网址（网址.mjs）→ 安全检查（安全.mjs）→ robots（../下载/robots.mjs）→ 同一网站限速（限速.mjs）
//   → 下载（../下载/，每次跳转前再查安全和 robots）→ 按文件内容判断类型
//   → 网页：编码（../编码/）→ 标题、正文、链接（../正文/）；PDF：../pdf/；Word：../word/
//   → 正文太短（默认不到 300 字，多半是脚本加载的空壳页）
// 只用自己的程序读，不交给 Kimi（2026-11-01 用户定：先做最简单的，按记下的状态看空壳和读不通的多不多再说）。
//
// 选项：signal（停止信号）、最少字数；超时、最大字节、最多跳转 不给就用下载的默认（北京代读用 15 秒、3MB、5 次，2026-11-09）；
//       fetchImpl、限速、安全检查、robots 只给测试换假的
import { 下载 } from '../下载/index.mjs';
import { robots允许, 建robots检查 } from '../下载/robots.mjs';
import { 转文字 } from '../编码/index.mjs';
import { 取网页 } from '../正文/index.mjs';
import { PDF文字 } from '../pdf/index.mjs';
import { Word文字 } from '../word/index.mjs';
import { checkUrlSafety } from './安全.mjs';
import { makeResult, MIN_TEXT_CHARS } from './结果.mjs';
import { hostOf, normalizeUrl } from './网址.mjs';
import { 默认限速 } from './限速.mjs';

// 按响应头和文件开头几个字节判断类型：有的网站把 PDF 标成 text/html，所以要看内容本身
export function 内容类型(contentType = '', body = Buffer.alloc(0), url = '') {
  const head = body.subarray(0, 5).toString('latin1');
  if (head.startsWith('%PDF')) return 'pdf';
  if (head.startsWith('PK') && (/wordprocessingml|msword/.test(contentType) || /\.docx(\?|$)/i.test(url))) return 'docx';
  if (/html|xml|text\/plain/.test(contentType) || /^\s*</.test(body.subarray(0, 200).toString('latin1'))) return 'html';
  return 'unsupported';
}

// 只把给了的上限传给下载，没给的用下载自己的默认（取源码也用）
export const 下载上限 = ({ 超时, 最大字节, 最多跳转 }) => Object.fromEntries(Object.entries({ 超时, 最大字节, 最多跳转 }).filter(([, v]) => v != null));

export async function 读网页(网址, { signal, 最少字数 = MIN_TEXT_CHARS, fetchImpl, 限速 = 默认限速, 安全检查 = checkUrlSafety, robots, 超时, 最大字节, 最多跳转 } = {}) {
  const 开始 = Date.now();
  const 交回 = fields => makeResult({ ...fields, ms: Date.now() - 开始 });
  const 查robots = robots || (fetchImpl ? 建robots检查({ fetchImpl }) : robots允许);
  let url = 网址;
  try {
    try { url = normalizeUrl(网址); } catch { return 交回({ url: 网址, status: '网址不安全', error: '网址格式不对，或不是 http/https' }); }
    const 不安全 = await 安全检查(url);
    if (不安全) return 交回({ url, status: '网址不安全', error: 不安全 });
    if (!(await 查robots(url))) return 交回({ url, status: 'robots不允许', error: '网站的 robots.txt 不允许抓取' });

    await 限速.等候(hostOf(url));
    let page;
    try {
      page = await 下载(url, { signal, ...下载上限({ 超时, 最大字节, 最多跳转 }), ...(fetchImpl ? { fetchImpl } : {}),
        跳转前检查: async next => (await 安全检查(next)) || ((await 查robots(next)) ? null : 'robots.txt 不允许抓取') });
    } catch (error) {
      if (error?.kind) return 交回({ url, status: error.kind, error: error.message, httpStatus: error.httpStatus });
      throw error;
    }

    const base = { url, finalUrl: page.finalUrl, httpStatus: page.httpStatus, contentType: page.contentType };
    const 类型 = 内容类型(page.contentType, page.body, page.finalUrl);
    let title = '';
    let text = '';
    let links = [];
    if (类型 === 'html') {
      ({ 标题: title, 正文: text, 链接们: links } = 取网页(转文字(page.body, page.contentType), page.finalUrl));
    } else if (类型 === 'pdf' || 类型 === 'docx') {
      try {
        text = 类型 === 'pdf' ? await PDF文字(page.body) : Word文字(page.body);
      } catch (error) {
        return 交回({ ...base, status: '读不出文字', error: `${类型 === 'pdf' ? 'PDF' : 'Word'} 读不出文字：${String(error?.message || error).slice(0, 160)}` });
      }
    } else {
      return 交回({ ...base, status: '不支持的类型', error: `不读这种内容：${page.contentType || '未知类型'}` });
    }

    if (text.replace(/\s+/g, '').length < 最少字数) {
      return 交回({ ...base, status: '正文太短', title, text, links, error: `正文不到 ${最少字数} 字，可能是脚本加载的空壳页` });
    }
    return 交回({ ...base, status: '成功', title, text, links });
  } catch (error) {
    return 交回({ url, status: '内部错误', error: String(error?.message || error) });
  }
}
