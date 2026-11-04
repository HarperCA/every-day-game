// 一轮对话的完整流程。所有外部依赖（模型、内容检测、数据库）都从 deps 传进来，测试时换成假的。
const crypto = require('crypto');
const { buildTools, regionsOf, CARD_LIMIT, sanitizeSearchArgs, runSearch, compactForModel, toCard, sanitizeAskUser } = require('./tools');
const { PROMPT_VERSION, buildMessages } = require('./prompt');

const MAX_MODEL_CALLS = 3;         // 最多：查一次 → 再查一次 → 写回答
const TOTAL_BUDGET_MS = 20000;     // 整轮最多 20 秒
const PER_CALL_TIMEOUT_MS = 12000;
const MIN_CALL_BUDGET_MS = 2000;   // 剩余不到 2 秒就不再发起调用
const MAX_REPLY_CHARS = 600;
const MAX_LOGGED_ARGUMENT_CHARS = 2000;
const BLOCKED_REPLY = '这个问题我没法回答。可以告诉我你的专业、年级和想找什么样的比赛。';
const UNSAFE_OUTPUT_REPLY = '帮你查到了下面这些比赛：';

const newId = prefix => `${prefix}-${crypto.randomBytes(12).toString('hex')}`;
const clip = (value, max) => String(value ?? '').slice(0, max);

// 回答里出现的日期，必须是工具结果里有的；出现网址一律不行。违反就换成模板句子（卡片照常显示）。
const DATE_PATTERNS = [/\d{4}-\d{1,2}-\d{1,2}/g, /(?:\d{4}年)?\d{1,2}月\d{1,2}日/g];
function datesIn(text) {
  return DATE_PATTERNS.flatMap(pattern => String(text || '').match(pattern) || []);
}
// 统一成“月-日”比较：工具结果是 2026-10-28，回答里可能写成 10月28日 或 2026年10月28日
function normalizeDate(text) {
  const match = String(text).match(/(?:(\d{4})[-年])?(\d{1,2})[-月](\d{1,2})日?/);
  return match ? `${Number(match[2])}-${Number(match[3])}` : '';
}
function allowedDates(searches) {
  const allowed = new Set();
  for (const search of searches) for (const item of search.result.items) {
    for (const value of [item.registration_start, item.registration_end, item.competition_start, item.competition_end]) {
      if (value) allowed.add(normalizeDate(String(value).slice(0, 10)));
    }
  }
  return allowed;
}
function replyViolations(reply, searches) {
  const violations = [];
  if (/https?:\/\/|www\./i.test(reply)) violations.push('url');
  const allowed = allowedDates(searches);
  for (const date of datesIn(reply)) if (!allowed.has(normalizeDate(date))) violations.push(`date:${date}`);
  return violations;
}

