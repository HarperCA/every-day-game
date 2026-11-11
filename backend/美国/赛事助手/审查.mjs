// 审查：赛事助手收到请求后先过的三步，合成一个（2026-11-01 用户定）。规则和旧云函数 index.js 一样：
//   1 有没有 openid            没有 → unauthenticated（未认证）
//   2 动作是不是 ask            不是 → unsupported_action（不支持的动作）
//   3 提问和参数合不合格         不合格 → assistant_input_invalid（输入错误）；规则在 askValidation.js（旧代码原样）
// 都合格就交回检查过的提问（去掉首尾空白、会话编号格式不对的清空、专业只留认识的），交给后面准备工具。
// 不合格的不写问答记录：没有有效内容。
//
//   审查(event, openid) → { ok: true, input: { message, sessionId, profileCategories } } 或 { ok: false, message }
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateAskInput } = require('./askValidation.js');

export function 审查(event, openid) {
  if (!openid) return { ok: false, message: 'unauthenticated' };
  if (event?.action !== 'ask') return { ok: false, message: 'unsupported_action' };
  try {
    return { ok: true, input: validateAskInput(event) };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}
