const { nodeFetch } = require('./httpClient');
const { isAllowed } = require('./robots');

const PROMPT_VERSION = 'competition-review-kimi-v1';
const DEFAULT_MODEL = 'kimi-for-coding';
const DEFAULT_BASE_URL = 'https://api.kimi.com/coding/v1';
const EVIDENCE_TIMEOUT_MS = 5000;
const ROBOTS_TIMEOUT_MS = 3000;
// 诚实标识来源和用途，便于站方识别与联系，不伪装成浏览器。
const USER_AGENT = 'competition-review/1.0 (+admin source verification; contact via site owner)';
// 正文越长模型生成越慢，而云函数只有 60 秒。8000 字符足够覆盖报名通知正文。
const EVIDENCE_TEXT_LIMIT = 8000;
const CHAT_TIMEOUT_MS = 60000;
const AI_ENV_KEYS = ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL', 'AI_REVIEW_CONCURRENCY'];

const resultSchema = {
  type:'object', additionalProperties:false,
  required:['decision','risk_level','summary','issues','evidence_refs'],
  properties:{
    decision:{ enum:['recommend_approve','needs_changes','insufficient_evidence'] },
    risk_level:{ enum:['low','medium','high'] },
    summary:{ type:'string', minLength:5, maxLength:2000 },
    issues:{ type:'array', maxItems:20, items:{
      type:'object', additionalProperties:false,
      required:['field','finding','recommendation','evidence_ref'],
      properties:{
        field:{ type:'string', minLength:1, maxLength:100 },
        finding:{ type:'string', minLength:2, maxLength:1000 },
        recommendation:{ type:'string', minLength:2, maxLength:1000 },
        evidence_ref:{ type:'string', maxLength:2048 },
      },
    } },
    evidence_refs:{ type:'array', maxItems:20, items:{ type:'string', maxLength:2048 } },
  },
};

