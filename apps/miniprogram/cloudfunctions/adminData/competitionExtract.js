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

const PROMPT_VERSION = 'competition-extract-v2-anchor';
// 批量抽取走 EXTRACT_ 前缀的配置，未设置时逐项回退到通用的 AI_*。
// 抽取是突发型负载：几百场集中跑会撞上会员制的窗口配额，
// 而审核是低频的，留在原供应商上不受影响。
const EXTRACT_CONFIG_PREFIX = 'EXTRACT_';
const PAGE_TIMEOUT_MS = 8000;
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
const DEFAULT_MAX_TOKENS = 2000;

// 返回这次调用还能给模型多少时间。低于最小值说明抓页面已经耗掉太多，
// 与其发一个注定超时的请求，不如直接放弃。
function remainingChatBudget(startedAt, requested, now = Date.now()) {
  const ceiling = Number(requested) > 0 ? Number(requested) : DEFAULT_CHAT_TIMEOUT_MS;
  const left = TOTAL_BUDGET_MS - (now - startedAt) - BUDGET_RESERVE_MS;
  return Math.min(ceiling, left);
}
// 正文太长会把耗时推到 60 秒上限之外，而通知类页面的关键信息通常集中在前段。
const PAGE_TEXT_LIMIT = 6000;
// 引文太短会误匹配（「大赛」几乎出现在任何页面上），太长则模型难以逐字复现。
const MIN_QUOTE_LENGTH = 6;
const MAX_QUOTE_LENGTH = 120;

const PUNCTUATION_MAP = {
  '，': ',', '。': '.', '；': ';', '：': ':', '！': '!', '？': '?',
  '、': ',', '（': '(', '）': ')', '“': '"', '”': '"', '‘': "'", '’': "'",
};

// 比对前抹平空白和全半角差异：模型复现原文时常常改动这些，
// 但它们不影响「这句话是否真的在页面上」。
function normalizeForQuoteMatch(text) {
  return String(text || '')
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
    if (/[\s　]/.test(character)) continue;
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
const MAX_ANCHOR_OCCURRENCES = 3;

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1 && count <= MAX_ANCHOR_OCCURRENCES) {
    count += 1;
    index = haystack.indexOf(needle, index + 1);
  }
  return count;
}

// 在原文里定位锚点，向两侧扩展到句子边界，返回原文里的那一整句。
// 定位不到、或锚点太普通，返回 null —— 对应的抽取项会被丢弃。
function expandAnchor(anchor, sourceText) {
  const value = String(anchor || '').trim();
  if (value.length < ANCHOR_MIN_LENGTH || value.length > ANCHOR_MAX_LENGTH) return null;
  const { normalized, positions } = buildNormalizedIndex(sourceText);
  const needle = normalizeForQuoteMatch(value);
  if (!needle) return null;
  const at = normalized.indexOf(needle);
  if (at === -1) return null;
  if (countOccurrences(normalized, needle) > MAX_ANCHOR_OCCURRENCES) return null;

  const source = String(sourceText);
  let start = positions[at];
  let end = positions[Math.min(at + needle.length - 1, positions.length - 1)];
  // 向左退到上一个句号之后，向右推到下一个句号为止
  while (start > 0 && !SENTENCE_BOUNDARY.test(source[start - 1]) && end - start < MAX_QUOTE_LENGTH) start -= 1;
  while (end < source.length - 1 && !SENTENCE_BOUNDARY.test(source[end]) && end - start < MAX_QUOTE_LENGTH) end += 1;
  return source.slice(start, end + 1).replace(/[\s　]+/g, ' ').trim().slice(0, MAX_QUOTE_LENGTH);
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
    return { url, status:'ok', contentType, text:htmlToText(await response.text()).slice(0, PAGE_TEXT_LIMIT) };
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
    'organizer: {value, anchor} 或 null —— 主办/承办单位全称，按正文写法。',
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
    'missing: 字符串数组，最多 6 项 —— 正文里没有写到、因此无法抽取的关键项。',
    '',
    contestName ? `赛事名称（仅供定位，不可作为证据）：${contestName}` : '',
    '页面正文：',
    pageText,
  ].filter(Boolean).join('\n');
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

  const organizer = keepWithQuote(parsed.organizer, 'organizer');
  // 这个字段在 event_edition schema 里是枚举，模型返回散文会直接违反约束
  const registrationOrganization = REGISTRATION_ORGANIZATIONS.includes(parsed.registration_organization?.value)
    ? keepWithQuote(parsed.registration_organization, 'registration_organization')
    : null;

  const rewardHighlights = (Array.isArray(parsed.reward_highlights) ? parsed.reward_highlights : [])
    .filter(item => REWARD_HIGHLIGHTS.includes(item?.value))
    .map(item => keepWithQuote(item, 'reward_highlights'))
    .filter(Boolean);

  const authoritySignals = (Array.isArray(parsed.authority_signals) ? parsed.authority_signals : [])
    .map(item => keepWithQuote(item, 'authority_signals'))
    .filter(Boolean);

  const recognitionHints = (Array.isArray(parsed.recognition_hints) ? parsed.recognition_hints : [])
    .filter(item => RECOGNITION_PATHS.includes(item?.path) && RECOGNITION_LEVELS.includes(item?.level))
    .map(item => keepWithQuote(item, 'recognition_hints'))
    .filter(Boolean);

  return {
    organizer,
    reward_highlights:rewardHighlights,
    authority_signals:authoritySignals,
    recognition_hints:recognitionHints,
    registration_organization:registrationOrganization,
    missing:(Array.isArray(parsed.missing) ? parsed.missing : []).filter(item => typeof item === 'string').slice(0, 10),
    dropped,
  };
}

