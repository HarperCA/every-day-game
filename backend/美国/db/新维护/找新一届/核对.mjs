// 找新一届 · 程序核对（2026-11-12 用户定，纯函数）：认这条通知是不是这个比赛的、是哪一届、比库里最新一届新不新、是不是不拿来建新一届的那类通知。
// 规矩：比赛名由程序对（名称写法任一出现在标题或正文里，不靠 AI 判断是不是同一比赛）；届次中文、阿拉伯数字互认；
// 只有届次或年份比库里最新一届新的才算新一届，认不出的不建。
//
//   有比赛名(文字, 名们) → 是否                 名们：找官网/核实.mjs 的 名称写法(比赛)（已规范化）
//   认本赛届次(文字, 名们, { 兜底 = true }) → { 届, 年, 年止 }   认不出的是 null
//     只认紧挨在比赛名前面的届次、年份（中间只隔“年”“度”、括号、引号、连接号，年份和比赛名之间还可以隔着届次）：
//     “第十六届江苏省…竞赛暨第二十届全国…竞赛”里，全国赛认第二十届、江苏赛认第十六届。
//     兜底（给标题用）：挨着的认不出时，整段文字里只有一个届次（或一个年份）就用它；多个不一样的就认不出。正文不兜底（正文里的日期不是届次年份）。
//     年份区间“2026—2027”“2026-2027年度”：年 2026、年止 2027；单个年份 年止 = 年。
//   最新届信息(届次们) → { 届, 年, 年止, 中文 }   库里最新一届（ordinal 最大）：届次从 edition_ordinal、没写从 edition_name 认；
//     年份从 edition_year、没写从 edition_name 认，都没有时取这一届报名、比赛日期里最晚的年份（跨年办的比赛按结束那年算，免得把同一届当成新的）；
//     中文：库里届次是不是中文数字写的（新届次照着写），认不出当中文。
//   是新届(认, 最新) → true | false | null
//     两边都有届次：比届次（届次和年份冲突时以届次为准）；否则两边都有年份：通知是区间的比区间开头，单个年份的要比库里最新一届的结束年份大；
//     比不了（认不出、库里最新一届没有届次也没有年份）→ null（不建）。
//   排除原因(标题, { 国家级 }) → '' 或原因：招新、承办申报、校赛和实施方案、获奖公示结果报道这类通知不拿来建新一届；
//     国家级比赛的赛区、省赛通知也不拿（省里的截止、赛制不是全国的）。
//   届次文字(n, { 中文 }) → '第十九届' / '第19届' / null
//   合并认(...认们) → { 届, 年, 年止 }：依次取第一个认出的届次、年份（2026-11-13 从 index.mjs 挪来，高校转发.mjs 也用）
//   同一新届(组, 认) → 是否：届次相同，或一方没届次而年份相同
//   同届(认, 最新) → 是否：和库里最新一届是同一届（2026-11-13，新维护找高校转发用）——两边都有届次比届次；
//     否则比年份：通知是区间的比区间开头，单个年份落在库里最新一届的年份区间里就算
//
// 2026-11-13 服务器试跑抽查出两个错（用 2024-10-12 的旧转发页建了“第五届”；一次建了第十届、第十三届两届，第十届的来源还是列表页），
// 用户定三条规矩，高校转发补救（高校转发.mjs）和找新一届（index.mjs）共用：
//   1. 转发页要够新：
//   网址日期(网址) → 'YYYY-MM-DD' | null   网址里的日期：/2024/1012/、/2024/10/12/、/20241012/、t20241012_ 这类
//   正文发布日期(文字) → 'YYYY-MM-DD' | null 正文里标出来的发布时间（发布时间/发布日期/发表时间/更新时间/时间：/日期：…），比赛时间、截止日期不算
//   发布日期({ 搜索日期, 网址（一个或几个，如搜索网址和跳转后的网址）, 正文 }) → 认得出的里面最早的一个（搜索引擎的日期可能是收录、更新日期，网址和正文里的才是发出来的那天）
//   上届结束(最新届行, 最新) → 库里最新一届的比赛结束 → 报名截止 → 最新一届年份（区间按结束那年）的年底；都没有是 null
//   太旧原因(日期, { 今天, 上届结束, 明确更新 }) → '' 够新；否则原因（“转发页太旧：日期（…）”/“认不出发布日期…”）：
//     要在最近 12 个月内，并且晚于 上届结束（给了才比；核对库里最新一届这一届时不给）；
//     认不出日期的，标题或正文认出的届次/年份明确比库里新（明确更新）才用
//   2. 只建比库里最新一届更新的一届，一次最多一届：
//   取最新一届(组们) → 届次（没有届次比年份）最大的那一组；空的是 null
//   3. 来源必须是通知详情页：
//   不是详情页原因(网址, 页?) → '' 是详情页；否则原因：首页、栏目页、列表页（list*.htm、/list/、index*、/col/…、以 / 结尾的栏目目录），
//     或读到的页面像列表（像标题的链接 10 个以上，正文一半以上是链接文字）
import { 规范名 } from '../找官网/核实.mjs';
import { 认届次, 认年份, 非主通知关键词 } from '../挑通知.mjs';

