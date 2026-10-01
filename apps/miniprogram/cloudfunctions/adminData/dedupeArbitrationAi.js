// 判重拿不准时的 AI 裁决（2026-10-01，用户要求：旧问题让 AI 判断，新的替代旧的）。
//
// 判重是纯规则：名字规范化后一致、标题包含库里赛事名、名字相似……规则能确定的已经确定了
// （网址相同、地区或层级对不上、核心名称不同的直接判新）。剩下两类规则判不好：
//   ① 名字像，但说不清是不是同一场（如“宁波大学××竞赛”和“浙江省××竞赛”）；
//   ② 库里已经有这场比赛，但那条是往届或已归档的旧记录，而新发现的页面可能是新一届
//      （如“中国国际大学生创新大赛(2026)报名通知”对上库里已归档的上一届）。
// 这里把情况讲清楚交给 AI：两边各是什么、库里那条是什么状态、判断的规则，让它判断关系。
//
// 结论只有五种，规则固定（不让 AI 自由发挥）：
//   different_contest   不是同一场比赛        → 当作新比赛继续走流水线
//   new_edition         同一场比赛的新一届    → 当作新比赛继续走；库里那条往届记录会被新的替代
//   same_edition        同一场比赛的同一届    → 重复，不新增
//   lower_level_notice  同一场比赛，但页面是学校/学院/系等下级单位的选拔或转发通知 → 不新增，只作追溯线索
//   unclear             看不出                → 保守跳过
// 把握不到 0.6 的一律按 unclear 处理。
//
// 走 DeepSeek（EXTRACT_ 前缀配置），和批量抽取同一把钥匙；思考过程照常记录（aiReasoning.js）。
const {
  adjustRequestOptions, callChatCompletion, parseModelJson, readAiConfig, resolveRequest,
} = require('./competitionAiReview');
const { reasoningFromPayload, reportReasoning, thinkingEnabled } = require('./aiReasoning');

const EXTRACT_CONFIG_PREFIX = 'EXTRACT_';
const PROMPT_VERSION = 'dedupe-arbitration-v1';
const CHAT_TIMEOUT_MS = thinkingEnabled() ? 180000 : 30000;
const MAX_TOKENS = thinkingEnabled() ? 8000 : 600;
const MIN_CONFIDENCE = 0.6;

const RELATIONS = ['different_contest', 'new_edition', 'same_edition', 'lower_level_notice', 'unclear'];
// 哪些结论会让候选继续走流水线
const PROMOTE = new Set(['different_contest', 'new_edition']);
const RELATION_LABEL = {
  different_contest:'不是同一场比赛', new_edition:'同一场比赛的新一届（新的替代旧的）', same_edition:'同一场比赛的同一届（重复）',
  lower_level_notice:'同一场比赛的下级选拔或转发通知', unclear:'看不出',
};

const judgmentSchema = {
  type:'object', additionalProperties:false,
  required:['relation', 'confidence', 'reason'],
  properties:{
    relation:{ type:'string', enum:RELATIONS },
    confidence:{ type:'number', minimum:0, maximum:1 },
    reason:{ type:'string', minLength:1, maxLength:300 },
    candidate_edition:{ type:'string', maxLength:60 },
  },
};

const clip = (value, n) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, n);

