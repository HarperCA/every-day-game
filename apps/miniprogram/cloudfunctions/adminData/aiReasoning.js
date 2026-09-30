// AI 思考过程（reasoning_content）的开关、提取与保存。
//
// 2026-09-30 测试阶段，用户要求：所有模型的思考都打开，并且全部记录下来，
// 好看清楚 AI 每一步到底想了什么。Kimi（会员通道 kimi-for-coding）本来就一直在思考，
// 之前只是没保存；DeepSeek 原先特意关掉了思考（见 competitionAiReview.js 的 buildRequestBody），
// 现在一并打开。要恢复原状，把服务器环境变量 AI_THINKING 设为 off 即可。
//
// 两家接口都用 choices[0].message.reasoning_content 返回思考过程，是完整的推理过程而不是摘要。
// 在 system 里要求“全程使用简体中文”：DeepSeek 基本照做；Kimi 时听时不听
// （实测 2026-09-30 一次手动审核的思考里汉字只占 5%）。所以存库时原文照存，
// 主要是英文的再用 DeepSeek（关掉思考）翻译一份中文存在 text_zh，后台优先显示中文。
//
// 思考过程可能很长（DeepSeek 一个“是/否”问题就想了六千多字），
// 不能塞进赛事记录——赛事记录整张表在后台每次加载、每次保存都要整体读写。
// 和某条赛事挂钩的存进单独的 ai_reasoning 集合，按赛事查；读详情抽字段的留在当晚运行文件里。

const fs = require('node:fs');
const path = require('node:path');

const REASONING_LANGUAGE_RULE = '你的思考过程（reasoning）必须全程使用简体中文。';
const REASONING_COLLECTION = 'ai_reasoning';
// 单条上限：足够放下一次完整的思考，又不至于让一条异常输出撑爆存储
const MAX_STORED_CHARS = 60000;

function thinkingEnabled(env = process.env) {
  return String(env.AI_THINKING || 'on').trim().toLowerCase() !== 'off';
}

// 在 system 提示末尾加上“用中文思考”；没有 system 就补一条。已经加过的不重复加。
function withReasoningLanguage(messages) {
  if (!Array.isArray(messages) || !messages.length) return messages;
  const [first, ...rest] = messages;
  if (first?.role === 'system' && typeof first.content === 'string') {
    if (first.content.includes(REASONING_LANGUAGE_RULE)) return messages;
    return [{ ...first, content:`${first.content}\n${REASONING_LANGUAGE_RULE}` }, ...rest];
  }
  return [{ role:'system', content:REASONING_LANGUAGE_RULE }, ...messages];
}

// 从一次接口返回里取出思考过程；没有就返回 null。
function reasoningFromPayload(payload) {
  const choice = payload?.choices?.[0];
  const text = typeof choice?.message?.reasoning_content === 'string' ? choice.message.reasoning_content : '';
  if (!text.trim()) return null;
  const tokens = payload?.usage?.completion_tokens_details?.reasoning_tokens;
  return {
    text,
    chars:text.length,
    tokens:Number.isFinite(tokens) ? tokens : null,
    finishReason:choice?.finish_reason || null,
  };
}

// 调用方传进来的 onReasoning 回调：出错不能影响审核本身。
function reportReasoning(onReasoning, entry) {
  if (typeof onReasoning !== 'function' || !entry) return;
  try { onReasoning(entry); } catch (_ignored) { /* 记录失败不影响审核结论 */ }
}

// 整理成要存进 ai_reasoning 集合的一条。
function buildReasoningDoc({ kind, recordId = null, recordName = '', url = '', model = '', provider = '', reasoning, createdAt = new Date().toISOString(), extra = null }) {
  const text = String(reasoning?.text || '');
  return {
    kind,
    record_id:recordId,
    record_name:String(recordName || '').slice(0, 200),
    url:String(url || '').slice(0, 500),
    model:String(model || ''),
    provider:String(provider || ''),
    text:text.slice(0, MAX_STORED_CHARS),
    chars:text.length,
    truncated:text.length > MAX_STORED_CHARS,
    tokens:reasoning?.tokens ?? null,
    finish_reason:reasoning?.finishReason || null,
    created_at:createdAt,
    ...(extra ? { extra } : {}),
  };
}

// —— 翻译：主要是英文的思考过程，另存一份中文 ——
// 汉字占“汉字 + 英文字母”不到一半，就当作英文。DeepSeek 抽取时的思考夹着大段中文原文引文，不会被误判。
function chineseRatio(text) {
  const value = String(text || '');
  const han = (value.match(/[一-鿿]/g) || []).length;
  const latin = (value.match(/[A-Za-z]/g) || []).length;
  return han + latin ? han / (han + latin) : 1;
}
const needsTranslation = text => String(text || '').trim().length > 20 && chineseRatio(text) < 0.5;

