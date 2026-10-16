// 官方来源的核对（2026-10-12 起，通知追溯的固定步骤和 Kimi 代理共用）。
//
// verifyOfficialSource：把网页正文交给 DeepSeek-Flash（不思考）判断是不是这场比赛的官方来源，摘出主办、参赛对象、届次、报名时间，每项带原文。
// checkVerification：代码核对，不信模型的结论——引用必须在网页原文里（去掉空格标点后至少 8 字），主办方必须核到，
// 参赛对象和报名截止至少核到一项，届次要是当届，网页不能是转载、自媒体或屏蔽名单里的网站。
import { isBlockedHost } from './site-blocklist.mjs';

const PAGE_CHARS = 8000;
const MIN_QUOTE = 8;

// 去掉空格、标点、引号，用来比对原文
export const flat = text => String(text || '').normalize('NFKC').replace(/[\s"“”'‘’「」『』《》〈〉()（）【】\[\]·•・,，.。:：;；!！?？、\-—_|｜/\\]/g, '');
// 转载、自媒体、问答、论坛：不当官方来源
export const REPOST_HOSTS = ['weibo.com', 'weibo.cn', 'sina.cn', 'sina.com.cn', 'toutiao.com', '163.com', 'qq.com', 'csdn.net', 'douyin.com', 'bilibili.com', 'xiaohongshu.com', 'jianshu.com', 'zhihu.com', 'sohu.com', 'mp.weixin.qq.com', 'baijiahao.baidu.com'];
// ---- 一次核对 ----
const FIELDS = ['publisher', 'organizer', 'participants', 'edition', 'registration_start', 'registration_end', 'registration_url'];
function verifyPrompt(name, noticeTitle, pages) {
  return [
    `要核对的比赛：${name}`,
    `（这场比赛是从这条通知认出来的：${String(noticeTitle || '').slice(0, 120)}）`,
    '下面是找到的网页正文。请判断其中有没有这场比赛自己的官方来源：主办方、组委会、主管部门（教育部门、学会、协会）或承办单位发布的当届正式通知、章程、官网。',
    'verdict 取值：official=是这场比赛的官方来源；repost=学校、学院转发或组织报名的通知、新闻、自媒体转载；other_contest=说的是别的比赛；old_edition=只有往届信息；not_competition=不是比赛；unclear=看不出。',
    'page 填官方来源是第几个网页（从 0 开始）。各字段都要从那个网页原样复制一句原文放进 quote，复制不出来就 value 和 quote 都留空，不要推断、不要编造。日期用 YYYY-MM-DD。',
    '只输出 JSON：{"verdict":"","page":0,"publisher":{"value":"","quote":""},"organizer":{"value":"","quote":""},"participants":{"value":"","quote":""},'
      + '"edition":{"value":"","quote":""},"registration_start":{"value":"","quote":""},"registration_end":{"value":"","quote":""},"registration_url":{"value":"","quote":""}}',
    '',
    ...pages.map((page, i) => `【网页 ${i}】${page.finalUrl || page.url}\n${String(page.text || '').slice(0, PAGE_CHARS)}`),
  ].join('\n');
}

export async function verifyOfficialSource(name, noticeTitle, pages, { key, fetchImpl = globalThis.fetch, model = 'deepseek-flash' } = {}) {
  if (!key) throw new Error('deepseek_key_missing');
  const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
    method:'POST', headers:{ authorization:`Bearer ${key}`, 'content-type':'application/json' },
    body:JSON.stringify({ model, max_tokens:3000, thinking:{ type:'disabled' }, response_format:{ type:'json_object' },
      messages:[{ role:'system', content:'你是严谨的竞赛信息核对员，只依据给出的网页原文判断，原文没有的不写。只输出 JSON。' }, { role:'user', content:verifyPrompt(name, noticeTitle, pages) }] }),
    signal:AbortSignal.timeout(120000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`http_${response.status} ${JSON.stringify(data).slice(0, 160)}`);
  const content = String(data.choices?.[0]?.message?.content || '');
  return { result:JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)), tokens:Number(data.usage?.total_tokens) || 0 };
}

// 代码核对：引用要在原文里（去掉空格标点后至少 8 字），不信模型自己的结论
export function quoteFound(quote, text) {
  const q = flat(quote);
  return q.length >= MIN_QUOTE && flat(text).includes(q);
}
export function checkVerification(result, pages, { year, noticeKind = 'unclear', blocked = [] } = {}) {
  const verdict = String(result?.verdict || 'unclear');
  if (verdict === 'not_competition') return noticeKind === 'not_competition'
    ? { decision:'not_competition', reason:'认比赛和核对两次都判为不是比赛' } : { decision:'unresolved', reason:'核对判为不是比赛，但认比赛时没这样判，交给代理' };
  const index = Number(result?.page);
  const page = Number.isInteger(index) ? pages[index] : null;
  if (verdict !== 'official' || !page) return { decision:'unresolved', reason:`核对结论：${{ repost:'只是转发或转载', other_contest:'说的是别的比赛', old_edition:'只有往届', unclear:'看不出' }[verdict] || verdict}` };
  if (isBlockedHost(page.finalUrl || page.url, [...blocked, ...REPOST_HOSTS])) return { decision:'unresolved', reason:'网页是转载或自媒体网站' };
  const fields = {};
  const dropped = [];
  for (const field of FIELDS) {
    const item = result[field];
    if (!item?.value) continue;
    if (quoteFound(item.quote, page.text)) fields[field] = { value:String(item.value).slice(0, 300), quote:String(item.quote).slice(0, 300) };
    else dropped.push(field);
  }
  if (!fields.organizer) return { decision:'unresolved', reason:`主办方没在原文里核到${dropped.length ? `（原文对不上：${dropped.join('、')}）` : ''}`, fields, dropped };
  if (!fields.participants && !fields.registration_end) return { decision:'unresolved', reason:'参赛对象和报名截止都没核到', fields, dropped };
  const years = `${fields.edition?.value || ''}`.match(/20\d{2}/g)?.map(Number) || [];
  const current = years.length ? Math.max(...years) >= year - 1 : new RegExp(`${year}|${year + 1}`).test(page.text);
  if (!current) return { decision:'unresolved', reason:`届次是 ${years.join('、') || '往年'}，不是当届`, fields, dropped };
  return { decision:'found', page, fields, dropped, reason:'官方来源，主办方和参赛对象或报名截止已在原文核到' };
}

