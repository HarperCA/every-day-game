// 赛事助手的入口（2026-11-01 用户定：放美国服务器，照搬旧代码，不重构）。替换旧的 index.js，分三步：
//   1 审查       有没有 openid、动作是不是 ask、提问和参数合不合格，见 审查.mjs
//   2 准备工具   通过 AI 总管对话、微信内容检查、读比赛、读聊天历史、保存问答，见 工具.mjs
//   3 回答       旧的 assistantCore.js 原样：AI 把问题转成筛选条件，查比赛库，生成回复
//
//   回答(event, { openid, 比赛库, 问答记录, ai, 微信, now }) → 和旧云函数一样的 { ok, data } / { ok:false, message }
//     event：{ action: 'ask', message, sessionId, profileCategories }；openid 由 接口.mjs 校验北京签的令牌后给
import { createRequire } from 'node:module';
import { 审查 } from './审查.mjs';
import { 准备工具 } from './工具.mjs';

const require = createRequire(import.meta.url);
const { answer } = require('./assistantCore.js');

export async function 回答(event, { openid, 比赛库, 问答记录, ai, 微信, now = () => new Date() }) {
  const 查 = 审查(event, openid);
  if (!查.ok) return { ok: false, message: 查.message };
  try {
    return await answer(查.input, { openid, now, ...准备工具({ openid, 比赛库, 问答记录, ai, 微信, now }) });
  } catch (error) {
    console.error('[赛事助手] 未处理的错误', error);
    return { ok: false, message: 'assistant_failed' };
  }
}
