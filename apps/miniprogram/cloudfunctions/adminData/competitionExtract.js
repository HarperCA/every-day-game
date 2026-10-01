// 从赛事详情页正文抽取字段建议。
//
// 解决的是这个卡点：抓取拿到的列表接口只给得出奖金和参赛队伍数，
// 而「主办方是谁」「有没有实习直通面试」这类判断藏在详情页正文里。
// 收录门槛因此有大批候选停在 review 档，不是因为它们不合格，
// 是因为没人读过那段正文。
//
// 三条纪律，和审核模块保持一致：
//
// 一、每一项都必须带一段原文锚点（anchor）。
// 二、锚点会被回原文定位并扩展成整句：定位不到的整条丢弃。
//    这是防编造最硬的一道闸 —— 模型可以答错，但答不出一段页面上没有的话。
//    最终存下来的证据直接来自原文，不是模型的转写。
// 三、产出是建议，不写库。发布与否由人决定，和 getPublishBlockers 一致。
const { isAllowed } = require('./robots');
const { REWARD_HIGHLIGHTS, RECOGNITION_PATHS, RECOGNITION_LEVELS, REGISTRATION_ORGANIZATIONS } = require('./competitionValue');
const {
  USER_AGENT, adjustRequestOptions, callChatCompletion, htmlToText,
  loadRobots, parseModelJson, readAiConfig, resolveRequest, timeoutSignal,
} = require('./competitionAiReview');
const { reasoningFromPayload, reportReasoning, thinkingEnabled } = require('./aiReasoning');

const PROMPT_VERSION = 'competition-extract-v4-submission-deadline';
// 批量抽取走 EXTRACT_ 前缀的配置，未设置时逐项回退到通用的 AI_*。
// 抽取是突发型负载：几百场集中跑会撞上会员制的窗口配额，
// 而审核是低频的，留在原供应商上不受影响。
const EXTRACT_CONFIG_PREFIX = 'EXTRACT_';
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

// 实测 2026-09-19：从这台海外服务器抓中国高校站点，IPv6 直接不通（自动
// 退回 IPv4），IPv4 连上后不少站点响应很慢——8 秒里有相当一部分"抓失败"
// 其实是"没抓完"，给够时间(15秒内)能成功。20 秒不是随便定的上限，
// 下面 TOTAL_BUDGET_MS 的预算分配还留得住。
const PAGE_TIMEOUT_MS = 20000;
// 云函数硬上限是 60 秒，被平台掐死时什么都拿不到，连失败原因都没有。
// 所以自己先收口：总预算 52 秒，留 8 秒给平台调度和返回序列化。
// 模型调用的超时不是写死的，而是「总预算减去抓页面已经花掉的时间」——
// 抓页面快就多给模型，抓得慢就少给，两者之和始终在预算内。
const TOTAL_BUDGET_MS = 52000;
const BUDGET_RESERVE_MS = 3000;
const MIN_CHAT_TIMEOUT_MS = 8000;
const DEFAULT_CHAT_TIMEOUT_MS = 40000;
// max_tokens 是上限不是目标：锚点已经让实际输出变短，耗时随之下降，
// 但上限收得太紧会让 kimi-for-coding 返回空内容（它会先消耗 token 做内部推理）。
// 本轮早先在 AI 审核上踩过同一个坑：900 太小，返回 ai_review_empty_response。
// 2026-09-30 测试阶段打开了 DeepSeek 的思考（aiReasoning.js），思考和答案共用这个上限：
// 实测一个“是/否”问题就想了六千多字符、把 2000 用光、答案为空。所以思考打开时放宽到 32000
// （DeepSeek 官方单次输出上限是 384K，这里远没到）；关掉思考时仍用原来的 2000。
const DEFAULT_MAX_TOKENS = thinkingEnabled() ? 32000 : 2000;

// 返回这次调用还能给模型多少时间。低于最小值说明抓页面已经耗掉太多，
// 与其发一个注定超时的请求，不如直接放弃。
//
// totalBudgetMs 可以放宽：52 秒是云函数 60 秒上限倒推出来的，
// 同一份代码跑在服务器上没有这个约束，批量抽取可以给模型更多时间。
function remainingChatBudget(startedAt, requested, now = Date.now(), totalBudgetMs = TOTAL_BUDGET_MS) {
  const ceiling = Number(requested) > 0 ? Number(requested) : DEFAULT_CHAT_TIMEOUT_MS;
  const left = totalBudgetMs - (now - startedAt) - BUDGET_RESERVE_MS;
  return Math.min(ceiling, left);
}
// 正文太长会把耗时推到 60 秒上限之外，而通知类页面的关键信息通常集中在前段。
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