const 届次式 = /第([零〇一二两三四五六七八九十百千\d]+)届/g;
const 年份式 = /(?<!\d)((?:19|20)\d{2})(?:[-—–~至]((?:19|20)\d{2}))?(?!\d)/g;
const 挨着 = /^[年度（）()“”"‘’'「」『』《》〈〉【】[\]·:：\-—–~]*$/;   // 届次、年份和比赛名之间只能隔这些
const 最长间隔 = 16;

export const 有比赛名 = (文字, 名们) => { const t = 规范名(文字); return 名们.some(名 => t.includes(名)); };

function 名的位置(t, 名们) {
  const 位置 = new Set();
  for (const 名 of 名们) for (let i = t.indexOf(名); i >= 0; i = t.indexOf(名, i + 1)) 位置.add(i);
  return [...位置].sort((a, b) => a - b);
}

export function 认本赛届次(文字, 名们, { 兜底 = true } = {}) {
  const t = 规范名(文字);
  const 届们 = [...t.matchAll(届次式)].map(m => ({ 值: 认届次(m[0]), 起: m.index, 止: m.index + m[0].length })).filter(x => x.值 != null);
  const 年们 = [...t.matchAll(年份式)].map(m => ({ 年: Number(m[1]), 年止: m[2] ? Number(m[2]) : Number(m[1]), 起: m.index, 止: m.index + m[0].length }));
  // 某个标记（届次或年份）是不是紧挨在位置 p 的比赛名前面：取 p 前面最近的一个，中间去掉届次后只剩“年”、括号、引号之类
  const 挨着前面 = (们, p, 可隔届次) => {
    const 前 = 们.filter(x => x.止 <= p).at(-1);
    if (!前 || p - 前.止 > 最长间隔) return null;
    let 隔 = t.slice(前.止, p);
    if (可隔届次) 隔 = 隔.replace(届次式, '');
    return 挨着.test(隔) ? 前 : null;
  };
  const 回 = { 届: null, 年: null, 年止: null };
  for (const p of 名的位置(t, 名们)) {
    if (回.届 == null) 回.届 = 挨着前面(届们, p, false)?.值 ?? null;
    if (回.年 == null) { const y = 挨着前面(年们, p, true); if (y) Object.assign(回, { 年: y.年, 年止: y.年止 }); }
    if (回.届 != null && 回.年 != null) break;
  }
  if (兜底) {
    const 届值 = [...new Set(届们.map(x => x.值))];
    if (回.届 == null && 届值.length === 1) 回.届 = 届值[0];
    const 年值 = [...new Set(年们.map(x => `${x.年}-${x.年止}`))];
    if (回.年 == null && 年值.length === 1) Object.assign(回, { 年: 年们[0].年, 年止: 年们[0].年止 });
  }
  return 回;
}

const 年区间 = 文字 => { const m = [...String(文字 ?? '').matchAll(年份式)][0]; return m ? { 年: Number(m[1]), 年止: m[2] ? Number(m[2]) : Number(m[1]) } : null; };

export function 最新届信息(届次们 = []) {
  const 最新 = [...届次们].filter(届 => !届.deleted_at).sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)).at(-1);
  if (!最新) return { 届: null, 年: null, 年止: null, 中文: true };
  const 届 = 认届次(最新.edition_ordinal) ?? 认届次(最新.edition_name);
  let 年 = 年区间(最新.edition_year) ?? 年区间(最新.edition_name);
  if (!年) {
    const 日期年们 = ['registration_start', 'registration_end', 'competition_start', 'competition_end'].map(字段 => 认年份(String(最新[字段] ?? '').slice(0, 4))).filter(Boolean);
    if (日期年们.length) { const 最晚 = Math.max(...日期年们); 年 = { 年: 最晚, 年止: 最晚 }; }
  }
  const 届文 = String(最新.edition_ordinal || 最新.edition_name || '');
  return { 届, 年: 年?.年 ?? null, 年止: 年?.年止 ?? null, 中文: !/第\s*\d+\s*届/.test(届文) };
}

