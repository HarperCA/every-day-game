// 从赛事详情页正文抽取字段建议。
//
// 解决的是这个卡点：抓取拿到的列表接口只给得出奖金和参赛队伍数，
// 而「主办方是谁」「有没有实习直通面试」这类判断藏在详情页正文里。
// 收录门槛因此有大批候选停在 review 档，不是因为它们不合格，
// 是因为没人读过那段正文。
//
// 三条纪律，和审核模块保持一致：
//
// 一、每个抽取出来的字段必须带一句原文摘录（quote）。
// 二、摘录会被逐字回查：不在正文里出现的，整条丢弃。
//    这是防编造最硬的一道闸 —— 模型可以答错，但答不出一句页面上没有的话。
// 三、产出是建议，不写库。发布与否由人决定，和 getPublishBlockers 一致。
const { isAllowed } = require('./robots');
const { REWARD_HIGHLIGHTS, RECOGNITION_PATHS, RECOGNITION_LEVELS } = require('./competitionValue');
const {
  USER_AGENT, adjustRequestOptions, callChatCompletion, htmlToText,
  loadRobots, parseModelJson, readAiConfig, resolveRequest, timeoutSignal,
} = require('./competitionAiReview');

const PROMPT_VERSION = 'competition-extract-kimi-v1';
const PAGE_TIMEOUT_MS = 8000;
const DEFAULT_CHAT_TIMEOUT_MS = 40000;
const DEFAULT_MAX_TOKENS = 1600;
// 正文太长会把耗时推到 60 秒上限之外，而通知类页面的关键信息通常集中在前段。
const PAGE_TEXT_LIMIT = 6000;
// 引文太短会误匹配（「大赛」几乎出现在任何页面上），太长则模型难以逐字复现。
const MIN_QUOTE_LENGTH = 6;
const MAX_QUOTE_LENGTH = 120;

// 比对前抹平空白和全半角差异：模型复现原文时常常改动这些，
// 但它们不影响「这句话是否真的在页面上」。
function normalizeForQuoteMatch(text) {
  return String(text || '')
    .replace(/[\s　]+/g, '')
    .replace(/[，。；：！？、（）“”‘’]/g, match => ({
      '，': ',', '。': '.', '；': ';', '：': ':', '！': '!', '？': '?',
      '、': ',', '（': '(', '）': ')', '“': '"', '”': '"', '‘': "'", '’': "'",
    }[match]))
    .toLowerCase();
}

function quoteAppearsInSource(quote, sourceText) {
  const value = String(quote || '').trim();
  if (value.length < MIN_QUOTE_LENGTH || value.length > MAX_QUOTE_LENGTH) return false;
  return normalizeForQuoteMatch(sourceText).includes(normalizeForQuoteMatch(value));
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
    '1. 每一个抽取出来的值都必须附带一句 quote —— 从正文里逐字摘录的原话，不得改写、不得合并、不得翻译。',
    '2. 正文里没有明确写到的，一律留空或不返回该项。不要根据常识、主办方名气或赛事类型推断。',
    '3. quote 必须长度在 6 到 120 字之间，且确实能在正文里原样找到。编造的 quote 会被系统丢弃，整条作废。',
    '',
    '只输出一个 JSON 对象，不要 Markdown 围栏，不要解释。字段：',
    'organizer: {value, quote} 或 null —— 主办/承办单位全称，按正文写法。',
    `reward_highlights: 数组，每项 {value, quote}。value 只能取：${REWARD_HIGHLIGHTS.join('、')}。`,
    '  注意：只有正文明确写了对应待遇才能列出。写了奖金就列「现金奖金」，',
    '  写了实习机会或免笔试/直通面试才能列「实习或直通面试」，写了保研加分才能列「保研考研加分」。',
    'authority_signals: 数组，每项 {signal, quote} —— 正文里体现主办方权威性的表述，',
    '  例如上级主管部门、主办学会名称、是否列入某目录。signal 用一句话概括，不超过 40 字。',
    `recognition_hints: 数组，每项 {path, level, quote, scope}。path 只能取：${RECOGNITION_PATHS.join('、')}；`,
    `  level 只能取：${RECOGNITION_LEVELS.join('、')}；scope 为岗位或方向的字符串数组，正文没提就给空数组。`,
    '  只有正文明确写了「获奖可获得保研加分」「优胜者直通终面」这类内容才能给，',
    '  不要因为主办方是大公司就推断企业认可度高。',
    'registration_organization: {value, quote} 或 null —— 报名由谁组织，按正文原话判断，',
    '  例如需先校内选拔、学校统一报名、自行报名。',
    'missing: 字符串数组 —— 正文里没有写到、因此无法抽取的关键项。',
    '',
    contestName ? `赛事名称（仅供定位，不可作为证据）：${contestName}` : '',
    '页面正文：',
    pageText,
  ].filter(Boolean).join('\n');
}

// 逐字回查每条 quote，丢掉对不上的。返回保留项和被丢弃项，两者都要能被人看到。
function verifyAgainstSource(parsed, sourceText) {
  const dropped = [];
  const keepWithQuote = (item, label) => {
    if (!item || typeof item !== 'object') return null;
    if (quoteAppearsInSource(item.quote, sourceText)) return item;
    dropped.push({ field:label, value:item.value ?? item.signal ?? item.path ?? '', quote:String(item.quote || '').slice(0, 120) });
    return null;
  };

  const organizer = keepWithQuote(parsed.organizer, 'organizer');
  const registrationOrganization = keepWithQuote(parsed.registration_organization, 'registration_organization');

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

async function extractFromDetailPage(url, request, { contestName = '', chatTimeoutMs, maxTokens } = {}) {
  const config = readAiConfig();
  if (!config.apiKey) throw new Error('ai_api_key_not_configured');

  const page = await fetchDetailPage(url, request);
  if (page.status !== 'ok' || !page.text) {
    // 抓不到页面时不调模型：没有正文，任何抽取都只能是编造。
    return { ok:false, status:page.status, url, promptVersion:PROMPT_VERSION, error:page.error || null };
  }

  const send = resolveRequest(request);
  const messages = [{ role:'user', content:buildExtractPrompt(page.text, contestName) }];
  let options = {
    useJsonSchema:false, // 抽取结果是嵌套结构，直接用 json_object 更稳
    includeTemperature:true,
    chatTimeoutMs:Number(chatTimeoutMs) > 0 ? Number(chatTimeoutMs) : DEFAULT_CHAT_TIMEOUT_MS,
    maxTokens:Number(maxTokens) > 0 ? Number(maxTokens) : DEFAULT_MAX_TOKENS,
  };

  let attempt = await callChatCompletion(send, config, messages, options);
  while (!attempt.ok) {
    const next = adjustRequestOptions(attempt.status, attempt.raw, options);
    if (!next) throw new Error(`ai_extract_failed_${attempt.status}:${String(attempt.raw).slice(0, 200)}`);
    options = { ...options, ...next };
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
    extracted:verified,
    suggestions:toFieldSuggestions(verified, url),
    droppedCount:verified.dropped.length,
    // 抽取只提建议，不写库：发布与否由人决定。
    applied:false,
  };
}

module.exports = {
  PROMPT_VERSION, PAGE_TEXT_LIMIT, MIN_QUOTE_LENGTH, MAX_QUOTE_LENGTH,
  buildExtractPrompt, extractFromDetailPage, fetchDetailPage,
  normalizeForQuoteMatch, quoteAppearsInSource, toFieldSuggestions, verifyAgainstSource,
};
