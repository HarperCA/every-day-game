const { nodeFetch } = require('./httpClient');
const { isAllowed } = require('./robots');
const { reasoningFromPayload, reportReasoning, thinkingEnabled, withReasoningLanguage } = require('./aiReasoning');

const PROMPT_VERSION = 'competition-review-kimi-v2';
const FIELD_VERIFICATION_PROMPT_VERSION = 'competition-field-verify-v3-entry-stage';
// 跟小程序端专业筛选用的十三类（apps/miniprogram/services/filterOptions.ts 的 PROFESSION_CATEGORIES）保持一致，
// 不是随口列的示例；tests/miniprogram-shared.test.mjs 保证两边一致。
const PROFESSION_TAXONOMY = [
  '综合/不限专业', '计算机与AI', '电子信息', '经管与商科', '生物与医药',
  '机械与自动化', '数学与统计', '材料与化工', '能源与环境', '设计与艺术',
  '人文与法学', '外语与教育', '建筑与土木',
];
const DEFAULT_MODEL = 'kimi-for-coding';
const DEFAULT_BASE_URL = 'https://api.kimi.com/coding/v1';
const EVIDENCE_TIMEOUT_MS = 5000;
const ROBOTS_TIMEOUT_MS = 3000;
// 诚实标识来源和用途，便于站方识别与联系，不伪装成浏览器。
const USER_AGENT = 'competition-review/1.0 (+admin source verification; contact via site owner)';
// 正文越长模型生成越慢，而云函数只有 60 秒。8000 字符足够覆盖报名通知正文。
const EVIDENCE_TEXT_LIMIT = 8000;
// 图片必须内联成 base64（远程 URL 被 provider 拒绝），base64 会膨胀约 1/3，
// 加上云函数 60 秒预算，超过这个大小的图不值得带上。
const MAX_INLINE_IMAGE_BYTES = 1500000;
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

// 新候选入库/已发布赛事每周复核共用同一套"三项核验"：名称、报名时间、
// 报名/详情链接是否与来源一致。三项全过是自动发布（或维持已发布不动）的
// 唯一依据，所以要求模型对每一项给出明确的 true/false，而不是笼统结论。
//
// 报名时间拆成 start/end 两个独立布尔值而不是一个 registration_time_correct——
// 实测（2026-09-19）在 json_schema 模式不可用、退化成 json_object 时，模型会
// 自己"脑补"成更自然的 registration_start_correct/registration_end_correct，
// 而不是提示词里写的名字。与其硬掰模型的自然倾向，不如让 schema 顺着它。
//
// professions 不算三项之一（用户只要求核这三项），但发布/公开缓存两处
// 都硬性要求专业标签非空，机制上少不了，所以搭这次调用一并问出来；
// 拿不准时 professions_confident 给 false，调用方据此转人工，不强行打标。
//
// 报名开始/截止时间不是简单的对/错，是三选一：来源明确写了且跟记录一致
// （confirmed_correct）、来源压根没提这个日期（not_specified——不是记录错了，
// 是官方还没公布，属于"时间待公布"这个本来就存在的合法状态，不该拿来当
// 发布的拦路虎）、来源写了但跟记录对不上（incorrect，需要修正值）。
// 名称和链接没有"没提到"这种中间态，继续用简单的对/错布尔值。
const DATE_STATUS_VALUES = ['confirmed_correct', 'not_specified', 'incorrect'];

// 来源性质：学校转发或校内通知里的“校内报名截止”不是赛事本身的时间（2026-09-29 误归档 8 条的原因）。
const SOURCE_SCOPES = ['official', 'school_notice', 'unclear'];

const fieldVerificationSchema = {
  type:'object', additionalProperties:false,
  required:[
    'name_correct', 'name_correction',
    'registration_start_status', 'registration_start_correction',
    'registration_end_status', 'registration_end_correction',
    'registration_url_correct', 'registration_url_correction',
    'professions', 'professions_confident',
    'source_scope', 'summary',
  ],
  properties:{
    name_correct:{ type:'boolean' },
    name_correction:{ type:'string', maxLength:200 },
    registration_start_status:{ type:'string', enum:DATE_STATUS_VALUES },
    registration_start_correction:{ type:'string', maxLength:40 },
    registration_end_status:{ type:'string', enum:DATE_STATUS_VALUES },
    registration_end_correction:{ type:'string', maxLength:40 },
    registration_url_correct:{ type:'boolean' },
    registration_url_correction:{ type:'string', maxLength:2048 },
    professions:{ type:'array', maxItems:5, items:{ type:'string', enum:PROFESSION_TAXONOMY } },
    professions_confident:{ type:'boolean' },
    source_scope:{ type:'string', enum:SOURCE_SCOPES },
    summary:{ type:'string', minLength:1, maxLength:500 },
  },
};

// json_schema 模式不可用时模型只受提示词约束，光靠文字描述字段名不够可靠——
// 实测同一份文字描述换来过 url_correct、registration_url_correct 两种不同
// 拼法。给一个字段名和值都具体的示例，比反复用文字强调更管用。
const FIELD_VERIFICATION_EXAMPLE = JSON.stringify({
  name_correct:true, name_correction:'',
  registration_start_status:'incorrect', registration_start_correction:'2026-10-15',
  registration_end_status:'not_specified', registration_end_correction:'',
  registration_url_correct:true, registration_url_correction:'',
  professions:['计算机与AI'], professions_confident:true,
  source_scope:'official',
  summary:'名称和链接与来源一致，报名开始时间不对已给出修正；来源没写报名截止时间',
});