export function 是新届(认 = {}, 最新 = {}) {
  if (认.届 != null && 最新.届 != null) return 认.届 > 最新.届;
  if (认.年 != null && 最新.年 != null) {
    const 是区间 = 认.年止 != null && 认.年止 !== 认.年;
    return 是区间 ? 认.年 > 最新.年 : 认.年 > (最新.年止 ?? 最新.年);
  }
  return null;
}

const 排除类 = [
  [/招新|纳新|招募/, '招新类通知'],
  [/承办|申办/, '承办申报类通知'],
  [/校赛|校内赛|校内选拔|校级|院赛|院级|实施方案|工作方案/, '校赛、实施方案类通知'],
  [new RegExp([...非主通知关键词, '喜报', '总结', '回顾', '圆满', '闭幕', '开幕式', '斩获', '喜获', '荣获', '获一等奖', '获二等奖', '获三等奖'].join('|')), '获奖公示、结果、报道类通知'],
];
export function 排除原因(标题, { 国家级 = false } = {}) {
  const t = String(标题 ?? '');
  for (const [式, 原因] of 排除类) if (式.test(t)) return 原因;
  if (国家级 && /赛区|省赛|省级选拔|省级层次/.test(t)) return '赛区、省赛通知（国家级比赛只认全国的）';
  return '';
}

const 数字 = '零一二三四五六七八九';
const 数转中文 = n => (n < 10 ? 数字[n] : `${Math.floor(n / 10) === 1 ? '' : 数字[Math.floor(n / 10)]}十${n % 10 ? 数字[n % 10] : ''}`);
export function 届次文字(n, { 中文 = true } = {}) {
  if (n == null || !Number.isInteger(n) || n < 1) return null;
  return 中文 && n < 100 ? `第${数转中文(n)}届` : `第${n}届`;
}

export const 合并认 = (...们) => {
  const 回 = { 届: null, 年: null, 年止: null };
  for (const 认 of 们) {
    if (回.届 == null && 认?.届 != null) 回.届 = 认.届;
    if (回.年 == null && 认?.年 != null) Object.assign(回, { 年: 认.年, 年止: 认.年止 ?? 认.年 });
  }
  return 回;
};
export const 同一新届 = (组, 认) => (认.届 != null && 组.届 != null ? 认.届 === 组.届 : 认.年 != null && 组.年 != null && 认.年 === 组.年);

export function 同届(认 = {}, 最新 = {}) {
  if (认.届 != null && 最新.届 != null) return 认.届 === 最新.届;
  if (认.年 != null && 最新.年 != null) {
    const 是区间 = 认.年止 != null && 认.年止 !== 认.年;
    return 是区间 ? 认.年 === 最新.年 : 认.年 >= 最新.年 && 认.年 <= (最新.年止 ?? 最新.年);
  }
  return false;
}

