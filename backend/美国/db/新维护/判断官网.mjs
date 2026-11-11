// 判断官网（2026-11-08 用户定）：维护一个比赛前，先判断拿到的起点网址是不是这个比赛的官网，是才往下维护。
// 起点按顺序来自比赛官网字段、搜索记忆里的域名、来源表里的官方来源，都不是就用 DeepSeek 找官网（找到的也要过这个判断）；
// 判断全部由程序做，不调 AI。规则照一次性脚本“补官网”实测调过的（跳过规则、宽松比名字、空壳页换无头浏览器），改成可测试的函数。
//
//   网址判断(网址, { 屏蔽, 库里最新年份 }) → { 可以, 原因 }
//     只看网址、不用打开就能否掉的：附件下载链接、政府网站、云存储/CDN、公众号、屏蔽名单、学校主站/部门网站、
//     往年旧页面（网址里的年份最新的那个比库里最新一届还早）、单篇通知（带日期或编号的单篇文章）
//   宽松有名(名称, 标题) → 对上的片段 | ''
//     去掉引号里的“××杯”、括号、通用词后，最长公共片段整段至少 6 个字、去掉通用词后至少 4 个字；纯英文片段至少 8 个字母。
//     只和网页标题比，不和正文比（学校主页正文里常有某比赛的新闻，会误认）
//   判断官网(网址, 比赛, { 读网页, 浏览器, 屏蔽, 库里最新年份 }) → { 是, 原因, 最终网址, 对上, 标题 }
//     网址判断 → 读网页打开（空壳页且有浏览器就用无头浏览器再开一次）→ 跳转后的网址再判断 → 旧页面（标题+正文开头 300 字的年份）
//     → 标题或正文里有比赛全名（名称写法任一），或标题宽松对上
//   来源候选(来源们, { 屏蔽, 域名比赛数 }) → { 候选: [{ 网址, 依据 }], 跳过: [原因] }
//     从这个比赛各届次的官方有效来源推起点候选：非平台取网站首页，平台（一个域名下挂 3 个以上不同比赛）留那一页本身
//   算域名比赛数(db) → Map<主机名（去掉 www）, 不同比赛数>
import { 屏蔽网站 } from '../index.mjs';
import { 名称写法, 规范名 } from './找官网/核实.mjs';

// 学校部门网站：.edu.cn 主机名第一段是这些的（教务处、新闻网、团委、创新创业学院、招生、研究生院、科技处……）
export const 学校部门前缀 = ['www', 'jwc', 'jw', 'jwb', 'jwch', 'news', 'xxgk', 'tuanwei', 'tw', 'cxcy', 'cxcyxy', 'cxxy', 'xsc', 'xgc', 'zs', 'yjs', 'yjsy', 'kjc', 'kyc', 'xwzx', 'lib', 'cs', 'cxzx', 'sxy', 'career', 'job'];
// 平台：同一个域名下挂着这么多个不同比赛的官方来源
const 平台门槛 = 3;
// 空壳页：看得到的字不到这么多，有浏览器就换无头浏览器再开一次
const 空壳字数 = 200;
// 旧页面只看正文开头这么多字（再往后常是往届回顾、页脚）
const 正文开头 = 300;

const 有内容的 = new Set(['成功', '正文太短']);
const 类型序 = { official_website: 0, organizer_website: 0, organizer_notice: 1 };

function 解析(网址) {
  try {
    const u = new URL(String(网址 ?? ''));
    return /^https?:$/.test(u.protocol) && u.hostname ? u : null;
  } catch { return null; }
}
const 去www = 主机 => 主机.toLowerCase().replace(/^www\./, '');