function buildFieldVerificationPrompt(record, evidence) {
  return [
    '核验以下赛事记录的 3 项内容是否与来源正文一致：名称、报名开始/截止时间、报名或详情链接。',
    '先判断来源性质，填 source_scope：official（赛事主办方、组委会或主管部门发布的通知、官网）、school_notice（学校或学院转发的通知、校内选拔或校赛通知）、unclear（判断不了）。',
    'source_scope=school_notice 时，来源里的“校内报名截止”“校赛时间”等不是赛事本身的时间：报名开始和截止一律填 not_specified，不得判 incorrect；名称以记录为准，不要改成校赛名称。',
    '名称和链接只有"对/不对"两种；报名开始时间和截止时间要从三种状态里选一个：',
    'confirmed_correct（来源明确写了这个日期，且和记录一致）、',
    'not_specified（来源压根没提到这个日期——不是记录错了，是官方还没公布，这不算错误）、',
    'incorrect（来源写了这个日期，但跟记录不一致）。',
    '报名截止：正文没有单独写“报名截止”、但写了收稿截止、作品提交截止、作品报送截止的，仅在提交作品即首次参赛且没有先报名、资格登记或选拔截止时，才可把该日期当报名截止。若存在更早首次报名截止，必须采用首次报名截止；晋级、复赛、决赛材料提交和获奖公示都不能替代首次报名截止。',
    '报名开始和截止必须属于同一届次、同一赛道和同一参赛阶段。不得把省赛开始与国赛截止拼接，也不得把下一届日程填到上一届。多赛道时间不同必须保留范围，不能无说明混成一个日期。',
    'incorrect 时在对应 correction 字段给出你认为正确的值（从来源原文摘取，不要编造）；',
    'confirmed_correct 或 not_specified 时 correction 留空字符串。仅公布日期用 YYYY-MM-DD；明确公布时刻则保留北京时间时刻（ISO 8601 +08:00）。不允许给仅日期的截止时间凭空补零点，官方24点表示次日零点。',
    `另外从以下专业分类里选出最多 5 个适合参赛的方向（只能选列表内的值，拿不准就 professions 留空数组、professions_confident 填 false）：${PROFESSION_TAXONOMY.join('、')}。`,
    '只输出一个 JSON 对象，字段名和下面示例完全一致，不要改名、不要增减字段、不要加解释文字或 Markdown 围栏：',
    FIELD_VERIFICATION_EXAMPLE,
    `赛事记录：${JSON.stringify(compactRecord(record))}`,
    `来源读取结果：${JSON.stringify(evidence.map(item => ({ ...item, imageUrl:undefined })))}`,
  ].join('\n');
}

const FIELD_VERIFICATION_REQUIRED_BOOLEANS = ['name_correct', 'registration_url_correct', 'professions_confident'];
const FIELD_VERIFICATION_REQUIRED_STATUSES = ['registration_start_status', 'registration_end_status'];

function validateFieldVerificationResult(value) {
  if (!value || typeof value !== 'object') throw new Error('ai_field_verification_invalid_result');
  for (const key of FIELD_VERIFICATION_REQUIRED_BOOLEANS) {
    if (typeof value[key] !== 'boolean') throw new Error(`ai_field_verification_invalid_${key}`);
  }
  for (const key of FIELD_VERIFICATION_REQUIRED_STATUSES) {
    if (!DATE_STATUS_VALUES.includes(value[key])) throw new Error(`ai_field_verification_invalid_${key}`);
  }
  if (!Array.isArray(value.professions)) throw new Error('ai_field_verification_invalid_professions');
  // 旧模型或旧响应可能没有这个字段，按“判断不了”处理，不因此判整次核验失败。
  if (!SOURCE_SCOPES.includes(value.source_scope)) value.source_scope = 'unclear';
  return value;
}

// record：candidateToRecord() 产出的草稿，或库里已发布的记录。
// all_correct 由三项各自的布尔值算出来，不采信模型自己给的总览结论——
// 避免"三项都说对，总览却说不对"这种模型自相矛盾时无所适从。
async function runFieldVerification(record, request, { chatTimeoutMs, maxTokens, onReasoning } = {}) {
  const config = readAiConfig();
  if (!config.apiKey) {
    throw new Error('ai_api_key_not_configured:请在云开发控制台的 adminData 云函数环境变量中添加 AI_API_KEY，保存后重新部署云函数');
  }
  const send = resolveRequest(request);
  const evidence = await collectEvidence(record, send);
  const promptText = buildFieldVerificationPrompt(record, evidence);
  const messages = [
    { role:'system', content:'你是严谨的大学生竞赛数据核验助手。不得将推测写成事实，找不到依据就如实填 false / 留空。只输出 JSON，字段名必须和示例一致。' },
    { role:'user', content:promptText },
  ];

  const attempt = await completeWithLearnedOptions(send, config, messages, { useJsonSchema:true, includeTemperature:true, schema:fieldVerificationSchema, chatTimeoutMs, maxTokens });
  if (!attempt.ok) {
    const detail = attempt.payload?.error?.message || String(attempt.raw || '').slice(0, 300) || 'unknown';
    throw new Error(`ai_provider_error:${attempt.status}:${detail}`);
  }
  const choice = attempt.payload?.choices?.[0];
  // 思考过程先记下来：就算这次没给出结论，也要能看到它想到哪一步卡住了
  reportReasoning(onReasoning, { kind:'field_verification', model:config.model, provider:config.provider || 'kimi-code', reasoning:reasoningFromPayload(attempt.payload) });
  if (!String(choice?.message?.content || '').trim()) {
    throw new Error(`ai_field_verification_empty_response:finish_${choice?.finish_reason || 'unknown'}`);
  }
  const result = validateFieldVerificationResult(parseModelJson(choice.message.content));
  // not_specified 不算"没通过"——来源压根没公布这个日期，跟记录里把它留空
  // 是一致的（对应"时间待公布"），不该拦发布；只有 incorrect（来源明确
  // 说了另一个日期）才算真的不一致。
  const dateResolved = status => status === 'confirmed_correct' || status === 'not_specified';
  return {
    ...result,
    summary:typeof result.summary === 'string' ? result.summary : '',
    all_correct:Boolean(result.name_correct && dateResolved(result.registration_start_status) && dateResolved(result.registration_end_status) && result.registration_url_correct),
    provider:config.provider || 'kimi-code',
    model:config.model,
    prompt_version:FIELD_VERIFICATION_PROMPT_VERSION,
    evidence_status:evidence.map(item => ({
      url:item.url, status:item.status, chars:(item.text || '').length,
      ...(item.error ? { error:item.error.slice(0, 120) } : {}),
    })),
    reviewed_at:new Date().toISOString(),
  };
}