// ———— 2026-11-13：转发页要够新 ————
const 补零 = n => String(n).padStart(2, '0');
// 年月日 → 'YYYY-MM-DD'（月、日不对的不要）
const 拼日期 = (年, 月, 日) => {
  const y = Number(年), m = Number(月), d = Number(日);
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${补零(m)}-${补零(d)}`;
};
// 一段文字开头的日期：2026-11-01、2026/11/1、2026.11.1、2026年11月1日、2026-11-01T08:00:00+08:00
const 认日期 = 文字 => { const m = /^\s*((?:19|20)\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(String(文字 ?? '')); return m ? 拼日期(m[1], m[2], m[3]) : null; };

const 网址日期式 = [
  /\/((?:19|20)\d{2})\/(\d{2})(\d{2})(?=\/)/,                    // /2024/1012/
  /\/((?:19|20)\d{2})[/-](\d{1,2})[/-](\d{1,2})(?=[/_.-])/,       // /2024/10/12/、/2024-10-12/
  /(?:\/|\/t|_)((?:19|20)\d{2})(\d{2})(\d{2})(?=[/_.])/,          // /20241012/、/t20241012_123.html
];
export function 网址日期(网址) {
  let 路径;
  try { 路径 = new URL(网址).pathname; } catch { return null; }
  for (const 式 of 网址日期式) {
    const m = 式.exec(路径);
    const d = m && 拼日期(m[1], m[2], m[3]);
    if (d) return d;
  }
  return null;
}

// 正文里标出来的发布时间：“发布时间：”“发布日期:”“发表于”“更新时间”；单写“时间：”“日期：”的要在行首或空格、竖线后面（免得把“比赛时间：”“截止日期：”当成发布时间）
const 发布时间式 = /(?:(?:发布|发表|发文|更新|录入|创建|上传|编辑)(?:时间|日期|于)|(?:^|[\s|｜/])(?:时间|日期))\s*[:：]?\s*((?:19|20)\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/gm;
export function 正文发布日期(文字) {
  for (const m of String(文字 ?? '').matchAll(发布时间式)) {
    const d = 拼日期(m[1], m[2], m[3]);
    if (d) return d;
  }
  return null;
}

export function 发布日期({ 搜索日期 = null, 网址 = '', 正文 = '' } = {}) {
  const 们 = [认日期(搜索日期), ...[网址].flat().map(网址日期), 正文发布日期(正文)].filter(Boolean).sort();
  return 们[0] ?? null;
}

export function 上届结束(最新届行 = {}, 最新 = {}) {
  for (const 字段 of ['competition_end', 'registration_end']) { const d = 认日期(最新届行?.[字段]); if (d) return d; }
  const 年 = 最新?.年止 ?? 最新?.年;
  return 年 != null ? `${年}-12-31` : null;
}

const 一年前 = 今天 => { const t = new Date(`${今天}T00:00:00Z`); t.setUTCFullYear(t.getUTCFullYear() - 1); return t.toISOString().slice(0, 10); };
export function 太旧原因(日期, { 今天, 上届结束: 结束 = null, 明确更新 = false } = {}) {
  if (!日期) return 明确更新 ? '' : '认不出发布日期，标题和正文里也没有比库里新的年份或届次';
  if (今天 && 日期 < 一年前(今天)) return `转发页太旧：${日期}（不在最近 12 个月内）`;
  if (结束 && 日期 <= 结束) return `转发页太旧：${日期}（不晚于库里最新一届结束 ${结束}）`;
  return '';
}

// ———— 2026-11-13：只建最新的一届 ————
export function 取最新一届(组们 = []) {
  let 最新 = null;
  for (const 组 of 组们) if (!最新 || 是新届(组, 最新) === true) 最新 = 组;
  return 最新;
}

// ———— 2026-11-13：来源必须是通知详情页 ————
const 列表文件 = /^(list|index|default|main|home)[\w-]*\.(s?html?|jsp|jspx|aspx?|php|psp|do)$/i;
export function 不是详情页原因(网址, 页 = null, { 高校转发 = false } = {}) {
  let u;
  try { u = new URL(网址); } catch { return '网址不对'; }
  const 段们 = u.pathname.split('/').filter(Boolean);
  const 末 = 段们.at(-1) || '';
  if (高校转发 && (/\.(?:pdf|docx?|xlsx?|pptx?|zip|rar)$/i.test(末)
      || /(?:^|\/)(?:_upload|attachment|attachments)(?:\/|$)/i.test(u.pathname)
      || /(?:^|\/)(?:download|downloadattach)(?:\.|\/|$)/i.test(u.pathname))) {
    return '独立附件不是高校通知详情页';
  }
  if (!段们.length || /^(index|default|main|home)(\.\w+)?$/i.test(段们.join('/'))) return '首页，不是通知详情页';
  if (列表文件.test(末) || 段们.slice(0, -1).some(段 => /^list$/i.test(段))) return `网址像列表页、栏目页（${末}），不是通知详情页`;
  if (段们.some(段 => /^col$/i.test(段))) return '网址像栏目页（/col/），不是通知详情页';
  if (u.pathname.endsWith('/') && !/\d/.test(末)) return `网址像栏目页（/${末}/），不是通知详情页`;
  if (页) {
    const 链们 = (页.links || []).filter(l => 规范空白(l?.text).length >= 8);
    const 正文字数 = 规范空白(页.text).replace(/\s/g, '').length;
    const 链字数 = 链们.reduce((和, l) => 和 + 规范空白(l.text).replace(/\s/g, '').length, 0);
    if (链们.length >= 10 && 链字数 * 2 >= 正文字数) return `页面像列表（${链们.length} 个像标题的链接，正文几乎都是链接文字），不是通知详情页`;
  }
  return '';
}
const 规范空白 = s => String(s ?? '').replace(/\s+/g, ' ').trim();
