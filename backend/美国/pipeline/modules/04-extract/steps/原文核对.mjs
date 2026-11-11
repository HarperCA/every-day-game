// 原文核对：AI 给的每一项都要带原文片段（anchor），程序回原文找到它、扩成整句或整行当证据；找不到的整项删掉，记进 dropped。
// 这是防 AI 编造最硬的一道闸：模型可以答错，但答不出一段页面上没有的话；最后存下的证据直接来自原文，不是模型的转写。
// 从旧代码 adminData/competitionExtract.js 原样搬来（2026-11-01），规则和注释都没改，只改成 ES 模块、可选值改从 ../schema.mjs 取。
// 先放在 04 里；以后维护的“核对原文”也要用时，再挪到美国下一级两边共用（维护不能引用流程的代码）。
//
//   verifyAgainstSource(AI 交回的 JSON, 正文) → { 各字段 {value, quote} 或 null, 列表字段 [...], missing, dropped }
//   expandAnchor(片段, 正文) → 原文里的整句或整行，找不到、太普通交回 null
//   looksLikeContestPage(正文, 比赛名) → 是不是在讲这场比赛（否则多半是导航空壳，交给重读）
//   toStructuredText(正文, 上限) → 去标签、保留换行
import { REWARD_HIGHLIGHTS, RECOGNITION_PATHS, RECOGNITION_LEVELS, REGISTRATION_ORGANIZATIONS } from '../schema.mjs';

// 抽取必须保留换行。htmlToText 会把 \s+ 压成空格，赛事页最关键的信息
// （「## 奖金设置」下面的列表、评审表格）压完就成了一整行，块边界全没了，
// 引文只能按字数硬切。这里改成只合并空格和制表符，换行原样保留。
function toStructuredText(input, limit) {
  return String(input || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // 块级标签的收尾转成换行，否则去标签后段落会黏成一片
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;/g, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t　]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, limit);
}

const PAGE_TEXT_LIMIT = 6000;
// 引文太短会误匹配（「大赛」几乎出现在任何页面上）。
// 上限 120 太小：一个「奖金设置」块有四档奖项，装不下就会被拦腰截断。
// 提到 300，与 event_edition schema 里 recognition[].evidence 的 maxLength 一致。
const MIN_QUOTE_LENGTH = 6;
const MAX_QUOTE_LENGTH = 300;
// 一行短于这个长度就不足以单独当证据（「- 8万」这种），需要向两侧补整行。
const MIN_EVIDENCE_CHARS = 16;

const PUNCTUATION_MAP = {
  '，': ',', '。': '.', '；': ';', '：': ':', '！': '!', '？': '?',
  '、': ',', '（': '(', '）': ')', '“': '"', '”': '"', '‘': "'", '’': "'",
};