function cleanReply(text) {
  return Array.from(String(text || '').replace(/[*#`>]+/g, '').trim()).slice(0, MAX_REPLY_CHARS).join('');
}

async function runCheck(secCheck, content) {
  try {
    const result = await secCheck(content);
    if (!result?.suggest) return { error:'no_suggest' };
    return { suggest:result.suggest, label:result.label ?? null, traceId:result.traceId || '', blocked:result.suggest === 'risky' };
  } catch (error) {
    return { error:clip(error?.message || error, 200) };
  }
}

async function answer(input, deps) {
  const now = deps.now ? deps.now() : new Date();
  const clock = deps.clock || Date.now;
  const startedAt = clock();
  const sessionId = input.sessionId || newId('session');
  const log = {
    id:newId('turn'), sessionId, openid:deps.openid, createdAt:now.toISOString(), promptVersion:PROMPT_VERSION,
    model:deps.chat.model || '', message:input.message, profileCategories:input.profileCategories || [],
    history:[], modelCalls:[], toolCalls:[], inputCheck:null, outputCheck:null,
    status:'', reply:'', replyViolations:[], cardIds:[], total:null, filters:null, options:[], elapsedMs:0,
  };
  const finish = async (status, result) => {
    log.status = status;
    log.elapsedMs = clock() - startedAt;
    // 记录写失败不影响用户拿到回答，但要在服务器日志里看得见
    try { await deps.saveLog(log); } catch (error) { console.error('[assistant] 对话记录写入失败', error); }
    return result;
  };
  const fail = message => finish(message, { ok:false, message });
  const done = (status, data) => finish(status, { ok:true, data:{ turnId:log.id, sessionId, status, ...data } });

  // 1. 用户输入先过内容安全；检测不了就不处理
  log.inputCheck = await runCheck(deps.secCheck, input.message);
  if (log.inputCheck.error) return fail('assistant_check_failed');
  if (log.inputCheck.blocked) {
    log.reply = BLOCKED_REPLY;
    return done('blocked', { reply:BLOCKED_REPLY, aiGenerated:false, options:[], cards:[], total:0, filters:null });
  }

  // 2. 上下文：这个会话最近几轮（服务器存的，不用客户端传的）
  const history = input.sessionId ? await deps.loadHistory(deps.openid, input.sessionId) : [];
  log.history = history.map(turn => turn.id);
  const records = await deps.loadRecords();
  const regions = regionsOf(records);
  const tools = buildTools(regions);
  const messages = buildMessages({ message:input.message, history, profileCategories:input.profileCategories || [], now });

  // 3. 模型 ⇄ 工具
  const searches = [];
  let clarify = null;
  let finalText = '';
  for (let index = 0; index < MAX_MODEL_CALLS; index += 1) {
    const remaining = TOTAL_BUDGET_MS - (clock() - startedAt);
    if (remaining < MIN_CALL_BUDGET_MS) return fail('assistant_timeout');
    const toolChoice = index === MAX_MODEL_CALLS - 1 ? 'none' : 'auto';
    const response = await deps.chat({ messages, tools, toolChoice, timeoutMs:Math.min(PER_CALL_TIMEOUT_MS, remaining) });
    log.modelCalls.push({ index, toolChoice, requestMessages:JSON.parse(JSON.stringify(messages)),
      ok:response.ok, status:response.status, finishReason:response.finishReason || '', usage:response.usage || null,
      raw:response.raw || '', error:response.error || '', elapsedMs:response.elapsedMs ?? null });
    if (!response.ok) return fail(response.timedOut ? 'assistant_timeout' : 'assistant_ai_failed');
    const message = response.message;
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!calls.length) { finalText = message.content || ''; break; }
    // 模型这一步的原话（含工具调用）要原样放回对话，否则下一次调用对不上 tool_call_id
    messages.push({ role:'assistant', content:message.content || '', tool_calls:calls });
    for (const call of calls) {
      const name = call?.function?.name;
      const rawArguments = call?.function?.arguments;
      const loggedArguments = clip(typeof rawArguments === 'string' ? rawArguments : JSON.stringify(rawArguments ?? null), MAX_LOGGED_ARGUMENT_CHARS);
      if (name === 'search_competitions') {
        const { query, dropped } = sanitizeSearchArgs(rawArguments, regions);
        const result = runSearch(records, query, now);
        searches.push({ query, result });
        log.toolCalls.push({ name, rawArguments:loggedArguments, query, dropped, total:result.total, ids:result.items.map(item => item.id) });
        messages.push({ role:'tool', tool_call_id:call.id, content:JSON.stringify(compactForModel(result)) });
      } else if (name === 'ask_user') {
        clarify = sanitizeAskUser(rawArguments);
        log.toolCalls.push({ name, rawArguments:loggedArguments, ...clarify });
        messages.push({ role:'tool', tool_call_id:call.id, content:'{"ok":true}' });
      } else {
        log.toolCalls.push({ name:clip(name, 100), rawArguments:loggedArguments, unknown:true });
        messages.push({ role:'tool', tool_call_id:call.id, content:'{"error":"unknown_tool"}' });
      }
    }
    // 追问：本轮到此结束，问题和选项交给用户
    if (clarify?.question) break;
  }

  // 4. 组装。卡片只来自查询结果，模型写的任何文字都不进卡片
  const lastSearch = searches[searches.length - 1] || null;
  const cards = lastSearch ? lastSearch.result.items.slice(0, CARD_LIMIT).map(item => toCard(item, now)) : [];
  const status = clarify?.question ? 'clarify' : !lastSearch ? 'chat' : lastSearch.result.total ? 'answered' : 'empty';
  let reply = cleanReply(clarify?.question || finalText);
  if (!reply) return fail('assistant_ai_failed');
  log.replyViolations = replyViolations(reply, searches);
  if (log.replyViolations.length) reply = cards.length ? UNSAFE_OUTPUT_REPLY : BLOCKED_REPLY;

  // 5. 输出也过内容安全
  log.outputCheck = await runCheck(deps.secCheck, reply);
  if (log.outputCheck.error) return fail('assistant_check_failed');
  const outputBlocked = Boolean(log.outputCheck.blocked);
  if (outputBlocked) reply = cards.length ? UNSAFE_OUTPUT_REPLY : BLOCKED_REPLY;

  log.reply = reply;
  log.cardIds = cards.map(card => card.id);
  log.total = lastSearch ? lastSearch.result.total : null;
  log.filters = lastSearch ? lastSearch.query : null;
  log.options = outputBlocked ? [] : clarify?.options || [];
  const aiGenerated = !outputBlocked && !log.replyViolations.length;
  return done(outputBlocked ? 'blocked' : status, {
    reply, aiGenerated, options:log.options, cards, total:log.total ?? 0, filters:log.filters,
  });
}

module.exports = { answer, replyViolations, datesIn, normalizeDate, cleanReply, MAX_MODEL_CALLS, TOTAL_BUDGET_MS, BLOCKED_REPLY, UNSAFE_OUTPUT_REPLY };