function readAiConfig(env = process.env) {
  return {
    provider:String(env.AI_PROVIDER || 'kimi-code').trim(),
    apiKey:String(env.AI_API_KEY || '').trim(),
    model:String(env.AI_MODEL || DEFAULT_MODEL).trim(),
    baseUrl:String(env.AI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
  };
}

// 只报告配置是否存在，绝不回传密钥内容；长度用于发现误粘的引号或空格。
function aiReviewConfigStatus(env = process.env, request = globalThis.fetch) {
  const config = readAiConfig(env);
  const rawKey = String(env.AI_API_KEY || '');
  return {
    provider:config.provider,
    model:config.model,
    baseUrl:config.baseUrl,
    apiKeyConfigured:config.apiKey.length > 0,
    apiKeyLength:config.apiKey.length,
    apiKeyHasSurroundingWhitespace:rawKey.length !== rawKey.trim().length,
    apiKeyLooksQuoted:/^["'].*["']$/.test(config.apiKey),
    usingDefaultModel:!String(env.AI_MODEL || '').trim(),
    usingDefaultBaseUrl:!String(env.AI_BASE_URL || '').trim(),
    configuredEnvKeys:AI_ENV_KEYS.filter(key => String(env[key] || '').trim().length > 0),
    nodeVersion:typeof process !== 'undefined' ? process.version : 'unknown',
    fetchAvailable:typeof request === 'function',
    httpClient:typeof request === 'function' ? 'global-fetch' : 'node-https-fallback',
    abortTimeoutAvailable:typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function',
  };
}

// Nodejs16 及以下没有全局 fetch，退回内置 https 实现，不要求改云函数运行时。
function resolveRequest(request) {
  if (typeof request === 'function') return request;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch;
  return nodeFetch;
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  return undefined;
}

function compactRecord(record) {
  return {
    id:record.id, name:record.name, edition_name:record.editionName,
    organizer:record.organizer, participants:record.participants, eligibility:record.eligibility,
    format_and_rules:record.formatAndRules, team_size:record.teamSize,
    participation_format:record.participationFormat, registration_method:record.registrationMethod,
    registration_organization:record.registrationOrganization, registration_url:record.registrationUrl,
    fees:record.fees, fee_type:record.feeType, schedule:record.schedule,
    quality_issues:record.qualityIssues || [],
    sources:(record.sources || []).map(source => ({ url:source.url, source_type:source.source_type, claimed_official:Boolean(source.is_official), current_validity:source.validity_status })),
  };
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;/g, "'").replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ').trim().slice(0, EVIDENCE_TEXT_LIMIT);
}

// 每个来源域名只取一次 robots.txt；取不到按惯例视为允许抓取。
async function loadRobots(send, origin, cache) {
  if (cache.has(origin)) return cache.get(origin);
  const pending = (async () => {
    try {
      const response = await send(`${origin}/robots.txt`, {
        redirect:'follow', signal:timeoutSignal(ROBOTS_TIMEOUT_MS), timeoutMs:ROBOTS_TIMEOUT_MS,
        headers:{ 'User-Agent':USER_AGENT },
      });
      if (!response.ok) return '';
      const contentType = response.headers.get('content-type') || '';
      if (/html/i.test(contentType)) return ''; // 站点用首页兜底 404，不是真的 robots.txt
      return await response.text();
    } catch (_error) {
      return '';
    }
  })();
  cache.set(origin, pending);
  return pending;
}

async function collectEvidence(record, request) {
  const send = resolveRequest(request);
  const uniqueUrls = [...new Set((record.sources || []).map(source => source.url).filter(url => /^https?:\/\//i.test(url)))].slice(0, 3);
  const robotsCache = new Map();
  return Promise.all(uniqueUrls.map(async url => {
    try {
      const target = new URL(url);
      const robots = await loadRobots(send, target.origin, robotsCache);
      if (robots && !isAllowed(robots, USER_AGENT, target.pathname)) {
        return { url, status:'blocked_by_robots', text:'' };
      }
      const response = await send(url, { redirect:'follow', signal:timeoutSignal(EVIDENCE_TIMEOUT_MS), timeoutMs:EVIDENCE_TIMEOUT_MS, headers:{ 'User-Agent':USER_AGENT } });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) return { url, status:`http_${response.status}`, text:'' };
      if (/^image\/(jpeg|png|gif|webp)/i.test(contentType)) return { url, status:'image', imageUrl:url };
      return { url, status:'reachable', text:htmlToText(await response.text()) };
    } catch (error) {
      return { url, status:'unreachable', text:'', error:String(error?.message || error).slice(0,300) };
    }
  }));
}

function validateResult(value) {
  if (!value || typeof value !== 'object') throw new Error('ai_review_invalid_result');
  if (!['recommend_approve','needs_changes','insufficient_evidence'].includes(value.decision)) throw new Error('ai_review_invalid_decision');
  if (!['low','medium','high'].includes(value.risk_level)) throw new Error('ai_review_invalid_risk');
  if (typeof value.summary !== 'string' || value.summary.trim().length < 5) throw new Error('ai_review_invalid_summary');
  if (!Array.isArray(value.issues) || !Array.isArray(value.evidence_refs)) throw new Error('ai_review_invalid_evidence');
  return value;
}

// 模型常把 JSON 包在 ```json 围栏里，直接 JSON.parse 会抛错。
function parseModelJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('ai_review_empty_response');
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(unfenced);
  } catch (error) {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error(`ai_review_unparsable_response:${unfenced.slice(0, 200)}`);
    return JSON.parse(unfenced.slice(start, end + 1));
  }
}

function buildResponseFormat(useJsonSchema) {
  return useJsonSchema
    ? { type:'json_schema', json_schema:{ name:'competition_ai_review', strict:true, schema:resultSchema } }
    : { type:'json_object' };
}

const DEFAULT_REQUEST_OPTIONS = { useJsonSchema:true, includeTemperature:true };

function buildRequestBody(config, messages, options) {
  const body = { model:config.model, messages, response_format:buildResponseFormat(options.useJsonSchema) };
  // kimi-for-coding 只接受 temperature=1，省略该字段等同于用模型默认值。
  if (options.includeTemperature) body.temperature = 0.1;
  // 生成长度是这套流程里最主要的耗时来源，云函数只有 60 秒，必须封顶。
  if (Number(options.maxTokens) > 0) body.max_tokens = Number(options.maxTokens);
  return body;
}

// 各家模型对可选参数的支持不一致，按 provider 返回的 4xx 提示逐项降级，而不是一次性放弃。
function adjustRequestOptions(status, raw, options) {
  if (status !== 400 && status !== 404 && status !== 422) return null;
  const message = String(raw || '');
  if (options.includeTemperature && /temperature/i.test(message)) return { ...options, includeTemperature:false };
  if (options.useJsonSchema && /response_format|json_schema|schema|not support|unsupported/i.test(message)) return { ...options, useJsonSchema:false };
  return null;
}

async function callChatCompletion(request, config, messages, options) {
  const chatTimeoutMs = Number(options.chatTimeoutMs) > 0 ? Number(options.chatTimeoutMs) : CHAT_TIMEOUT_MS;
  const response = await request(`${config.baseUrl}/chat/completions`, {
    method:'POST',
    headers:{ Authorization:`Bearer ${config.apiKey}`, 'Content-Type':'application/json' },
    body:JSON.stringify(buildRequestBody(config, messages, options)),
    signal:timeoutSignal(chatTimeoutMs),
    timeoutMs:chatTimeoutMs,
  });
  const raw = await response.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch (_ignored) { /* provider 也可能返回非 JSON 的错误页 */ }
  return { ok:response.ok, status:response.status, payload, raw };
}

function buildPrompt(record, evidence, concise = false) {
  return [
    '审核以下赛事记录。只能依据提供的来源正文或图片作判断；证据不足必须选择 insufficient_evidence。',
    '核对届次、主办方、报名时间、资格、费用、赛制和报名入口。结果仅供人工复核。',
    // 定时任务受 60 秒云函数上限约束，必须压缩输出长度。
    concise ? 'summary 控制在 150 字以内，issues 最多 5 条，每条 finding 和 recommendation 各不超过 60 字。' : '',
    '只输出一个 JSON 对象，不要加解释文字或 Markdown 围栏。字段要求：',
    'decision 取 recommend_approve | needs_changes | insufficient_evidence；risk_level 取 low | medium | high；',
    'summary 为字符串；issues 为数组，每项含 field、finding、recommendation、evidence_ref；evidence_refs 为字符串数组。',
    `赛事记录：${JSON.stringify(compactRecord(record))}`,
    `来源读取结果：${JSON.stringify(evidence.map(item => ({ ...item, imageUrl:undefined })))}`,
  ].filter(Boolean).join('\n');
}

async function runCompetitionAiReview(record, request, { chatTimeoutMs, maxTokens, concise = false } = {}) {
  const config = readAiConfig();
  if (!config.apiKey) {
    throw new Error('ai_api_key_not_configured:请在云开发控制台的 adminData 云函数环境变量中添加 AI_API_KEY，保存后重新部署云函数');
  }
  const send = resolveRequest(request);

  const evidence = await collectEvidence(record, send);
  const images = evidence.filter(item => item.imageUrl);
  const promptText = buildPrompt(record, evidence, concise);
  // 纯文本模型对数组形式的 content 支持不一致，没有图片时退回普通字符串。
  const userContent = images.length
    ? [{ type:'text', text:promptText }, ...images.map(item => ({ type:'image_url', image_url:{ url:item.imageUrl } }))]
    : promptText;
  const messages = [
    { role:'system', content:'你是严谨的大学生竞赛数据审核助手。不得将推测写成事实，不得代替管理员批准或发布。只输出 JSON。' },
    { role:'user', content:userContent },
  ];

  let options = { ...DEFAULT_REQUEST_OPTIONS, chatTimeoutMs, maxTokens };
  let attempt = await callChatCompletion(send, config, messages, options);
  for (let retry = 0; retry < 2 && !attempt.ok; retry += 1) {
    const next = adjustRequestOptions(attempt.status, attempt.raw, options);
    if (!next) break;
    options = next;
    attempt = await callChatCompletion(send, config, messages, options);
  }
  if (!attempt.ok) {
    const detail = attempt.payload?.error?.message || String(attempt.raw || '').slice(0, 300) || 'unknown';
    throw new Error(`ai_provider_error:${attempt.status}:${detail}`);
  }

  const choice = attempt.payload?.choices?.[0];
  // 内容为空通常是 max_tokens 截断，把 finish_reason 带出来才能判断是截断还是过滤。
  if (!String(choice?.message?.content || '').trim()) {
    throw new Error(`ai_review_empty_response:finish_${choice?.finish_reason || 'unknown'}`);
  }
  const result = validateResult(parseModelJson(choice.message.content));
  return {
    ...result,
    provider:config.provider || 'kimi-code',
    model:config.model,
    prompt_version:PROMPT_VERSION,
    // 记录每个来源实际读到了什么，用于事后核对模型的结论是否真有证据支撑。
    evidence_status:evidence.map(item => ({
      url:item.url,
      status:item.status,
      chars:(item.text || '').length,
      ...(item.error ? { error:item.error.slice(0, 120) } : {}),
    })),
    response_format:options.useJsonSchema ? 'json_schema' : 'json_object',
    temperature_sent:options.includeTemperature,
    reviewed_at:new Date().toISOString(),
    response_id:attempt.payload?.id || null,
  };
}

module.exports = {
  adjustRequestOptions,
  aiReviewConfigStatus,
  buildRequestBody,
  collectEvidence,
  compactRecord,
  htmlToText,
  parseModelJson,
  readAiConfig,
  resolveRequest,
  runCompetitionAiReview,
  validateResult,
};
