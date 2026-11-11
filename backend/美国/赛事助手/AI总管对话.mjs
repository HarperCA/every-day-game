// AI 总管对话：替换旧的 deepseek.js（原来自己拿密钥直接调 DeepSeek）。改经 AI 总管的会话调，用途 assistant
// （配置在 美国/ai/common/config.mjs：DeepSeek、关思考、temperature 0.3、max 800 token，参数沿用旧助手），用量由 AI 总管记账。
// 交回的格式和旧 deepseek.js 一样，assistantCore.js 不用改。
//
//   建对话(会话) → chat({ messages, tools, toolChoice, timeoutMs }) → { ok, status, message, usage, finishReason, elapsedMs } 或 { ok:false, timedOut, error }
export function 建对话(会话) {
  const chat = async ({ messages, tools, toolChoice = 'auto', timeoutMs }) => {
    const startedAt = Date.now();
    try {
      const r = await 会话.chat({ purpose: 'assistant', messages, tools, toolChoice, signal: AbortSignal.timeout(timeoutMs) });
      return { ok: Boolean(r?.message), status: 200, message: r?.message || null, usage: r?.usage || null, finishReason: '', raw: '', elapsedMs: Date.now() - startedAt };
    } catch (error) {
      const timedOut = error?.kind === '超时' || error?.name === 'TimeoutError' || error?.name === 'AbortError';
      return { ok: false, status: 0, timedOut, error: String(error?.message || error).slice(0, 200), elapsedMs: Date.now() - startedAt };
    }
  };
  chat.model = 'deepseek（经 AI 总管）';
  return chat;
}