// 翻译用 DeepSeek：后端服务只配了 Kimi 的密钥，这里直接读服务器上批量抽取用的 .extract-key（和 pageRelayClient 读中转配置同一个办法）
const KEY_DIRS = [path.resolve(__dirname, '..', '..'), path.resolve(__dirname, '..')];
function translationConfig(env = process.env) {
  let apiKey = String(env.EXTRACT_AI_API_KEY || '').trim();
  for (const dir of KEY_DIRS) {
    if (apiKey) break;
    try { apiKey = fs.readFileSync(path.join(dir, '.extract-key'), 'utf8').trim(); } catch { /* 下一个 */ }
  }
  const baseUrl = String(env.EXTRACT_AI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  return { apiKey, baseUrl, model:/deepseek/i.test(baseUrl) ? 'deepseek-flash' : String(env.EXTRACT_AI_MODEL || '') };
}

// 按段落切成不超过 maxChars 的块，一块一块翻，避免一次输出太长被截断
function splitForTranslation(text, maxChars = 8000) {
  const chunks = [];
  let current = '';
  for (const part of String(text).split(/(\n\s*\n)/)) {
    if (current && (current + part).length > maxChars) { chunks.push(current); current = ''; }
    current += part;
    while (current.length > maxChars) { chunks.push(current.slice(0, maxChars)); current = current.slice(maxChars); }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

const TRANSLATE_PROMPT = '把用户给的这段 AI 思考过程翻译成简体中文。只输出译文，不加任何说明；原文里已经是中文的部分、网址、赛事名称、日期、JSON 字段名保持原样；不增删内容，不加评论。';

async function translateReasoning(text, { request = fetch, env = process.env } = {}) {
  const config = translationConfig(env);
  if (!config.apiKey || !config.model) return null;
  const pieces = [];
  for (const chunk of splitForTranslation(text)) {
    const response = await request(`${config.baseUrl}/chat/completions`, {
      method:'POST',
      headers:{ Authorization:`Bearer ${config.apiKey}`, 'Content-Type':'application/json' },
      // 翻译不需要思考，这里总是关掉，不跟随 AI_THINKING
      body:JSON.stringify({ model:config.model, thinking:{ type:'disabled' }, max_tokens:16000,
        messages:[{ role:'system', content:TRANSLATE_PROMPT }, { role:'user', content:chunk }] }),
      signal:AbortSignal.timeout(180000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const translated = String(payload?.choices?.[0]?.message?.content || '').trim();
    if (!translated) return null;
    pieces.push(translated);
  }
  return pieces.join('\n\n');
}

// 给 API 里的调用点用：攒下一次审核产生的全部思考，审核结束后一次写库。
function createReasoningCollector(base = {}) {
  const entries = [];
  return {
    entries,
    onReasoning:entry => entries.push(entry),
    docs:(extra = {}) => entries.map(entry => buildReasoningDoc({ ...base, ...extra, ...entry })),
  };
}

// 先存原文；主要是英文的，再在后台慢慢翻译、补上 text_zh——不让审核本身等翻译。
// waitForTranslation 只给测试用：等翻译写完再返回。
async function saveReasoningDocs(db, docs, { translate = translateReasoning, waitForTranslation = false } = {}) {
  let saved = 0;
  const pending = [];
  for (const doc of docs || []) {
    if (!doc?.text) continue;
    try {
      const result = await db.collection(REASONING_COLLECTION).add({ data:{ ...doc, text_zh:null, translation:needsTranslation(doc.text) ? 'pending' : 'not_needed' } });
      saved += 1;
      if (needsTranslation(doc.text) && result?._id) pending.push({ id:result._id, text:doc.text });
    } catch (error) {
      console.error('AI 思考过程保存失败', String(error?.message || error).slice(0, 200));
    }
  }
  const translating = (async () => {
    for (const item of pending) {
      let update;
      try {
        const zh = await translate(item.text);
        update = zh ? { text_zh:zh, translation:'done' } : { translation:'failed' };
      } catch (error) {
        update = { translation:'failed', translation_error:String(error?.message || error).slice(0, 200) };
      }
      try { await db.collection(REASONING_COLLECTION).doc(item.id).update({ data:update }); }
      catch (error) { console.error('AI 思考过程译文保存失败', String(error?.message || error).slice(0, 200)); }
    }
  })();
  if (waitForTranslation) await translating;
  return saved;
}

module.exports = {
  MAX_STORED_CHARS, REASONING_COLLECTION, REASONING_LANGUAGE_RULE,
  buildReasoningDoc, chineseRatio, createReasoningCollector, needsTranslation, reasoningFromPayload, reportReasoning,
  saveReasoningDocs, splitForTranslation, thinkingEnabled, translateReasoning, translationConfig, withReasoningLanguage,
};