// Markdown 的强调、标题、代码和续行标记是格式不是内容。
// 模型复现「**主办单位**：中国中检」时会写成「主办单位：中国中检」，
// 两边都抹掉才对得上 —— 实测保留换行后，十条锚点里有七条因此被误丢。
// 抹掉的只是标记符号，文字本身仍须一字不差，防编造的性质不受影响。
const MARKDOWN_MARKS = /[*#`~\\]/g;

// 比对前抹平空白、全半角和 Markdown 标记差异：模型复现原文时常常改动这些，
// 但它们不影响「这句话是否真的在页面上」。
function normalizeForQuoteMatch(text) {
  return String(text || '')
    .replace(MARKDOWN_MARKS, '')
    .replace(/[\s　]+/g, '')
    .replace(/[，。；：！？、（）“”‘’]/g, match => PUNCTUATION_MAP[match])
    .toLowerCase();
}

// 归一化会改变下标，所以同时记录每个归一化字符对应的原文位置，
// 这样锚点定位之后还能回到原文里去截取完整句子。
function buildNormalizedIndex(text) {
  const source = String(text || '');
  let normalized = '';
  const positions = [];
  for (let i = 0; i < source.length; i += 1) {
    const character = source[i];
    // 必须与 normalizeForQuoteMatch 跳过完全相同的字符，否则定位出来的下标
    // 会和原文错位 —— 实测两边不一致时，所有锚点都会失配。
    if (/[\s　]/.test(character)) continue;
    if (MARKDOWN_MARKS.test(character)) { MARKDOWN_MARKS.lastIndex = 0; continue; }
    MARKDOWN_MARKS.lastIndex = 0;
    normalized += (PUNCTUATION_MAP[character] || character).toLowerCase();
    positions.push(i);
  }
  return { normalized, positions };
}

function quoteAppearsInSource(quote, sourceText) {
  const value = String(quote || '').trim();
  if (value.length < MIN_QUOTE_LENGTH || value.length > MAX_QUOTE_LENGTH) return false;
  return normalizeForQuoteMatch(sourceText).includes(normalizeForQuoteMatch(value));
}

// 让模型逐字重打整句引文，是这套流程里最主要的耗时来源 ——
// 它在重新生成我们本来就有的文本。改成只要一小段锚点，再由服务端
// 回原文扩展成完整句子：输出量大幅下降，而证据反而更可靠，
// 因为最终存下来的那句话直接来自原文，不是模型的转写。
// 下限只用来挡「大赛」「报名」这种两三个字的词；
// 真正判断锚点够不够具体的是出现次数 ——「共青团中央」只有五个字，却极其具体。
const ANCHOR_MIN_LENGTH = 4;
const ANCHOR_MAX_LENGTH = 30;
const SENTENCE_BOUNDARY = /[。！？；\n.!?;]/;
// 锚点在全文出现太多次说明它过于普通，当证据不可靠。
// 但阈值不能太紧：奖项分档时「官方荣誉证书」会在一等奖、二等奖、三等奖
// 各出现一次，那是合理重复而不是措辞空泛。实测 3 会把它误杀。
const MAX_ANCHOR_OCCURRENCES = 8;

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1 && count <= MAX_ANCHOR_OCCURRENCES) {
    count += 1;
    index = haystack.indexOf(needle, index + 1);
  }
  return count;
}

// 块边界：空行、Markdown 标题、水平分割线。
// 块内部的行（列表项、表格行）属于同一段意思，必须整体取出。
function isBlockBoundary(line) {
  const value = String(line || '').trim();
  return !value || /^#{1,6}\s/.test(value) || /^([-*_]\s*){3,}$/.test(value);
}

// 一行自不自足：有冒号、且冒号后还有实际内容，就是一个完整的键值对，
// 单独拿出来就能当证据。这比按字数判断准得多。
function isSelfContained(line) {
  const match = /[：:]\s*(.+)$/.exec(String(line || '').trim());
  return Boolean(match && match[1].replace(MARKDOWN_MARKS, '').trim().length >= 2);
}

// 把原文按行切开并记下每行的起止位置，用于「取整行、不切半行」。
function toLines(source) {
  const lines = [];
  let offset = 0;
  for (const text of String(source).split('\n')) {
    lines.push({ text, start:offset, end:offset + text.length });
    offset += text.length + 1;
  }
  return lines;
}