async function fetchDetailPage(url, request) {
  const send = resolveRequest(request);
  let target;
  try {
    target = new URL(url);
  } catch (_error) {
    return { url, status:'invalid_url', text:'' };
  }
  if (!/^https?:$/.test(target.protocol)) return { url, status:'unsupported_protocol', text:'' };

  const robots = await loadRobots(send, target.origin, new Map());
  if (robots && !isAllowed(robots, USER_AGENT, target.pathname)) {
    return { url, status:'blocked_by_robots', text:'' };
  }
  try {
    const response = await send(url, {
      redirect:'follow', signal:timeoutSignal(PAGE_TIMEOUT_MS), timeoutMs:PAGE_TIMEOUT_MS,
      headers:{ 'User-Agent':USER_AGENT },
    });
    if (!response.ok) return { url, status:`http_${response.status}`, text:'' };
    const contentType = response.headers.get('content-type') || '';
    if (!/html|text|xml/i.test(contentType)) return { url, status:'unsupported_content_type', contentType, text:'' };
    return { url, status:'ok', contentType, text:toStructuredText(await response.text(), PAGE_TEXT_LIMIT) };
  } catch (error) {
    return { url, status:'fetch_failed', text:'', error:String(error?.message || error).slice(0, 200) };
  }
}

function buildExtractPrompt(pageText, contestName) {
  return [
    '你要从下面这段赛事页面正文里抽取事实，供人工复核。这不是写作任务。',
    '',
    '硬性要求：',
    `1. 每一项都必须附带 anchor —— 从正文里逐字摘录的一小段，${ANCHOR_MIN_LENGTH} 到 ${ANCHOR_MAX_LENGTH} 个字，不得改写、不得合并、不得翻译。`,
    '   只要这一小段，不要抄整句：系统会自己回原文把它扩展成完整句子。',
    '2. 正文里没有明确写到的，一律留空或不返回该项。不要根据常识、主办方名气或赛事类型推断。',
    '3. anchor 必须能在正文里原样找到，且不能是「大赛」「报名」这类到处都有的词。定位不到的整条作废。',
    '4. 每个数组最多 4 项，只留最有代表性的。',
    '',
    '只输出一个 JSON 对象，不要 Markdown 围栏，不要解释。字段：',
    'competition_name: {value, anchor} 或 null —— 这个页面讲的是哪一场比赛：正文里写出的比赛全称，value 必须和正文某处逐字相同（可以带年份、届次），',
    '  不要自己拼接、补全或改写；搜索标题可能是栏目名或口号，不能当比赛名。正文没写明是哪一场比赛就给 null。',
    'organizer: {value, anchor} 或 null —— 主办/承办单位全称，按正文写法。',
    'participants: {value, anchor} 或 null —— 官方明确的参赛对象原文。',
    'eligibility: {value, anchor} 或 null —— 学籍、成绩、地域等参赛资格限制原文。',
    'format_and_rules: {value, anchor} 或 null —— 赛制、具体专业任务或评审规则原文。',
    'team_size: {value, anchor} 或 null —— 每队人数或个人参赛要求原文。',
    'registration_method: {value, anchor} 或 null —— 官方实际报名步骤原文。',
    'fees: {value, anchor} 或 null —— 报名收费、免费或费用说明原文；没写不得填免费。',
    `reward_highlights: 数组，每项 {value, anchor}。value 只能取：${REWARD_HIGHLIGHTS.join('、')}。`,
    '  注意：只有正文明确写了对应待遇才能列出。写了奖金就列「现金奖金」，',
    '  写了实习机会或免笔试/直通面试才能列「实习或直通面试」，写了保研加分才能列「保研考研加分」。',
    'authority_signals: 数组，每项 {signal, anchor} —— 正文里体现主办方权威性的表述，',
    '  例如上级主管部门、主办学会名称、是否列入某目录。signal 用一句话概括，不超过 40 字。',
    `recognition_hints: 数组，每项 {path, level, anchor, scope}。path 只能取：${RECOGNITION_PATHS.join('、')}；`,
    `  level 只能取：${RECOGNITION_LEVELS.join('、')}；scope 为岗位或方向的字符串数组，正文没提就给空数组。`,
    '  只有正文明确写了「获奖可获得保研加分」「优胜者直通终面」这类内容才能给，',
    '  不要因为主办方是大公司就推断企业认可度高。',
    `registration_organization: {value, anchor} 或 null —— 报名由谁组织。value 只能取：${REGISTRATION_ORGANIZATIONS.join('、')}。`,
    '  按正文原话对应到最接近的一项；正文没写清楚就不要返回该项，不要自己造措辞。',
    'registration_start: {value, anchor} 或 null —— 报名开始日期。value 必须是 YYYY-MM-DD；',
    '  anchor 是正文里写这个日期的原文片段（例如「2026年10月15日」「10月15日起」）。只有一个日期、没写"开始"字样时，',
    '  按"报名开始"理解；正文只说了截止日期、没说开始日期，就不要编一个开始日期出来。',
    'registration_end: {value, anchor} 或 null —— 报名截止日期，格式和取法同上。',
    '  正文没有单独写“报名截止”、但写了收稿截止、作品提交截止、作品报送截止的，把这个日期当作报名截止（这类比赛报名和交作品一起完成，过了这个日期就参加不了）。anchor 取写这个日期的原文。',
    'missing: 字符串数组，最多 6 项 —— 正文里没有写到、因此无法抽取的关键项。',
    '',
    contestName ? `赛事名称（仅供定位，不可作为证据）：${contestName}` : '',
    '页面正文：',
    pageText,
  ].filter(Boolean).join('\n');
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

// 把通过回查的结果整理成可直接填进记录的形状。认可度仍标为建议 ——
// 等级是判断，不是事实，必须经人确认。
function toFieldSuggestions(verified, sourceUrl) {
  const suggestions = [];
  const push = (field, value, quote) => suggestions.push({ field, value, quote, source:sourceUrl });
  if (verified.competition_name) push('competition_name', verified.competition_name.value, verified.competition_name.quote);
  if (verified.organizer) push('organizer', verified.organizer.value, verified.organizer.quote);
  for (const [field, item] of Object.entries({participants:verified.participants,eligibility:verified.eligibility,format_and_rules:verified.format_and_rules,team_size:verified.team_size,registration_method:verified.registration_method,fees:verified.fees})) {
    if (item) push(field, item.value, item.quote);
  }
  if (verified.registration_organization) {
    push('registration_organization', verified.registration_organization.value, verified.registration_organization.quote);
  }
  if (verified.registration_start) push('registration_start', verified.registration_start.value, verified.registration_start.quote);
  if (verified.registration_end) push('registration_end', verified.registration_end.value, verified.registration_end.quote);
  for (const item of verified.reward_highlights) push('reward_highlights', item.value, item.quote);
  for (const hint of verified.recognition_hints) {
    suggestions.push({
      field:'recognition',
      value:{ path:hint.path, level:hint.level, evidence:hint.quote, scope:Array.isArray(hint.scope) ? hint.scope : [] },
      quote:hint.quote,
      source:sourceUrl,
      needsHumanConfirmation:true, // 等级是判断，不是事实
    });
  }
  return suggestions;
}

// 前后端分离的站点，静态抓取只拿得到导航骨架。
// 实测天池两个不同赛事的详情页抓出来一字不差，全是「首页 天池大赛 数据集…」。
// 把这种骨架送进模型，只会烧配额换垃圾 —— 所以先判断正文是否真的在讲这场赛事。
// 真正拦住天池的是下面的名称检查（它有 665 字，长度关过得去）；
// 这个下限只是兜底：正文不到两百字的页面，抽出来也没有复核价值。
const BOILERPLATE_MIN_CHARS = 200;

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
  return probes.some(probe => normalized.includes(probe));
}