const 是附件 = 网址 => /download\.jsp|DownloadAttachUrl|wbfileid/i.test(网址) || /\.(pdf|docx?|xlsx?|zip|rar)(\?|#|$)/i.test(网址);
const 是云存储 = 主机 => /aliyuncs|myqcloud|qcloud|oss-|(^|\.)cdn|qiniu|bcebos|(^|\.)obs\./.test(主机);
// 带日期（/2025/0623/、/2026-03-23/、/2025/06/）或编号（/info/1150/4898.htm、/c2140a268666/page.htm、new_id、/notice/…数字）的单篇文章
const 是单篇 = 网址 => /\/(19|20)\d\d(?:[-/]\d{1,2}[-/]|[-/]?\d{4}\/)|\/info\/\d+\/|\/c\d+a\d+\/page\.htm|new_id|\/(notice|news|article|dynamic|detail)\/[^/?#]*\d/i.test(网址);
// 文字里出现的年份（前面不是字母数字、后面不是数字的 19xx、20xx；哈希、编号中间的四位数不算）
const 年份们 = 文字 => [...String(文字 ?? '').matchAll(/(?<![0-9a-z])(19|20)\d\d(?!\d)/gi)].map(m => Number(m[0]));

function 旧页面原因(文字, 库里最新年份) {
  if (!库里最新年份) return '';
  const 年 = 年份们(文字);
  if (!年.length) return '';
  const 最新 = Math.max(...年);
  return 最新 < Number(库里最新年份) ? `往年旧页面（最新 ${最新} 年，库里最新 ${库里最新年份} 年）` : '';
}

const 是二级edu = 主机 => /^[^.]+\.edu\.cn$/.test(主机);

export function 网址判断(网址, { 屏蔽 = [], 库里最新年份 = null } = {}) {
  const u = 解析(网址);
  if (!u) return { 可以: false, 原因: '网址不对' };
  const 原文 = String(网址);
  const 原主机 = u.hostname.toLowerCase();
  const 主机 = 去www(原主机);
  const 否 = 原因 => ({ 可以: false, 原因 });
  if (是附件(原文)) return 否('附件下载链接');
  if (/(^|\.)gov\.cn$/.test(主机)) return 否('政府网站');
  if (是云存储(主机)) return 否('云存储/CDN');
  if (/(^|\.)weixin\.qq\.com$/.test(主机)) return 否('公众号');
  if (屏蔽网站.isBlockedHost(主机, 屏蔽)) return 否('屏蔽名单里的网站');
  // 二级 edu.cn（去掉 www 后是 xxx.edu.cn）不按网址否掉：学校主站（bift.edu.cn）和比赛官网（mcm.edu.cn、cahe.edu.cn）分不开，
  // 交给 判断官网 打开后只看标题（2026-11-08 发现数学建模官网被当成学校主站挡掉后改的）
  if (/\.edu\.cn$/.test(主机) && !是二级edu(主机) && 学校部门前缀.includes(原主机.split('.')[0])) return 否('学校部门网站');
  const 旧 = 旧页面原因(原文, 库里最新年份);
  if (旧) return 否(旧);
  if (是单篇(原文)) return 否('单篇通知');
  return { 可以: true, 原因: '' };
}

// ---- 宽松比名字 ----
const 通用 = /全国|中国|国际|全球|大学生|研究生|高校|普通|学生|大赛|竞赛|比赛|挑战赛|创新|设计|官方|网站|官网|第[一二三四五六七八九十百\d]+届|20\d\d|年|的|与|和|及/g;
const 去杯 = 名 => 规范名(名).replace(/[“"「『‘'][^”"」』’']{1,12}[”"」』’']/g, '').replace(/[(（][^()（）]*[)）]/g, '');
function 最长公共(a, b) {
  let 最 = '';
  for (let i = 0; i < a.length; i += 1) {
    for (let j = i + 最.length + 1; j <= a.length; j += 1) {
      const 段 = a.slice(i, j);
      if (b.includes(段)) 最 = 段; else break;
    }
  }
  return 最;
}

export function 宽松有名(名称, 标题) {
  const 核 = 去杯(名称);
  const 题 = 规范名(标题);
  if (!核 || !题) return '';
  const 段 = 最长公共(核, 题);
  // 第一版（至少 4 个字）误认了“工商银行”“生态环境”这类片段，收紧到：整段至少 6 个字、去掉通用词后至少 4 个字；纯英文片段至少 8 个字母
  if (/^[a-z0-9.\-]+$/.test(段)) return 段.replace(/[^a-z]/g, '').length >= 8 ? 段 : '';
  return 段.length >= 6 && 段.replace(通用, '').length >= 4 ? 段 : '';
}

// ---- 打开网页 ----
const 解实体 = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

async function 打开(网址, 读网页, 浏览器) {
  let 页;
  try { 页 = await 读网页(网址); } catch (e) { return { status: '出错', error: String(e?.message || e), title: '', text: '' }; }
  页 = 页 || { status: '出错', error: '读网页没有交回结果' };
  if (浏览器 && 有内容的.has(页.status) && String(页.text || '').length < 空壳字数) {
    try {
      const { 页: 浏页, 关 } = await 浏览器.新页面();
      try {
        await 浏页.打开(网址);
        const html = String(await 浏页.源码() || '');
        const 字 = 解实体(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
        const 题 = 解实体(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '').trim() || 页.title || '';
        if (字.length > String(页.text || '').length) 页 = { ...页, status: '成功', title: 题, text: 字, finalUrl: 浏页.网址() || 网址, 用了浏览器: true };
      } finally { await 关(); }
    } catch { /* 浏览器也打不开就用直接下载的结果 */ }
  }
  return 页;
}

export async function 判断官网(网址, 比赛, { 读网页, 浏览器 = null, 屏蔽 = [], 库里最新年份 = null } = {}) {
  const 结果 = (是, 原因, 最终网址 = 网址, 对上 = '', 标题 = '') => ({ 是, 原因, 最终网址, 对上, 标题 });
  const 先看 = 网址判断(网址, { 屏蔽, 库里最新年份 });
  if (!先看.可以) return 结果(false, 先看.原因);

  const 页 = await 打开(网址, 读网页, 浏览器);
  if (!有内容的.has(页.status)) return 结果(false, `打不开：${页.error || 页.status}`);
  const 标题 = String(页.title || '');
  const 正文 = String(页.text || '');
  const 最终网址 = 页.finalUrl || 网址;
  if (最终网址 !== 网址) {
    const 再看 = 网址判断(最终网址, { 屏蔽, 库里最新年份 });
    if (!再看.可以) return 结果(false, `跳转后是${再看.原因}（${最终网址}）`, 最终网址, '', 标题);
  }
  const 旧 = 旧页面原因(`${标题} ${正文.slice(0, 正文开头)}`, 库里最新年份);
  if (旧) return 结果(false, 旧, 最终网址, '', 标题);

  const 浏 = 页.用了浏览器 ? '（无头浏览器）' : '';
  // 二级 edu.cn 只看标题：学校主页正文里常有某个比赛的新闻
  const 只看标题 = 是二级edu(去www(解析(最终网址)?.hostname?.toLowerCase() || ''));
  const 文字 = 规范名(只看标题 ? 标题 : `${标题} ${正文}`);
  if (名称写法(比赛).some(名 => 文字.includes(名))) return 结果(true, `页面上有比赛名${浏}`, 最终网址, '全名', 标题);
  const 宽 = [比赛.name, ...(比赛.aliases || [])].map(名 => 宽松有名(名, 标题)).find(Boolean);
  if (宽) return 结果(true, `网页标题对上「${宽}」${浏}`, 最终网址, '标题宽松', 标题);
  if (只看标题) return 结果(false, `二级 edu.cn 网站（可能是学校主站），标题里没有比赛名${浏}（标题：${标题.slice(0, 30)}）`, 最终网址, '', 标题);
  return 结果(false, `页面上没有比赛名${浏}（标题：${标题.slice(0, 30)}）`, 最终网址, '', 标题);
}

// ---- 从来源表推起点候选 ----
export function 来源候选(来源们, { 屏蔽 = [], 域名比赛数 = null } = {}) {
  const 排 = (来源们 || [])
    .filter(源 => 源.source_type !== 'authority_notice')   // 权威名单由调用方另行处理
    .map((源, 序) => ({ 源, 序 }))
    .sort((a, b) => (类型序[a.源.source_type] ?? 2) - (类型序[b.源.source_type] ?? 2) || (b.源.ordinal ?? 0) - (a.源.ordinal ?? 0) || a.序 - b.序)
    .map(({ 源 }) => 源);
  const 候选 = [];
  const 跳过 = [];
  for (const 源 of 排) {
    const u = 解析(源.url);
    if (!u) { 跳过.push(`${源.url}：网址不对`); continue; }
    const 主机 = 去www(u.hostname);
    const 平台 = (域名比赛数?.get(主机) || 0) >= 平台门槛;
    if (平台) {
      const 看 = 网址判断(源.url, { 屏蔽 });
      if (!看.可以) { 跳过.push(`${主机}：平台上的${看.原因}`); continue; }
      候选.push({ 网址: 源.url, 依据: `${源.source_type} ${源.url}（平台，留这一页）` });
    } else {
      const 首页 = `${u.origin}/`;
      const 看 = 网址判断(首页, { 屏蔽 });
      if (!看.可以) { 跳过.push(`${主机}：${看.原因}`); continue; }
      候选.push({ 网址: 首页, 依据: `${源.source_type} ${源.url}` });
    }
  }
  const 见过 = new Set();
  return { 候选: 候选.filter(x => !见过.has(x.网址) && 见过.add(x.网址)), 跳过 };
}

export function 算域名比赛数(db) {
  const 届次们 = new Map(db.find('edition', {}).map(届 => [届.id, 届]));   // 默认读不到已删除的届次
  const 比赛们 = new Map();   // 主机 → Set<比赛编号>
  for (const 源 of db.find('source', { is_official: true, validity_status: 'valid' })) {
    const 届 = 届次们.get(源.edition_id);
    const u = 解析(源.url);
    if (!届 || !u) continue;
    const 主机 = 去www(u.hostname);
    if (!比赛们.has(主机)) 比赛们.set(主机, new Set());
    比赛们.get(主机).add(届.competition_id);
  }
  return new Map([...比赛们].map(([主机, 集]) => [主机, 集.size]));
}
