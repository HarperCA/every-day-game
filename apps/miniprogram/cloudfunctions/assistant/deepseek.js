// 调 DeepSeek 对话接口（OpenAI 格式）。关掉思考模式：
// 思考模式默认打开且强度为 high，慢；而且带 tools 时要求每次回传 reasoning_content，否则 400（DeepSeek 文档《思考模式》）。
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-flash';
const RAW_LOG_LIMIT = 20000;

function createDeepSeekChat(env = process.env, request = globalThis.fetch) {
  const apiKey = String(env.ASSISTANT_AI_API_KEY || '').trim();
  const baseUrl = String(env.ASSISTANT_AI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const model = String(env.ASSISTANT_AI_MODEL || DEFAULT_MODEL).trim();
  const chat = async ({ messages, tools, toolChoice = 'auto', timeoutMs }) => {
    const startedAt = Date.now();
    if (!apiKey) return { ok:false, status:0, error:'assistant_ai_key_missing', elapsedMs:0 };
    const body = { model, messages, tools, tool_choice:toolChoice, thinking:{ type:'disabled' }, temperature:0.3, max_tokens:800 };
    try {
      const response = await request(`${baseUrl}/chat/completions`, {
        method:'POST',
        headers:{ Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' },
        body:JSON.stringify(body),
        signal:AbortSignal.timeout(timeoutMs),
      });
      const raw = await response.text();
      let payload = null;
      try { payload = JSON.parse(raw); } catch (_ignored) { /* 供应商也可能返回非 JSON 的错误页 */ }
      const message = payload?.choices?.[0]?.message || null;
      return { ok:response.ok && Boolean(message), status:response.status, message, usage:payload?.usage || null,
        finishReason:payload?.choices?.[0]?.finish_reason || '', raw:raw.slice(0, RAW_LOG_LIMIT), elapsedMs:Date.now() - startedAt };
    } catch (error) {
      return { ok:false, status:0, timedOut:error?.name === 'TimeoutError' || error?.name === 'AbortError',
        error:String(error?.message || error).slice(0, 200), elapsedMs:Date.now() - startedAt };
    }
  };
  chat.model = model;
  return chat;
}

module.exports = { createDeepSeekChat, DEFAULT_MODEL, DEFAULT_BASE_URL };
