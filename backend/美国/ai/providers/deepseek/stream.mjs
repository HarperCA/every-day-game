// DeepSeek 的 SSE 增量拼回助手现有接口使用的完整消息。
import { AiError } from '../../common/errors.mjs';

export async function readChatStream(response) {
  const invalid = () => new AiError('对方出错', 'DeepSeek 流式回答不完整或格式异常', { provider: 'deepseek', status: response.status });
  if (!response.body) throw invalid();
  const message = { role: 'assistant', content: null };
  const calls = new Map();
  let usage = null;
  let received = false;
  let pending = '';

  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        if (!received) throw invalid();
        if (calls.size) message.tool_calls = [...calls].sort(([a], [b]) => a - b).map(([, call]) => call);
        return { choices: [{ message }], usage };
      }
      let event;
      try { event = JSON.parse(data); } catch { throw invalid(); }
      if (event?.error) throw invalid();
      if (event?.usage) usage = event.usage;
      const delta = event?.choices?.[0]?.delta;
      if (!delta) continue;
      received = true;
      for (const field of ['content', 'reasoning_content']) {
        if (typeof delta[field] === 'string') message[field] = (message[field] ?? '') + delta[field];
      }
      for (const part of delta.tool_calls ?? []) {
        const call = calls.get(part.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (part.id) call.id = part.id;
        if (part.type) call.type = part.type;
        call.function.name += part.function?.name ?? '';
        call.function.arguments += part.function?.arguments ?? '';
        calls.set(part.index, call);
      }
    }
  }
  throw invalid();
}