// 在原文里定位锚点，取出它所在的**整块**内容。
//
// 之前按句号扩展再 slice(0,120)，在这些页面上是错的：赛事页的关键信息是
// Markdown 列表和表格（「## 奖金设置」下面四行奖项），整块里一个句号都没有，
// 于是一路扩到字数上限被拦腰斩断 —— 实测 33 条引文结尾是「+ 由」
// 「北京北奥集」这种半个词。
//
// 现在改成：先取锚点所在的整块；块太长就以锚点那一行为中心补整行，
// 绝不切半行。定位不到、或锚点太普通，返回 null。
function expandAnchor(anchor, sourceText, { maxChars = MAX_QUOTE_LENGTH } = {}) {
  const value = String(anchor || '').trim();
  if (value.length < ANCHOR_MIN_LENGTH || value.length > ANCHOR_MAX_LENGTH) return null;
  const { normalized, positions } = buildNormalizedIndex(sourceText);
  const needle = normalizeForQuoteMatch(value);
  if (!needle) return null;
  const at = normalized.indexOf(needle);
  if (at === -1) return null;
  if (countOccurrences(normalized, needle) > MAX_ANCHOR_OCCURRENCES) return null;

  const source = String(sourceText);
  const anchorStart = positions[at];
  const lines = toLines(source);
  const anchorLine = lines.findIndex(line => anchorStart >= line.start && anchorStart <= line.end);
  if (anchorLine === -1) return null;

  // 锚点所在块的范围
  let blockStart = anchorLine;
  let blockEnd = anchorLine;
  while (blockStart > 0 && !isBlockBoundary(lines[blockStart - 1].text)) blockStart -= 1;
  while (blockEnd < lines.length - 1 && !isBlockBoundary(lines[blockEnd + 1].text)) blockEnd += 1;

  const join = (from, to) => lines.slice(from, to + 1).map(line => line.text.trim()).filter(Boolean).join(' ');

  // 单行块就是一段散文：整段取太糙，应当只取锚点所在的那一句。
  // 多行块（列表、表格）才需要整块取 —— 那些行合起来才是一件完整的事。
  if (blockStart === blockEnd) {
    const line = lines[anchorLine].text;
    const offsetInLine = anchorStart - lines[anchorLine].start;
    const sentences = line.split(new RegExp(`(?<=${SENTENCE_BOUNDARY.source})`)).filter(Boolean);
    let cursor = 0;
    for (const sentence of sentences) {
      const next = cursor + sentence.length;
      if (offsetInLine < next) {
        const trimmed = sentence.trim();
        return (trimmed.length <= maxChars ? trimmed : trimmed.slice(0, maxChars)) || null;
      }
      cursor = next;
    }
    return line.trim().slice(0, maxChars) || null;
  }

  // 多行块里先只取锚点那一行。
  //
  // 整块取对「三档奖项」这类并列项是合适的，对「每行一个单位」的定义列表
  // 就过头了：实测「组织单位」块里主办、承办、协办、支持、场景共建各占一行，
  // 整块取的结果是五条不同的信号共用同一段 295 字证据 ——
  // 看「技术平台为阿里云天池」时拿到的是一大段单位罗列，根本核对不了是哪句。
  // 一行本身就说清一件事时，它就是最精确的证据。
  let from = anchorLine;
  let to = anchorLine;
  let current = join(from, to);
  // 判断一行够不够当证据，靠的是它自不自足，不是够不够长。
  // 「**主办单位**：中国中检」只有十四个字，却已经把一件事说完整了；
  // 「- 8万」再怎么数也不成证据。有冒号且冒号后有内容，就是一个完整的键值。
  while (!isSelfContained(current) && current.length < MIN_EVIDENCE_CHARS) {
    const grownDown = to < blockEnd ? join(from, to + 1) : null;
    if (grownDown && grownDown.length <= maxChars) { to += 1; current = grownDown; continue; }
    const grownUp = from > blockStart ? join(from - 1, to) : null;
    if (grownUp && grownUp.length <= maxChars) { from -= 1; current = grownUp; continue; }
    break;
  }
  // 锚点那一行本身就超长时才退回按标点断句，但仍然断在标点上而不是数到第 N 个字。
  if (current.length > maxChars) {
    const pieces = current.split(new RegExp(`(?<=${SENTENCE_BOUNDARY.source})`));
    let kept = '';
    for (const piece of pieces) {
      if ((kept + piece).length > maxChars) break;
      kept += piece;
    }
    return (kept || current.slice(0, maxChars)).trim() || null;
  }
  return current || null;
}

