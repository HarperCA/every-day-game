import * as cheerio from 'cheerio';
import { normalizeCrawlUrl } from './urlPolicy.mjs';

const LINK_CRITERIA = {
  registration:'当届比赛报名、注册、参赛入口',
  rules:'当届赛事章程、竞赛规程、参赛指南、赛题或赛制',
  organizer:'主办方、承办方、组委会或组织机构说明',
  other:'导航、广告、历史新闻、结果、校赛或其他无关链接',
};

export function evidenceLinks(html, baseUrl, limit = 12) {
  const $ = cheerio.load(html || '');
  const seen = new Set();
  const links = [];
  $('a[href]').each((_, element) => {
    const label = $(element).text().replace(/\s+/g, ' ').trim().slice(0, 120);
    const raw = $(element).attr('href');
    if (!label || !raw || /^(?:#|javascript:|mailto:|tel:)/i.test(raw)) return;
    let url;
    try { url = normalizeCrawlUrl(new URL(raw, baseUrl).href); } catch { return; }
    if (!/^https?:\/\//.test(url) || seen.has(url)) return;
    if (!/报名|注册|参赛|章程|规程|指南|组织机构|主办|承办|组委会|竞赛办法|赛题|赛制/i.test(`${label} ${url}`)) return;
    seen.add(url);
    links.push({ label, url });
  });
  return links.slice(0, limit);
}

export async function rankEvidenceLinks(links, { apiKey = '', fetchImpl = globalThis.fetch, timeoutMs = 20000, contestName = '' } = {}) {
  if (!links.length) return [];
  if (!apiKey) return links.map(link => ({ ...link, kind:'unclassified', probability:0, status:'jev_unavailable' }));
  const questions = Object.fromEntries(links.map((link, index) => [
    `link_${index}`,
    { type:'choice', instructions:`判断 links[${index}] 对赛事名称所指的具体比赛的用途。只有与该比赛相关的报名、章程、指南、组织机构才归入对应类别。学会自身的组织机构、学会章程、网站导航均归为 other。`, criteria:LINK_CRITERIA },
  ]));
  try {
    const response = await fetchImpl('https://openrouter.ai/api/alpha/decisions', {
      method:'POST', headers:{ authorization:`Bearer ${apiKey}`, 'content-type':'application/json' },
      body:JSON.stringify({ model:'typesafe/jev-1.13', state:{ contestName, links }, questions }),
      signal:AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`jev_http_${response.status}`);
    const payload = await response.json();
    return links.map((link, index) => {
      const answer = payload.answers?.[`link_${index}`] || {};
      const kind = answer.choice || 'unclassified';
      return { ...link, kind, probability:Number(answer.probabilities?.[kind] || 0), status:'ranked' };
    }).sort((a, b) => b.probability - a.probability);
  } catch (error) {
    return links.map(link => ({ ...link, kind:'unclassified', probability:0, status:String(error?.message || error).slice(0, 100) }));
  }
}
