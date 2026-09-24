// 收录门槛的第二道判断：给 competitionAdmission.js 判成 "review"（证据不足，
// 但也没踩水赛红旗）的候选，送 AI 再读一遍资料给个判断，而不是一律停在
// review 等人工——正则关键词天生只能认"教育部""XX学会"这几种措辞，蚂蚁灵波、
// 欧莱雅黑客松这类主办方是知名企业/技术平台、真金白银投入的赛事，无论怎么
// 加白名单都会不断漏判，需要能真正读懂上下文的判断。
//
// 三条纪律跟收录门槛本身一致：
//   一、冷门、参赛人数少、知名度低，不是拒绝理由——这正是产品要找的目标。
//   二、只依据给出的资料判断，资料不足就如实说"证据不足"（confident:false），
//      不脑补、不因为"听起来像"就下结论。
//   三、只影响 review→admit 的升级，不参与红旗直接拒收——红旗关键词本身
//      是可靠信号，不需要 AI 二次把关；水赛特征越明显反而越不该用主观判断
//      去"求情"。
//
// 走 DeepSeek（EXTRACT_ 前缀配置），跟批量抽取共用同一把钥匙：这是突发型
// 批量负载（review 档一天上百条），按量计费比 Kimi 会员制窗口配额更合适，
// 也不占审核那条线的额度。
const {
  adjustRequestOptions, callChatCompletion, parseModelJson, readAiConfig, resolveRequest, timeoutSignal,
} = require('./competitionAiReview');

const EXTRACT_CONFIG_PREFIX = 'EXTRACT_';
const PROMPT_VERSION = 'competition-admission-ai-v1';
const CHAT_TIMEOUT_MS = 30000;
const MAX_TOKENS = 500;

const judgmentSchema = {
  type:'object', additionalProperties:false,
  required:['worth_including', 'confident', 'reason'],
  properties:{
    worth_including:{ type:'boolean' },
    confident:{ type:'boolean' },
    reason:{ type:'string', minLength:1, maxLength:300 },
  },
};

function compactCandidateForJudgment(candidate) {
  return {
    name:candidate.name,
    organizer:candidate.organizer || '',
    authority_signals:(Array.isArray(candidate.authority_signals) ? candidate.authority_signals : [])
      .map(item => (typeof item === 'string' ? item : `${item?.signal || ''}：${item?.quote || ''}`)),
    reward_highlights:Array.isArray(candidate.reward_highlights) ? candidate.reward_highlights : [],
    recognition:Array.isArray(candidate.recognition) ? candidate.recognition.map(item => ({ path:item?.path, level:item?.level, evidence:item?.evidence })) : [],
    introduction:String(candidate.introduction || candidate.description || '').slice(0, 2000),
  };
}

function buildAdmissionJudgmentPrompt(candidate) {
  return [
    '仅收录允许大学生参加、与专业学习或专业技能相关的具体赛事。栏目、目录、通知标题、赛后新闻、中小学赛事、文艺娱乐和兴趣体育活动均不得收录。参赛范围或专业依据不足必须 confident:false，不得凭主办方权威推断合格。',
    '你要判断一场大学生竞赛是否有实质价值、值得收录进一个赛事信息平台，还是更像"水赛"',
    '（收智商税、刷履历用的空壳赛事）。这不是写作任务，是一个 true/false 判断。',
    '',
    '重要前提：冷门、参赛人数少、知名度低，都不是拒绝理由——这正是产品要找的目标',
    '（冷门但高回报的赛事）。判断的核心不是"知名不知名"，是"有没有实质价值、会不会坑人"。',
    '',
    '水赛的真实特征（命中越多越像水赛）：报名费高但门槛极低（几乎人人能报）、',
    '宣称"人人有奖""保证获奖"、主办方查无实据也无行业地位、证书没有实际用途',
    '或者要另外收费才能拿到。',
    '',
    '值得收录的信号：主办方有真实的行业/学术地位——不局限于政府机构和学会，',
    '知名企业、技术平台联合主办、提供真金白银投入（奖金、算力、数据集）也算；',
    '有实质性的非现金回报（保研加分、求职直通、创业扶持等）；赛制评审有具体、',
    '可信的描述，不是空泛话术。',
    '',
    '只依据下面给出的资料判断，资料不足就如实把 confident 填 false，不要脑补、',
    '不要因为"听起来像"正规赛事就下结论。',
    '',
    '只输出一个 JSON 对象，不要加解释文字或 Markdown 围栏。字段：',
    'worth_including 取 true/false；confident 取 true/false（拿不准就 false，此时',
    'worth_including 的值不会被采信）；reason 一句话说明依据，不超过 100 字。',
    `候选资料：${JSON.stringify(compactCandidateForJudgment(candidate))}`,
  ].join('\n');
}

function validateJudgment(value) {
  if (!value || typeof value !== 'object') throw new Error('ai_admission_judgment_invalid_result');
  if (typeof value.worth_including !== 'boolean') throw new Error('ai_admission_judgment_invalid_worth_including');
  if (typeof value.confident !== 'boolean') throw new Error('ai_admission_judgment_invalid_confident');
  if (typeof value.reason !== 'string' || !value.reason.trim()) throw new Error('ai_admission_judgment_invalid_reason');
  return value;
}

// candidate：withExtraction(candidate, extraction) 产出的那个合并对象，
// 跟传给 assessAdmission 的输入同一个形状，不用另外拼一份。
async function judgeAdmissionWithAi(candidate, request, { chatTimeoutMs = CHAT_TIMEOUT_MS, maxTokens = MAX_TOKENS } = {}) {
  const config = readAiConfig(process.env, EXTRACT_CONFIG_PREFIX);
  if (!config.apiKey) throw new Error('ai_api_key_not_configured');
  const send = resolveRequest(request);

  const messages = [
    { role:'system', content:'你是严谨的赛事资料审核助手，只依据给出的资料判断，证据不足就如实说不确定，不得编造或过度推断。只输出 JSON。' },
    { role:'user', content:buildAdmissionJudgmentPrompt(candidate) },
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
  if (!String(choice?.message?.content || '').trim()) {
    throw new Error(`ai_admission_judgment_empty_response:finish_${choice?.finish_reason || 'unknown'}`);
  }
  const result = validateJudgment(parseModelJson(choice.message.content));
  return { ...result, provider:config.provider || 'deepseek', model:config.model, prompt_version:PROMPT_VERSION, reviewed_at:new Date().toISOString() };
}

module.exports = {
  EXTRACT_CONFIG_PREFIX, PROMPT_VERSION,
  buildAdmissionJudgmentPrompt, compactCandidateForJudgment, judgeAdmissionWithAi, validateJudgment,
};