// prefix 允许某类任务走另一个供应商。
//
// 为什么需要：Kimi 会员制带 5 小时窗口配额，审核是低频的（每条记录几天一次），
// 窗口够用；但批量抽取是突发的 —— 几百场赛事集中跑，窗口一到批次就断在中间。
// 按量计费的供应商没有窗口限制，正适合这一类。
//
// 未设置带前缀的变量时逐项回退到通用的 AI_*，所以不配就是维持原状。
function readAiConfig(env = process.env, prefix = '') {
  const pick = (name, fallback) => String(env[`${prefix}${name}`] || env[name] || fallback || '').trim();
  const baseUrl = pick('AI_BASE_URL', DEFAULT_BASE_URL).replace(/\/+$/, '');
  const ownKey = prefix ? String(env[`${prefix}AI_API_KEY`] || '').trim() : '';
  const ownBaseUrl = prefix ? String(env[`${prefix}AI_BASE_URL`] || '').trim().replace(/\/+$/, '') : '';
  // 指定了另一个服务地址却没给对应的密钥时，逐项回退会把原供应商的密钥
  // 发到新地址去 —— 那等于把密钥泄露给第三方。这种配置一律视为未配置。
  if (prefix && ownBaseUrl && ownBaseUrl !== String(env.AI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '') && !ownKey) {
    return { provider:pick('AI_PROVIDER', 'kimi-code'), apiKey:'', model:pick('AI_MODEL', DEFAULT_MODEL), baseUrl, keyMissingForOwnBaseUrl:true };
  }
  return {
    provider:pick('AI_PROVIDER', 'kimi-code'),
    apiKey:pick('AI_API_KEY', ''),
    model:pick('AI_MODEL', DEFAULT_MODEL),
    baseUrl,
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
    // 批量抽取可以指向另一个供应商；没配 EXTRACT_* 时这里会与上面完全一致。
    extract:(() => {
      const extractConfig = readAiConfig(env, 'EXTRACT_');
      return {
        provider:extractConfig.provider,
        model:extractConfig.model,
        baseUrl:extractConfig.baseUrl,
        apiKeyConfigured:extractConfig.apiKey.length > 0,
        apiKeyLength:extractConfig.apiKey.length,
        // 为真说明抽取和审核共用同一套配置，没有单独指定供应商
        sharesReviewProvider:extractConfig.baseUrl === config.baseUrl && extractConfig.apiKey === config.apiKey,
        // 为真表示配错了：指向了另一个服务地址却没给对应密钥，抽取会拒绝运行
        keyMissingForOwnBaseUrl:Boolean(extractConfig.keyMissingForOwnBaseUrl),
        configuredEnvKeys:AI_ENV_KEYS.map(key => `EXTRACT_${key}`).filter(key => String(env[key] || '').trim().length > 0),
      };
    })(),
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

// 页面里的文件链接（2026-10-10）：很多比赛的章程、通知是 PDF/Word 附件，页面上只有“在线浏览”“下载pdf”“附件”这样的按钮，
// 或者把 PDF 嵌在页面框里（iframe）。原先转文字时把链接地址全去掉了，代理看得到“下载pdf”几个字却不知道链接在哪，没法点进去
// （“外教社杯”章程、生命科学竞赛通知都是这样）。现在把这类链接整理出来附在正文后面，相对地址补全成完整网址。
const FILE_LINK_RE = /\.(?:pdf|docx?|xlsx?|wps)(?:[?#]|$)/i;
const FILE_TEXT_RE = /附件|下载|在线浏览|查看原文|全文|章程|通知文件|PDF/i;
function pageFileLinks(html, baseUrl) {
  const raw = String(html || '');
  const links = [];
  const clean = value => String(value || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  const add = (href, label, isFile) => {
    let url;
    try { url = new URL(String(href || '').replace(/&amp;/gi, '&').trim(), baseUrl).href.replace(/#.*$/, ''); } catch { return; }
    if (!/^https?:/i.test(url) || links.some(item => item.url === url)) return;
    links.push({ url, label:clean(label).slice(0, 80), isFile });
  };
  for (const match of raw.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = clean(match[2]);
    const isFile = FILE_LINK_RE.test(match[1]);
    if (!isFile && !FILE_TEXT_RE.test(label)) continue;
    // 只写“在线浏览”“下载”的按钮，带上它前面那一行的标题（如“第九届……”），代理才分得清是哪一份
    const before = clean(raw.slice(Math.max(0, match.index - 600), match.index).replace(/^[^<]*>/, ''))
      .replace(/在线浏览|下载\s*pdf|下载/gi, ' ').replace(/\s+/g, ' ').trim().slice(-40);
    add(match[1], label.length <= 6 && before ? `${before} ${label}` : label, isFile);
  }
  for (const match of raw.matchAll(/<(?:iframe|embed)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) add(match[1], '页面嵌入的文件', true);
  for (const match of raw.matchAll(/<object\b[^>]*\bdata\s*=\s*["']([^"']+)["']/gi)) add(match[1], '页面嵌入的文件', true);
  // 真正的文件链接排前面，导航栏里“章程”“下载”这类栏目链接排后面
  return [...links.filter(item => item.isFile), ...links.filter(item => !item.isFile)].slice(0, 20);
}

function htmlPageText(html, baseUrl) {
  const links = baseUrl ? pageFileLinks(html, baseUrl) : [];
  const text = htmlToText(html);
  return links.length ? `${text}\n【页面里的文件链接，可用 fetch_url 打开】\n${links.map(item => `- ${item.label || '链接'}：${item.url}`).join('\n')}` : text;
}

// PDF 抽文字（2026-10-10）：原先 PDF 当网页读，交给 Kimi 的是 %PDF-1.7 开头的原始字节。
// 用夜间抓取已在用的 pdf-parse；后台函数目录里没装，按服务器上的位置去找（找不到就如实标为读不了，不硬读）。
const PDF_TEXT_LIMIT = 24000;
function loadPdfParse() {
  const path = require('node:path');
  for (const candidate of [process.env.PDF_PARSE_PATH, 'pdf-parse/lib/pdf-parse.js',
    path.join(__dirname, '../../crawler/node_modules/pdf-parse/lib/pdf-parse.js'), path.join(__dirname, '../crawler/node_modules/pdf-parse/lib/pdf-parse.js'),
    path.join(__dirname, '../../../../scripts/crawler/node_modules/pdf-parse/lib/pdf-parse.js')].filter(Boolean)) { // 最后一个是本地仓库
    try { return require(candidate); } catch (_error) { /* 换下一个位置 */ }
  }
  return null;
}
async function pdfToEvidence(url, buffer, extra = {}) {
  const parse = loadPdfParse();
  if (!parse) return { url, status:'pdf_parser_missing', text:'', ...extra };
  try {
    const text = String((await parse(buffer)).text || '').replace(/\s+/g, ' ').trim();
    return text ? { url, status:'reachable', format:'pdf', text:text.slice(0, PDF_TEXT_LIMIT), ...extra } : { url, status:'pdf_no_text', text:'', ...extra };
  } catch (error) {
    return { url, status:'pdf_unreadable', text:'', error:String(error?.message || error).slice(0, 200), ...extra };
  }
}
const isPdf = (contentType, url, head) => /pdf/i.test(contentType) || /\.pdf(?:[?#]|$)/i.test(url) || head === '%PDF';

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

// 天池详情页是前后端分离的，直接抓页面只拿得到导航栏和页脚这层空壳
// （实测 2026-09-19：三项核验遇到天池链接系统性失败，全都是这个原因）。
// scripts/server/run-extract.mjs 的批量抽取早就用这个接口绕过去了，
// 这里补上同一个办法，两条抓取路径不再各修各的。
const TIANCHI_ENTRANCE_RE = /tianchi\.aliyun\.com\/competition\/entrance\/(\d+)/;

async function fetchTianchiRaceText(send, raceId) {
  const response = await send(
    `https://tianchi.aliyun.com/v3/proxy/competition/api/race/getDetail?raceId=${raceId}`,
    { redirect:'follow', signal:timeoutSignal(EVIDENCE_TIMEOUT_MS), timeoutMs:EVIDENCE_TIMEOUT_MS, headers:{ 'User-Agent':USER_AGENT } },
  );
  if (!response.ok) return '';
  const race = (await response.json())?.data?.race || {};
  return [race.name, race.introduction, race.rule, race.reward, race.currentSeason?.rule, race.currentSeason?.reward]
    .filter(value => typeof value === 'string').join('\n');
}

// 单个 URL 的抓取逻辑——先查 robots.txt 再抓正文，抽出来是因为
// runCompetitionAiReviewAgentic 的工具执行器要复用同一套合规检查，
// 不能因为是模型主动要求的链接就绕开 robots.txt。
// 直接取不到（连不上、超时、403）时改走国内中转（pageRelayClient.js）；中转取到的内容照常转成正文。
async function fetchEvidenceUrl(send, url, robotsCache) {
  const direct = await fetchEvidenceUrlDirect(send, url, robotsCache);
  const { shouldRelay, relayFetch } = require('./pageRelayClient');
  if (!shouldRelay(direct.status)) return direct;
  const relayed = await relayFetch(url);
  if (relayed.status !== 'ok' || !relayed.buffer) return { ...direct, relayStatus:relayed.status };
  if (isPdf(relayed.contentType, url, relayed.buffer.subarray(0, 4).toString('latin1'))) return pdfToEvidence(url, relayed.buffer, { via:'relay', tlsUnverified:relayed.tlsUnverified });
  if (/^image\//i.test(relayed.contentType) || /msword|officedocument/i.test(relayed.contentType)) return { ...direct, relayStatus:`relay_${relayed.contentType.split(';')[0]}` };
  return { url, status:'reachable', via:'relay', tlsUnverified:relayed.tlsUnverified, text:htmlPageText(relayed.buffer.toString('utf8'), url) };
}

async function fetchEvidenceUrlDirect(send, url, robotsCache) {
  try {
    const tianchi = TIANCHI_ENTRANCE_RE.exec(url);
    if (tianchi) {
      const text = await fetchTianchiRaceText(send, tianchi[1]);
      return text ? { url, status:'reachable', text:htmlToText(text) } : { url, status:'tianchi_empty', text:'' };
    }
    const target = new URL(url);
    const robots = await loadRobots(send, target.origin, robotsCache);
    if (robots && !isAllowed(robots, USER_AGENT, target.pathname)) {
      return { url, status:'blocked_by_robots', text:'' };
    }
    const response = await send(url, { redirect:'follow', signal:timeoutSignal(EVIDENCE_TIMEOUT_MS), timeoutMs:EVIDENCE_TIMEOUT_MS, headers:{ 'User-Agent':USER_AGENT } });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) return { url, status:`http_${response.status}`, text:'' };
    // 实测：Kimi 端点拒绝远程图片 URL（400 unsupported image url），必须内联 base64。
    // 这条多模态分支此前从未被触发过，所以这个问题一直没暴露。
    if (/^image\/(jpeg|png|gif|webp)/i.test(contentType)) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_INLINE_IMAGE_BYTES) {
        return { url, status:'image_too_large', text:'', bytes:buffer.length };
      }
      const mime = contentType.split(';')[0].trim();
      return { url, status:'image', bytes:buffer.length, imageUrl:`data:${mime};base64,${buffer.toString('base64')}` };
    }
    const buffer = typeof response.arrayBuffer === 'function' ? Buffer.from(await response.arrayBuffer()) : Buffer.from(await response.text(), 'utf8');
    if (isPdf(contentType, response.url || url, buffer.subarray(0, 4).toString('latin1'))) return pdfToEvidence(url, buffer);
    // Word 等二进制文档还读不了：如实标出来，不把乱码交给 Kimi
    if (/msword|officedocument|octet-stream/i.test(contentType) && !/^\s*</.test(buffer.subarray(0, 200).toString('utf8'))) return { url, status:'document_unsupported', text:'', contentType:contentType.split(';')[0] };
    return { url, status:'reachable', text:htmlPageText(buffer.toString('utf8'), response.url || url) };
  } catch (error) {
    return { url, status:'unreachable', text:'', error:String(error?.message || error).slice(0,300) };
  }
}

async function collectEvidence(record, request) {
  const send = resolveRequest(request);
  // 官方来源先读（2026-10-09）：原先只按顺序读前 3 个，代理把省教育厅通知排在第 5，
  // 复核没读到，只看到学校转发，判“不是官方来源”，把真比赛删了
  const official = source => source.is_official === true && source.validity_status !== 'invalid';
  const sources = [...(record.sources || []).filter(official), ...(record.sources || []).filter(source => !official(source))];
  const uniqueUrls = [...new Set(sources.map(source => source.url).filter(url => /^https?:\/\//i.test(url)))].slice(0, 5);
  const robotsCache = new Map();
  return Promise.all(uniqueUrls.map(url => fetchEvidenceUrl(send, url, robotsCache)));
}

function validateResult(value) {
  if (!value || typeof value !== 'object') throw new Error('ai_review_invalid_result');
  if (!['recommend_approve','needs_changes','insufficient_evidence'].includes(value.decision)) throw new Error('ai_review_invalid_decision');
  if (!['low','medium','high'].includes(value.risk_level)) throw new Error('ai_review_invalid_risk');
  if (typeof value.summary !== 'string' || value.summary.trim().length < 5) throw new Error('ai_review_invalid_summary');
  if (!Array.isArray(value.issues) || !Array.isArray(value.evidence_refs)) {
    throw new Error('Kimi返回格式不完整：issues和evidence_refs必须是数组，审核结果未采用');
  }
  return value;
}

// 模型常把 JSON 包在 ```json 围栏里，直接 JSON.parse 会抛错。
// 扫出第一个大括号配平的 JSON 对象。
//
// 不能用 lastIndexOf('}')：模型在 JSON 之后再跟一段说明、或者一口气返回
// 两个对象时，末尾那个大括号属于后面的内容，切出来的片段必定解析失败。
// 实测 deepseek-flash 就这样返回过，报 "Unexpected non-whitespace character
// after JSON at position 24"。计数时要跳过字符串内部的大括号和转义。
function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const character = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

function parseModelJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('ai_review_empty_response');
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(unfenced);
  } catch (error) {
    const candidate = extractFirstJsonObject(unfenced);
    if (!candidate) throw new Error(`ai_review_unparsable_response:${unfenced.slice(0, 200)}`);
    return JSON.parse(candidate);
  }
}

// schema 必须跟调用方实际要的结构一致——之前这里硬编码成 resultSchema，
// 三项核验（字段完全不同）请求 json_schema 模式时会被套上错误的结构，
// 只是恰好被"该模式当前不可用"的 400 掩盖了，没有立刻暴露。
function buildResponseFormat(useJsonSchema, schema = resultSchema) {
  return useJsonSchema
    ? { type:'json_schema', json_schema:{ name:'competition_ai_review', strict:true, schema } }
    : { type:'json_object' };
}

const DEFAULT_REQUEST_OPTIONS = { useJsonSchema:true, includeTemperature:true };

// DeepSeek 的思考模式默认打开且 effort 默认 high。原先对它显式关掉：思考会先吃掉 max_tokens，
// 实测 5 条里有 2 条因此返回空 content（ai_extract_empty_response）。
// 2026-09-30 测试阶段按用户要求打开（aiReasoning.js 的 thinkingEnabled，环境变量 AI_THINKING=off 可恢复关闭），
// 调用方相应放宽了 max_tokens。这个参数其他供应商不认识，只在识别出 DeepSeek 时才带上。
function supportsThinkingToggle(baseUrl) {
  return /deepseek/i.test(String(baseUrl || ''));
}

function buildRequestBody(config, messages, options) {
  // 所有调用都要求模型用中文思考，思考过程存下来给人看（aiReasoning.js）
  const body = { model:config.model, messages:withReasoningLanguage(messages), response_format:buildResponseFormat(options.useJsonSchema, options.schema) };
  // kimi-for-coding 只接受 temperature=1，省略该字段等同于用模型默认值。
  if (options.includeTemperature) body.temperature = 0.1;
  // 生成长度是这套流程里最主要的耗时来源，云函数只有 60 秒，必须封顶。
  if (Number(options.maxTokens) > 0) body.max_tokens = Number(options.maxTokens);
  // disableThinking === false 表示供应商拒绝了 thinking 参数（见 adjustRequestOptions），那就不带
  if (options.disableThinking !== false && supportsThinkingToggle(config.baseUrl)) {
    body.thinking = { type:thinkingEnabled() ? 'enabled' : 'disabled' };
  }
  return body;
}

// 各家模型对可选参数的支持不一致，按 provider 返回的 4xx 提示逐项降级，而不是一次性放弃。
// 记住每个“接口 + 模型 + 是否要求 JSON 结构”试出来能用的参数组合（进程内，后端常驻所以长期有效）。
// 2026-09-29 起：Kimi Code 接口不接受 temperature=0.1、也不支持 JSON 结构约束，
// 原先每次调用都从头试——先两次 400 再成功，白白多花两次请求（Kimi 控制台里每 5 分钟两条 400）。
const learnedRequestOptions = new Map();
// 学到的参数只在内存里，后端一重启就清空，重启后第一次审核又会先吃两条 400
// （Kimi 控制台 2026-09-29 23:10 那两条就是 14:09 重启后的第一次审核）。
// Kimi 会员通道不接受 temperature=0.1 和 JSON 结构约束已经确定，直接从这组参数起步。
function knownProviderOptions(config) {
  if (/api\.kimi\.com\/coding/i.test(String(config.baseUrl || ''))) return { includeTemperature:false, useJsonSchema:false };
  return {};
}
const learnedKey = (config, options) => `${config.baseUrl}|${config.model}|${options.schema ? 'schema' : 'plain'}`;

async function completeWithLearnedOptions(send, config, messages, baseOptions) {
  const key = learnedKey(config, baseOptions);
  let options = { ...baseOptions, ...knownProviderOptions(config), ...(learnedRequestOptions.get(key) || {}) };
  let attempt = await callChatCompletion(send, config, messages, options);
  for (let retry = 0; retry < 2 && !attempt.ok; retry += 1) {
    const next = adjustRequestOptions(attempt.status, attempt.raw, options);
    if (!next) break;
    options = next;
    attempt = await callChatCompletion(send, config, messages, options);
  }
  if (attempt.ok) {
    learnedRequestOptions.set(key, { useJsonSchema:options.useJsonSchema, includeTemperature:options.includeTemperature, disableThinking:options.disableThinking });
  }
  // 把实际用上的参数带回去，调用方记录“这次用了什么格式”要用
  return { ...attempt, options };
}

function adjustRequestOptions(status, raw, options) {
  if (status !== 400 && status !== 404 && status !== 422) return null;
  const message = String(raw || '');
  if (options.disableThinking !== false && /thinking|reasoning/i.test(message)) return { ...options, disableThinking:false };
  if (options.includeTemperature && /temperature/i.test(message)) return { ...options, includeTemperature:false };
  if (options.useJsonSchema && /response_format|json_schema|schema|not support|unsupported/i.test(message)) return { ...options, useJsonSchema:false };
  return null;
}

async function callChatCompletion(request, config, messages, options) {
  // 0 表示自建服务器不再施加模型调用时限；未传值时保留旧运行环境的默认值。
  const chatTimeoutMs = options.chatTimeoutMs === 0 ? 0 : Number(options.chatTimeoutMs) > 0 ? Number(options.chatTimeoutMs) : CHAT_TIMEOUT_MS;
  const response = await request(`${config.baseUrl}/chat/completions`, {
    method:'POST',
    headers:{ Authorization:`Bearer ${config.apiKey}`, 'Content-Type':'application/json' },
    body:JSON.stringify(buildRequestBody(config, messages, options)),
    ...(chatTimeoutMs ? { signal:timeoutSignal(chatTimeoutMs), timeoutMs:chatTimeoutMs } : {}),
  });
  const raw = await response.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch (_ignored) { /* provider 也可能返回非 JSON 的错误页 */ }
  return { ok:response.ok, status:response.status, payload, raw };
}

function buildPrompt(record, evidence, concise = false) {
  return [
    '审核以下赛事记录。只能依据提供的来源正文或图片作判断；证据不足必须选择 insufficient_evidence。',
    '第一步必须判断记录是否代表一场可以独立收录的比赛。标题为清单、目录、栏目或学校获奖新闻的，即使提到真实比赛，也不能把这篇文章当成比赛记录。',
    // 2026-09-29：原先只问“是不是独立赛事”，来源是学校转发通知时，真实的省赛、全国赛被判成下级选拔。
    // 现拆成两件事分别回答：记录本身是不是下级赛事（event_identity）、来源是不是官方原文（source_quality）。
    '判断赛事身份时分两件事，分别回答。',
    '（一）记录本身是不是下级赛事：只看记录的 name 和主办方指的是哪场比赛，不看来源文章的性质。name 本身就是某项赛事的赛区初赛、分区赛、校赛、院赛、校内选拔、承办校选拔或单校推荐环节的，属于下级选拔：选择 needs_changes、risk_level=high，issues 中使用 field=event_identity，finding 写“下级选拔/赛道，不是独立赛事”，recommendation 写“撤销独立记录并关联上级赛事：上级赛事名称”。',
    '赛项、专项赛、赛道：来源显示它有自己独立的报名入口或报名时间的，可以作为独立记录收录，不算下级选拔；只是同一次报名下的分组或方向、没有单独报名的，才按下级选拔处理。',
    '（二）来源是不是这场比赛的官方原文：来源是学校或学院转发的通知、校内选拔或校赛通知、新闻报道、第三方汇总时，不能据此判定记录是下级赛事。此时 issues 中使用 field=source_quality，finding 写“来源不是赛事官方原文，需补官方来源”并注明来源类型，risk_level 至少 medium；来源里的校内报名时间、校赛安排不是赛事本身的时间，不得据此判定记录日期错误。',
    '例：记录“安徽省大学生创意设计大赛”、来源是某学院《校赛暨省赛选拔赛通知》→ 省赛本身是独立赛事，只报 source_quality；记录“全国大学生数学竞赛北京赛区初赛”→ 名称本身是赛区初赛，报 event_identity。',
    '确认是误收时选择 needs_changes、risk_level=high，在 issues 中使用 field=event_identity，明确说明“非赛事条目，需隔离为线索”。标题已能确认是清单时，不要仅因正文不可读取就漏掉这个问题。',
    '只有具体比赛身份成立后才核对大学生资格与专业任务；缺少原文依据不得建议通过。缺少日期不等于官方宣布时间待公布。',
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

// 探测当前配置的模型是否真的接受图片输入。
// 审核代码里一直有多模态分支，但 30 场赛事的来源全是网页，这条路从未被触发过，
// 所以「能不能看图」此前是未知而不是「能」。这里用最小请求把它测出来。
async function probeImageCapability(imageUrl, request, { chatTimeoutMs = 40000 } = {}) {
  const config = readAiConfig();
  if (!config.apiKey) throw new Error('ai_api_key_not_configured');
  const send = resolveRequest(request);
  const messages = [{
    role:'user',
    content:[
      { type:'text', text:'这张图里有文字吗？如果有，原样写出你能看清的文字；如果看不到图片，直接回答「无法看到图片」。' },
      { type:'image_url', image_url:{ url:imageUrl } },
    ],
  }];
  const response = await send(`${config.baseUrl}/chat/completions`, {
    method:'POST',
    headers:{ Authorization:`Bearer ${config.apiKey}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ model:config.model, messages, max_tokens:400 }),
    signal:timeoutSignal(chatTimeoutMs),
    timeoutMs:chatTimeoutMs,
  });
  const raw = await response.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch (_ignored) { /* provider 可能返回非 JSON 错误页 */ }
  return {
    imageUrl,
    model:config.model,
    baseUrl:config.baseUrl,
    httpStatus:response.status,
    ok:response.ok,
    error:response.ok ? null : (payload?.error?.message || String(raw).slice(0, 300)),
    answer:payload?.choices?.[0]?.message?.content || null,
    finishReason:payload?.choices?.[0]?.finish_reason || null,
  };
}

async function runCompetitionAiReview(record, request, { chatTimeoutMs, maxTokens, concise = false, onReasoning } = {}) {
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

  const attempt = await completeWithLearnedOptions(send, config, messages, { ...DEFAULT_REQUEST_OPTIONS, chatTimeoutMs, maxTokens });
  if (!attempt.ok) {
    const detail = attempt.payload?.error?.message || String(attempt.raw || '').slice(0, 300) || 'unknown';
    throw new Error(`ai_provider_error:${attempt.status}:${detail}`);
  }

  const choice = attempt.payload?.choices?.[0];
  reportReasoning(onReasoning, { kind:'ai_review', model:config.model, provider:config.provider || 'kimi-code', reasoning:reasoningFromPayload(attempt.payload) });
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
    // 原先这里引用了一个本函数里没有定义的 options，记下来的格式不准；改用实际发出去的参数
    response_format:attempt.options?.useJsonSchema ? 'json_schema' : 'json_object',
    temperature_sent:Boolean(attempt.options?.includeTemperature),
    reviewed_at:new Date().toISOString(),
    response_id:attempt.payload?.id || null,
  };
}

// —— 让模型自己决定要不要再看别的链接 ——
//
// 上面 runCompetitionAiReview 是"一问一答"：我们把证据一次性喂给模型，
// 它给一个结论，结束。这里是"多轮工具调用"：模型看完我们给的证据后，
// 如果觉得不够，可以自己决定调用 fetch 工具再看一个链接，看完继续推理，
// 可能再调用几次，才给出最终结论。
//
// 工具是我们自己定义、自己执行的（FETCH_TOOL_DECLARATION + fetchEvidenceUrl），
// 不是接一个新的账号体系去用别人托管的工具——tool_calls 本身是 Kimi 模型的
// 通用能力，不是某个特定平台产品独有的，用现有 readAiConfig() 读到的那把
// 密钥（不管是 Kimi 编程订阅还是 DeepSeek）就够，不需要额外开 Moonshot
// 开发者平台账号。而且这样"谁在访问目标网站"这件事上更干净：始终是我们
// 自己已经验证过 robots.txt 合规的那套代码在抓，不会因为换了个"官方工具"
// 就把访问权交给别人的爬虫、看不见它遵不遵守 robots.txt。
//
// 每次调用都要计费，所以设了轮数上限（MAX_AGENTIC_TOOL_TURNS），到上限后
// 不再提供工具，逼它基于已有信息收尾——不能无限调用下去。
const AGENTIC_PROMPT_VERSION = 'competition-review-agentic-v2-self-tool';
const MAX_AGENTIC_TOOL_TURNS = 4;

const FETCH_TOOL_DECLARATION = {
  type:'function',
  function:{
    name:'fetch_url',
    description:'读取一个网页的正文内容（会先检查 robots.txt，被禁止的网址会拒绝）。',
    parameters:{ type:'object', properties:{ url:{ type:'string', description:'要读取的完整网址' } }, required:['url'] },
  },
};

async function runCompetitionAiReviewAgentic(record, request, {
  chatTimeoutMs = 60000, maxTokens, maxToolTurns = MAX_AGENTIC_TOOL_TURNS, onReasoning,
} = {}) {
  const config = readAiConfig();
  if (!config.apiKey) {
    throw new Error('ai_api_key_not_configured:请在云开发控制台的 adminData 云函数环境变量中添加 AI_API_KEY，保存后重新部署云函数');
  }
  const send = resolveRequest(request);

  const evidence = await collectEvidence(record, send);
  const robotsCache = new Map();

  const messages = [
    { role:'system', content:'你是严谨的大学生竞赛数据审核助手。不得将推测写成事实，不得代替管理员批准或发布。除了工具调用之外，只输出 JSON，不要加解释文字或 Markdown 围栏。' },
    {
      role:'user',
      content:buildPrompt(record, evidence, false)
        + `\n\n如果以上资料不足以判断，可以调用 fetch_url 工具查看记录中提到、但未直接提供正文的相关链接。`
        + `最多还能调用 ${maxToolTurns} 次；用完仍不够就直接选 insufficient_evidence，不要编造。`,
    },
  ];

  const toolCallLog = [];
  // 多一轮：前 maxToolTurns 轮允许调用工具，最后强制一轮不给工具、
  // 逼它基于已有信息收尾——不能无限循环调用下去。
  for (let turn = 0; turn <= maxToolTurns; turn += 1) {
    const allowTools = turn < maxToolTurns;
    const body = {
      model:config.model, messages:withReasoningLanguage(messages),
      ...(allowTools ? { tools:[FETCH_TOOL_DECLARATION] } : {}),
      // 工具调用轮不强制 JSON 格式（两者同时要求很多供应商不支持）；
      // 确定是最后一轮（没有工具可调）才要求严格 JSON。
      ...(allowTools ? {} : { response_format:buildResponseFormat(true) }),
      ...(Number(maxTokens) > 0 ? { max_tokens:Number(maxTokens) } : {}),
    };
    const response = await send(`${config.baseUrl}/chat/completions`, {
      method:'POST',
      headers:{ Authorization:`Bearer ${config.apiKey}`, 'Content-Type':'application/json' },
      body:JSON.stringify(body),
      signal:timeoutSignal(chatTimeoutMs), timeoutMs:chatTimeoutMs,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`ai_provider_error:${response.status}:${raw.slice(0, 300)}`);
    let payload;
    try { payload = JSON.parse(raw); } catch (error) { throw new Error(`ai_review_unparsable_response:${raw.slice(0, 200)}`); }
    const message = payload?.choices?.[0]?.message;
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    reportReasoning(onReasoning, { kind:'ai_review_agentic', model:config.model, provider:config.provider || 'kimi-code', reasoning:reasoningFromPayload(payload), extra:{ turn:turn + 1, toolCalls:toolCalls.length } });

    if (!toolCalls.length) {
      if (!String(message?.content || '').trim()) throw new Error('ai_review_empty_response');
      const result = validateResult(parseModelJson(message.content));
      return {
        ...result,
        provider:config.provider || 'kimi-code', model:config.model, prompt_version:AGENTIC_PROMPT_VERSION,
        evidence_status:evidence.map(item => ({
          url:item.url, status:item.status, chars:(item.text || '').length,
          ...(item.error ? { error:item.error.slice(0, 120) } : {}),
        })),
        // 每次工具调用都留痕——事后要能核对模型到底多看了哪些链接、看没看成功。
        tool_calls:toolCallLog,
        reviewed_at:new Date().toISOString(),
      };
    }

    // Kimi、DeepSeek 的文档都要求：带工具的多轮对话里，上一轮的思考过程要原样回传，否则报 400
    messages.push({ role:'assistant', content:message.content ?? '', tool_calls:message.tool_calls, ...(message.reasoning_content ? { reasoning_content:message.reasoning_content } : {}) });
    for (const call of toolCalls) {
      const fn = call.function || {};
      let output;
      try {
        const args = JSON.parse(fn.arguments || '{}');
        // 复用 collectEvidence 同一套抓取逻辑：先查 robots.txt，被禁止就拒绝，
        // 不会因为是模型自己主动要求的链接就绕开这道检查。
        const fetched = await fetchEvidenceUrl(send, String(args.url || ''), robotsCache);
        output = fetched.status === 'reachable' ? fetched.text
          : `无法读取（${fetched.status}）：${fetched.error || '内容为空或被拒绝'}`;
        toolCallLog.push({ name:fn.name, arguments:fn.arguments, url:args.url, status:fetched.status, ok:fetched.status === 'reachable' });
      } catch (error) {
        const message_ = error instanceof Error ? error.message : String(error);
        output = `工具调用失败：${message_}`;
        toolCallLog.push({ name:fn.name, arguments:fn.arguments, ok:false, error:message_ });
      }
      messages.push({ role:'tool', tool_call_id:call.id, content:output });
    }
  }
  // 理论上到不了这里——最后一轮已经不提供工具，模型没有别的选择只能回复内容；
  // 留这行是防御性的，万一某个供应商在没有 tools 字段时仍然尝试 tool_calls。
  throw new Error('ai_review_agentic_max_turns_exceeded');
}

module.exports = {
  USER_AGENT,
  PROFESSION_TAXONOMY,
  supportsThinkingToggle,
  extractFirstJsonObject,
  adjustRequestOptions,
  callChatCompletion,
  loadRobots,
  timeoutSignal,
  aiReviewConfigStatus,
  buildRequestBody,
  buildFieldVerificationPrompt,
  completeWithLearnedOptions,
  resetLearnedRequestOptions:() => learnedRequestOptions.clear(),
  knownProviderOptions,
  buildPrompt,
  collectEvidence,
  compactRecord,
  htmlToText,
  parseModelJson,
  probeImageCapability,
  readAiConfig,
  resolveRequest,
  runCompetitionAiReview,
  runCompetitionAiReviewAgentic,
  runFieldVerification,
  validateFieldVerificationResult,
  fetchEvidenceUrl,
  validateResult,
};
