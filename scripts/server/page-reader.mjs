// 读一个网页的正文（2026-10-12 起共用：读详情补读正式通知、通知追溯的固定步骤、追溯代理的读网页工具）。
//
// 1. 先用我们自己的抓取器（遵守 robots.txt，直接取不到时走上海中转）：
//    网页 → 去掉导航取正文；PDF / Word → 读出文字（不少赛事的正式通知是附件）。
// 2. 网页正文不到 300 字（前后端分离的官网，只抓到导航骨架）→ 用 Kimi 读网页接口重读（服务端执行脚本）。
// 3. robots 不允许的不改用 Kimi，照规矩不读。
// 同时取出页面里像“通知、附件、章程、PDF”的链接（最多 10 个），给追溯时决定下一步读哪页。
import { kimiFetchPage } from './search-engines.mjs';

const MIN_DIRECT_CHARS = 300;
const MIN_RENDERED_CHARS = 200;

// 测试里注入；服务器上 crawler/ 在脚本旁边，仓库里在 scripts/crawler/
async function crawlerLibs() {
  const load = name => import(`./crawler/lib/${name}.mjs`).catch(() => import(`../crawler/lib/${name}.mjs`));
  const [{ Fetcher }, extract] = await Promise.all([load('fetcher'), load('extract')]);
  return { Fetcher, extract };
}

export function createPageReader({ fetcher, extract, kimiFetch = kimiFetchPage, maxChars = 12000 } = {}) {
  return async function readPageText(url) {
    const page = await fetcher.get(url);
    if (page.status === 'blocked_by_robots') return { status:'blocked', url, text:'', via:'direct', links:[] };
    if (page.status === 'ok' && page.body?.length && !/html/i.test(page.contentType || '')) {
      const head = page.body.subarray(0, 4).toString('latin1');
      const parsed = head.startsWith('%PDF') ? await extract.extractPdfText(page.body, { maxChars })
        : head.startsWith('PK') ? extract.extractDocxText(page.body, { maxChars }) : { text:'' };
      if (parsed.text) return { status:'ok', url, finalUrl:page.finalUrl || url, text:parsed.text, via:'direct', format:head.startsWith('%PDF') ? 'pdf' : 'docx', links:[] };
    }
    const html = page.status === 'ok' && /html/i.test(page.contentType || '') ? page.text : '';
    const text = html ? extract.extractText(html, { maxChars }) : '';
    const links = html ? extract.findNoticeLinks(html, page.finalUrl || url, { limit:10 }).map(item => ({ text:item.text, url:item.url })) : [];
    if (text.length >= MIN_DIRECT_CHARS) return { status:'ok', url, finalUrl:page.finalUrl || url, text, via:'direct', links };
    try {
      const rendered = await kimiFetch(url);
      const body = String(rendered.markdown || '').slice(0, maxChars);
      return { status:body.length >= MIN_RENDERED_CHARS ? 'ok' : 'too_short', url, finalUrl:url, text:body, via:'kimi_fetch', links };
    } catch (error) {
      return { status:text ? 'too_short' : 'error', url, finalUrl:page.finalUrl || url, text, via:'direct', links, error:String(error?.message || error).slice(0, 160) };
    }
  };
}

let shared = null;
export async function defaultPageReader(options = {}) {
  if (!shared) {
    const { Fetcher, extract } = await crawlerLibs();
    shared = createPageReader({ fetcher:new Fetcher({ perHostDelayMs:1500 }), extract, ...options });
  }
  return shared;
}