// text 可由调用方传入：前后端分离的站点需要走各自的接口取正文，
// 那件事在服务器侧的爬虫里做（不受 60 秒限制），这里只负责抽取。
// 引文仍然只对传入的这段文本回查，所以「证据可复核」这一性质不受影响。
async function extractFromDetailPage(url, request, { contestName = '', text = '', chatTimeoutMs, maxTokens, startedAt = Date.now(), totalBudgetMs = TOTAL_BUDGET_MS, onReasoning } = {}) {
  const config = readAiConfig(process.env, EXTRACT_CONFIG_PREFIX);
  if (!config.apiKey) throw new Error('ai_api_key_not_configured');

  // 传进来的正文也要去标签：接口返回的富文本里常夹着 <img> <p>，
  // 留着既浪费 token，又会让引文回查因为标签而对不上。
  const page = text
    ? { url, status:'ok', text:toStructuredText(text, PAGE_TEXT_LIMIT), providedByCaller:true }
    : await fetchDetailPage(url, request);
  if (page.status !== 'ok' || !page.text) {
    // 抓不到页面时不调模型：没有正文，任何抽取都只能是编造。
    return { ok:false, status:page.status, url, promptVersion:PROMPT_VERSION, error:page.error || null };
  }
  if (!looksLikeContestPage(page.text, contestName)) {
    return {
      ok:false,
      status:'page_is_boilerplate',
      url,
      promptVersion:PROMPT_VERSION,
      sourceChars:page.text.length,
      error:'正文里找不到该赛事的名称，多半是前后端分离站点的导航骨架；请改用该站的详情接口取正文后经 text 传入。',
    };
  }

  const send = resolveRequest(request);
  const messages = [{ role:'user', content:buildExtractPrompt(page.text, contestName) }];
  const budget = remainingChatBudget(startedAt, chatTimeoutMs, Date.now(), totalBudgetMs);
  if (budget < MIN_CHAT_TIMEOUT_MS) {
    // 抓页面已经吃掉大半预算，这时候发请求必定被平台掐死，还拿不到失败原因。
    return {
      ok:false, status:'budget_exhausted', url, promptVersion:PROMPT_VERSION,
      sourceChars:page.text.length, elapsedMs:Date.now() - startedAt,
      error:`取正文后剩余预算仅 ${Math.max(budget, 0)}ms，不足以发起模型调用`,
    };
  }
  let options = {
    useJsonSchema:false, // 抽取结果是嵌套结构，直接用 json_object 更稳
    includeTemperature:true,
    chatTimeoutMs:budget,
    maxTokens:Number(maxTokens) > 0 ? Number(maxTokens) : DEFAULT_MAX_TOKENS,
  };

  let attempt = await callChatCompletion(send, config, messages, options);
  while (!attempt.ok) {
    const next = adjustRequestOptions(attempt.status, attempt.raw, options);
    if (!next) throw new Error(`ai_extract_failed_${attempt.status}:${String(attempt.raw).slice(0, 200)}`);
    // 降级重试同样受总预算约束，不能因为重试就突破 60 秒。
    const retryBudget = remainingChatBudget(startedAt, chatTimeoutMs, Date.now(), totalBudgetMs);
    if (retryBudget < MIN_CHAT_TIMEOUT_MS) {
      return {
        ok:false, status:'budget_exhausted', url, promptVersion:PROMPT_VERSION,
        sourceChars:page.text.length, elapsedMs:Date.now() - startedAt,
        error:`降级重试时预算已耗尽（上次返回 ${attempt.status}）`,
      };
    }
    options = { ...options, ...next, chatTimeoutMs:retryBudget };
    attempt = await callChatCompletion(send, config, messages, options);
  }

  // 思考过程随抽取结果一起返回（服务器批量抽取会把它写进当晚的运行文件）
  const reasoning = reasoningFromPayload(attempt.payload);
  reportReasoning(onReasoning, { kind:'extract', model:config.model, provider:config.provider || 'deepseek', url, reasoning });
  const content = attempt.payload?.choices?.[0]?.message?.content;
  if (!content) {
    // 答案为空多半是思考把额度用完了：不再直接抛错，把思考过程带回去，才看得出它卡在哪
    return {
      ok:false, status:'ai_extract_empty_response', url, promptVersion:PROMPT_VERSION,
      sourceChars:page.text.length, elapsedMs:Date.now() - startedAt, model:config.model,
      finishReason:attempt.payload?.choices?.[0]?.finish_reason || null, reasoning,
      error:'模型没有给出答案（finish_reason 为 length 说明额度被思考用完）',
    };
  }
  const parsed = parseModelJson(content);
  const verified = verifyAgainstSource(parsed, page.text);

  return {
    ok:true,
    url,
    promptVersion:PROMPT_VERSION,
    sourceChars:page.text.length,
    elapsedMs:Date.now() - startedAt,
    model:config.model,
    extracted:verified,
    suggestions:toFieldSuggestions(verified, url),
    droppedCount:verified.dropped.length,
    reasoning,
    // 抽取只提建议，不写库：发布与否由人决定。
    applied:false,
  };
}

module.exports = {
  PROMPT_VERSION, PAGE_TEXT_LIMIT, MIN_QUOTE_LENGTH, MAX_QUOTE_LENGTH,
  ANCHOR_MIN_LENGTH, ANCHOR_MAX_LENGTH, BOILERPLATE_MIN_CHARS, MAX_ANCHOR_OCCURRENCES, MIN_EVIDENCE_CHARS,
  TOTAL_BUDGET_MS, MIN_CHAT_TIMEOUT_MS, DEFAULT_MAX_TOKENS, EXTRACT_CONFIG_PREFIX, remainingChatBudget,
  buildExtractPrompt, expandAnchor, extractFromDetailPage, fetchDetailPage, isSelfContained, isValidIsoDate, looksLikeContestPage, toStructuredText,
  normalizeForQuoteMatch, quoteAppearsInSource, toFieldSuggestions, verifyAgainstSource,
};