// 报名日期只接受 YYYY-MM-DD；格式不对的模型输出（比如"待定""10月"这种半截日期）
// 宁可整条丢弃，也不要塞一个解析不出来的字符串进 schedule。
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidIsoDate(value) {
  if (!ISO_DATE_RE.test(String(value || ''))) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

// 逐字回查每条 quote，丢掉对不上的。返回保留项和被丢弃项，两者都要能被人看到。
function verifyAgainstSource(parsed, sourceText) {
  const dropped = [];
  // 优先用锚点：模型只给一小段，服务端回原文扩成整句。
  // 仍然接受完整 quote，用于兼容旧响应和调用方自行构造的结果。
  const keepWithQuote = (item, label) => {
    if (!item || typeof item !== 'object') return null;
    const expanded = expandAnchor(item.anchor, sourceText);
    if (expanded) return { ...item, quote:expanded };
    if (quoteAppearsInSource(item.quote, sourceText)) return item;
    dropped.push({
      field:label,
      value:item.value ?? item.signal ?? item.path ?? '',
      quote:String(item.anchor || item.quote || '').slice(0, 120),
    });
    return null;
  };

  // 比赛全称：除了锚点能定位，名称本身也必须在正文里原样出现——名字错一个字就是另一场比赛，不能由模型拼出来。
  const nameValue = String(parsed.competition_name?.value || '').trim();
  let competitionName = null;
  if (parsed.competition_name && typeof parsed.competition_name === 'object') {
    const nameInSource = nameValue.length >= 4 && nameValue.length <= 80
      && normalizeForQuoteMatch(sourceText).includes(normalizeForQuoteMatch(nameValue));
    if (nameInSource) competitionName = keepWithQuote({ ...parsed.competition_name, value:nameValue }, 'competition_name');
    else dropped.push({ field:'competition_name', value:nameValue, quote:String(parsed.competition_name.anchor || '').slice(0, 120) });
  }
  const organizer = keepWithQuote(parsed.organizer, 'organizer');
  const participants = keepWithQuote(parsed.participants, 'participants');
  const eligibility = keepWithQuote(parsed.eligibility, 'eligibility');
  const formatAndRules = keepWithQuote(parsed.format_and_rules, 'format_and_rules');
  const teamSize = keepWithQuote(parsed.team_size, 'team_size');
  const registrationMethod = keepWithQuote(parsed.registration_method, 'registration_method');
  const fees = keepWithQuote(parsed.fees, 'fees');
  // 这个字段在 event_edition schema 里是枚举，模型返回散文会直接违反约束
  const registrationOrganization = REGISTRATION_ORGANIZATIONS.includes(parsed.registration_organization?.value)
    ? keepWithQuote(parsed.registration_organization, 'registration_organization')
    : null;

  // 同一种回报只保留一条：模型会为不同奖项档位重复列出同一个 value。
  const seenHighlights = new Set();
  const rewardHighlights = (Array.isArray(parsed.reward_highlights) ? parsed.reward_highlights : [])
    .filter(item => REWARD_HIGHLIGHTS.includes(item?.value))
    .filter(item => {
      if (seenHighlights.has(item.value)) return false;
      seenHighlights.add(item.value);
      return true;
    })
    .map(item => keepWithQuote(item, 'reward_highlights'))
    .filter(Boolean);

  const authoritySignals = (Array.isArray(parsed.authority_signals) ? parsed.authority_signals : [])
    .map(item => keepWithQuote(item, 'authority_signals'))
    .filter(Boolean);

  const recognitionHints = (Array.isArray(parsed.recognition_hints) ? parsed.recognition_hints : [])
    .filter(item => RECOGNITION_PATHS.includes(item?.path) && RECOGNITION_LEVELS.includes(item?.level))
    .map(item => keepWithQuote(item, 'recognition_hints'))
    .filter(Boolean);

  const registrationStart = isValidIsoDate(parsed.registration_start?.value)
    ? keepWithQuote(parsed.registration_start, 'registration_start')
    : null;
  const registrationEnd = isValidIsoDate(parsed.registration_end?.value)
    ? keepWithQuote(parsed.registration_end, 'registration_end')
    : null;

  return {
    competition_name:competitionName,
    organizer,
    participants,
    eligibility,
    format_and_rules:formatAndRules,
    team_size:teamSize,
    registration_method:registrationMethod,
    fees,
    reward_highlights:rewardHighlights,
    authority_signals:authoritySignals,
    recognition_hints:recognitionHints,
    registration_organization:registrationOrganization,
    registration_start:registrationStart,
    registration_end:registrationEnd,
    missing:(Array.isArray(parsed.missing) ? parsed.missing : []).filter(item => typeof item === 'string').slice(0, 10),
    dropped,
  };
}

// 前后端分离的站点，静态抓取只拿得到导航骨架。
// 实测天池两个不同赛事的详情页抓出来一字不差，全是「首页 天池大赛 数据集…」。
// 把这种骨架送进模型，只会烧配额换垃圾 —— 所以先判断正文是否真的在讲这场赛事。
// 真正拦住天池的是下面的名称检查（它有 665 字，长度关过得去）；
// 这个下限只是兜底：正文不到两百字的页面，抽出来也没有复核价值。
const BOILERPLATE_MIN_CHARS = 200;
const LONG_PAGE_CHARS = 1000;

// 比对前把名字和正文抹成同一种写法：全半角统一、去掉空白和各种引号书名号。
// 原先只去名字里的引号、不去正文里的：标题“关于组织参加“建行杯”浙江省…”原样就在正文里，却因为引号对不上被判成空壳页（2026-10-01）。
const QUOTE_MARKS = /[\s　“”‘’"'「」『』《》【】]/g;
const squash = text => String(text || '').normalize('NFKC').replace(QUOTE_MARKS, '');

function looksLikeContestPage(text, contestName) {
  const value = String(text || '');
  if (value.length < BOILERPLATE_MIN_CHARS) return false;
  const name = String(contestName || '').trim();
  if (!name) return true; // 没给名称就无从判断，交由后续的引文回查兜底
  // 赛事名常被拆开写，取其中较长的片段做判断，避免整串精确匹配过于苛刻
  const core = squash(name.replace(/[（(][^）)]*[）)]/g, ''));
  if (!core) return true;
  let probes = [core, core.slice(0, 8), core.slice(-8)].filter(item => item.length >= 4);
  // 名字本身很短（如“园冶杯”三个字）时拿不出 4 字以上的片段，原先因此一律判空壳；
  // 改为用整个名字去找：页面里真有这个名字就放行，没有才算空壳。
  if (!probes.length && core.length >= 2) probes = [core];
  const normalized = squash(value);
  if (probes.some(probe => normalized.includes(probe))) return true;
  // 搜索标题常常是宣传语（“@所有人!万元奖金等你拿!…”），正文里当然找不到。导航骨架都很短（实测 30～600 字），
  // 正文上千字、而且多处在讲比赛的，就不是骨架——交给抽取，比赛真名由抽出的 competition_name 回原文核对（2026-10-01）。
  return value.length >= LONG_PAGE_CHARS && (value.match(/大赛|竞赛|挑战赛|比赛/g) || []).length >= 3;
}

export {
  PAGE_TEXT_LIMIT, MIN_QUOTE_LENGTH, MAX_QUOTE_LENGTH, ANCHOR_MIN_LENGTH, ANCHOR_MAX_LENGTH, MAX_ANCHOR_OCCURRENCES, MIN_EVIDENCE_CHARS, BOILERPLATE_MIN_CHARS,
  toStructuredText, normalizeForQuoteMatch, quoteAppearsInSource, expandAnchor, isSelfContained, isValidIsoDate, verifyAgainstSource, looksLikeContestPage,
};