// 把通过回查的结果整理成可直接填进记录的形状。认可度仍标为建议 ——
// 等级是判断，不是事实，必须经人确认。
function toFieldSuggestions(verified, sourceUrl) {
  const suggestions = [];
  const push = (field, value, quote) => suggestions.push({ field, value, quote, source:sourceUrl });
  if (verified.organizer) push('organizer', verified.organizer.value, verified.organizer.quote);
  if (verified.registration_organization) {
    push('registration_organization', verified.registration_organization.value, verified.registration_organization.quote);
  }
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

function looksLikeContestPage(text, contestName) {
  const value = String(text || '');
  if (value.length < BOILERPLATE_MIN_CHARS) return false;
  const name = String(contestName || '').trim();
  if (!name) return true; // 没给名称就无从判断，交由后续的引文回查兜底
  // 赛事名常被拆开写，取其中较长的片段做判断，避免整串精确匹配过于苛刻
  const core = name.replace(/[（(][^）)]*[）)]/g, '').replace(/[\s　“”"']/g, '');
  const probes = [core, core.slice(0, 8), core.slice(-8)].filter(item => item.length >= 4);
  const normalized = value.replace(/[\s　]/g, '');
  return probes.some(probe => normalized.includes(probe));
}

// text 可由调用方传入：前后端分离的站点需要走各自的接口取正文，
// 那件事在服务器侧的爬虫里做（不受 60 秒限制），这里只负责抽取。
// 引文仍然只对传入的这段文本回查，所以「证据可复核」这一性质不受影响。
async function extractFromDetailPage(url, request, { contestName = '', text = '', chatTimeoutMs, maxTokens, startedAt = Date.now() } = {}) {
  const config = readAiConfig(process.env, EXTRACT_CONFIG_PREFIX);
  if (!config.apiKey) throw new Error('ai_api_key_not_configured');

  // 传进来的正文也要去标签：接口返回的富文本里常夹着 <img> <p>，
  // 留着既浪费 token，又会让引文回查因为标签而对不上。
  const page = text
    ? { url, status:'ok', text:htmlToText(text).slice(0, PAGE_TEXT_LIMIT), providedByCaller:true }
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
  const budget = remainingChatBudget(startedAt, chatTimeoutMs);
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
    const retryBudget = remainingChatBudget(startedAt, chatTimeoutMs);
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

  const content = attempt.payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error('ai_extract_empty_response');
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
    // 抽取只提建议，不写库：发布与否由人决定。
    applied:false,
  };
}

module.exports = {
  PROMPT_VERSION, PAGE_TEXT_LIMIT, MIN_QUOTE_LENGTH, MAX_QUOTE_LENGTH,
  ANCHOR_MIN_LENGTH, ANCHOR_MAX_LENGTH, BOILERPLATE_MIN_CHARS, MAX_ANCHOR_OCCURRENCES,
  TOTAL_BUDGET_MS, MIN_CHAT_TIMEOUT_MS, DEFAULT_MAX_TOKENS, EXTRACT_CONFIG_PREFIX, remainingChatBudget,
  buildExtractPrompt, expandAnchor, extractFromDetailPage, fetchDetailPage, looksLikeContestPage,
  normalizeForQuoteMatch, quoteAppearsInSource, toFieldSuggestions, verifyAgainstSource,
};