// item：{ candidate:{ name, url, introduction, source }, records:[{ id, name, editionName, editionYear, editionOrdinal, dataStatus, registration_start, registration_end, organizer, sourceUrl }], matchReason }
function buildArbitrationPrompt(item) {
  const candidate = item.candidate || {};
  const records = (item.records || []).slice(0, 4);
  return [
    '你在帮一个“大学生竞赛信息库”判断：新发现的一个网页，和库里已有的比赛，是不是同一场比赛。',
    '这是判重环节，系统规则已经把明显的情况处理掉了，剩下的是规则拿不准的，需要你读懂语义来判断。',
    '',
    '【情况说明】',
    '1. 库里每场比赛按“届”存记录：同一场比赛的不同年份、不同届次是不同的记录。库里那几条可能是往届（已归档、已截止），也可能是当前这一届（审核中、已发布），还可能是被隔离的（以前判为不合格）。',
    '2. 新发现的网页可能是：比赛自己的官网或通知、主办方通知、学校或学院转发的通知（校内选拔、校赛、报名组织）、新闻报道，或者别的比赛。',
    '3. 如果库里只有往届记录，而这个网页是同一场比赛今年或新一届的信息，那就是 new_edition：新的要替代旧的，所以必须当作新一届继续处理，不能当成“已有”丢掉。',
    '',
    '【判断规则】',
    '- 省、市、赛区、全国、国际是不同层级或不同地区：“湖南省××竞赛”和“福建省××竞赛”是两场比赛；“全国××”和“某省××”是两场；某学校自己办的比赛和全国性比赛是两场。',
    '- “××暨××”的联合名称里有两项比赛：只因为包含库里那场的名字，不能说明页面就是那场；页面主体是哪一项就按哪一项判。',
    '- 学校、学院、系发布的“校内选拔赛”“校赛”“院赛”“转发通知”“报名组织”，是上级比赛的下级环节：选 lower_level_notice，不当作新比赛。',
    '- 同一场比赛、同一届（届次或年份相同）：选 same_edition。库里那条是当前这一届，页面只是它的另一个页面。',
    '- 同一场比赛，但页面的届次或年份比库里最新一条更新：选 new_edition。',
    '- 名字再像，只要比赛的主题、层级、地区、主办方对不上，就是 different_contest。',
    '- 资料不够判断就选 unclear，把握（confidence）如实填，不要硬猜。',
    '',
    '【新发现的网页】',
    `标题：${clip(candidate.name, 200)}`,
    `网址：${clip(candidate.url || candidate.detailUrl, 300)}`,
    `来源：${clip(candidate.source, 40)}`,
    `摘要：${clip(candidate.introduction || candidate.description, 700)}`,
    '',
    '【库里已有的相关记录】（规则认为最可能是同一场的）',
    ...records.map((record, index) => `${index + 1}. ${JSON.stringify({
      名称:clip(record.name, 120), 届次:clip(record.editionName, 80), 年份:record.editionYear || '', 状态:record.dataStatus,
      报名开始:clip(record.registration_start, 10), 报名截止:clip(record.registration_end, 10), 主办方:clip(record.organizer, 80), 来源网址:clip(record.sourceUrl, 160),
    })}`),
    `规则为什么把它们挑出来：${clip(item.matchReason, 160)}`,
    '',
    '只输出一个 JSON 对象，不要加解释文字或 Markdown 围栏。字段：',
    `relation 取 ${RELATIONS.join(' | ')}；confidence 取 0 到 1 的小数；reason 用中文一两句话说明依据（引用标题或库里记录里的具体词句）；`,
    'candidate_edition 填页面里的届次或年份（如“第十一届”“2026”），页面里没写就留空字符串。',
  ].join('\n');
}

function validateArbitration(value) {
  if (!value || typeof value !== 'object') throw new Error('ai_dedupe_arbitration_invalid_result');
  if (!RELATIONS.includes(value.relation)) throw new Error('ai_dedupe_arbitration_invalid_relation');
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('ai_dedupe_arbitration_invalid_confidence');
  if (typeof value.reason !== 'string' || !value.reason.trim()) throw new Error('ai_dedupe_arbitration_invalid_reason');
  return { relation:value.relation, confidence, reason:value.reason.trim().slice(0, 300), candidate_edition:clip(value.candidate_edition, 60) };
}

// AI 的结论变成流水线的处理：把握不够一律 unclear；只有 different_contest / new_edition 才继续往下走。
// new_edition 时，库里那些“已归档的往届记录”被新的替代（supersedes）；还在审核或发布中的不动。
function decide(result, records = []) {
  const relation = result.confidence < MIN_CONFIDENCE ? 'unclear' : result.relation;
  const promote = PROMOTE.has(relation);
  const supersedes = relation === 'new_edition' ? records.filter(record => record.dataStatus === 'archived').map(record => record.id) : [];
  return { relation, promote, supersedes, label:RELATION_LABEL[relation] };
}

async function arbitrateDuplicate(item, request, { chatTimeoutMs = CHAT_TIMEOUT_MS, maxTokens = MAX_TOKENS, onReasoning } = {}) {
  const config = readAiConfig(process.env, EXTRACT_CONFIG_PREFIX);
  if (!config.apiKey) throw new Error('ai_api_key_not_configured');
  const send = resolveRequest(request);
  const messages = [
    { role:'system', content:'你是严谨的竞赛数据判重助手。只依据给出的资料判断，资料不足就如实说看不出，不编造。只输出 JSON。' },
    { role:'user', content:buildArbitrationPrompt(item) },
  ];
  let options = { useJsonSchema:true, includeTemperature:true, schema:judgmentSchema, chatTimeoutMs, maxTokens };
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
  reportReasoning(onReasoning, { kind:'dedupe_arbitration', model:config.model, provider:config.provider || 'deepseek', reasoning:reasoningFromPayload(attempt.payload) });
  if (!String(choice?.message?.content || '').trim()) throw new Error(`ai_dedupe_arbitration_empty_response:finish_${choice?.finish_reason || 'unknown'}`);
  const result = validateArbitration(parseModelJson(choice.message.content));
  return { ...result, ...decide(result, item.records), provider:config.provider || 'deepseek', model:config.model, prompt_version:PROMPT_VERSION, reviewed_at:new Date().toISOString() };
}

module.exports = {
  EXTRACT_CONFIG_PREFIX, MIN_CONFIDENCE, PROMPT_VERSION, PROMOTE, RELATIONS, RELATION_LABEL,
  arbitrateDuplicate, buildArbitrationPrompt, decide, validateArbitration,
};
