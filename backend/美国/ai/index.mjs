// AI 总管的唯一入口：AI 和搜索接口的统一管理和分发——密钥、发给哪家、补位、每天次数、额度、排队、超时、重试、记账。
// 要问什么、提示词怎么写、返回结果怎么处理，由用到它的地方自己做（流程模块、赛事助手）。
//
//   session({ source, runId, module, lane })   开一个带身份的会话，之后的调用自动按这个身份记账
//     .chat({ purpose, messages, json, tools, schema, promptVersion })   对话 → { message, data, usage, provider }
//     .search({ purpose, query, site, recent, blocked })                  搜索 → { references, provider, tried }
//     .fetchPage({ purpose, url })                                         读网页 → { markdown, images }
//     .decide({ purpose, state, questions })                               判断 → { answers }
//     .budgetLeft()                                                         这个会话还剩多少次调用
//     .报告问题({ purpose, promptVersion, 原因 })                           返回的内容用不了时报告（记进用量库的 problems）
//   usage.ofModule / ofRun / ofDay / report     查用量
//   usage.problemsOf(runId)                     这一晚调用方报告的问题
//   usage.problemsSince(day)                    某天以来所有来源报告的问题（后台“失败任务”页）
//   usage.fixedFees(month)                      这个月登记的月费（Codex、Kimi 会员通道；后台“接口用量”页）
//   usage.closeRun(runId)                       一晚跑完时写这一晚的汇总
//   createAi(options)                           自己组装一个 AI 总管（测试时换成假接口、内存里的用量库）
//
// 接口：DeepSeek（对话、搜索）、Kimi（对话、搜索、读网页）、百度（搜索）、Jev（判断）、Codex（对话，本机命令行）。
// 只有这里读密钥。默认实例的设置来自环境变量：
//   AI_USAGE_DB   用量库文件（默认 backend/美国/ai/usage.db）
//   AI_KEYS_DIR   密钥目录（每家一个文件：deepseek.key、kimi.key、baidu.key、jev.key；Codex 不用）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCaller } from './common/call.mjs';
import { DEFAULT_CONFIG } from './common/config.mjs';
import { createKeyStore } from './common/keys.mjs';
import { createSession } from './common/session.mjs';
import { createUsageStore } from './common/usage.mjs';
import * as baidu from './providers/baidu/index.mjs';
import * as codex from './providers/codex/index.mjs';
import * as deepseek from './providers/deepseek/index.mjs';
import * as jev from './providers/jev/index.mjs';
import * as kimi from './providers/kimi/index.mjs';
import * as tavily from './providers/tavily/index.mjs';

export { AiError, ERROR_KINDS } from './common/errors.mjs';
export const PURPOSES = DEFAULT_CONFIG.purposes;
// 默认配置：本地试跑临时换某个用途的接口时，拿它改一份交给 createAi（2026-11-08 新维护本地试跑把写爬虫脚本换成 Kimi）
export { DEFAULT_CONFIG };
const AI_DIR = path.dirname(fileURLToPath(import.meta.url));

export function createAi({ config = DEFAULT_CONFIG, providers = { deepseek, kimi, baidu, jev, codex, tavily }, keys = createKeyStore(),
  usage = createUsageStore(process.env.AI_USAGE_DB || path.join(AI_DIR, 'usage.db')) } = {}) {
  const call = createCaller({ config, providers, keys, usage });
  return {
    session: identity => createSession(identity, { call, config, usage }),
    usage,
  };
}

// 默认实例：第一次用到时才建（才打开用量库）
let defaultAi = null;
const getDefault = () => (defaultAi ||= createAi());
export const session = identity => getDefault().session(identity);
export const usage = {
  ofModule: (...args) => getDefault().usage.ofModule(...args),
  ofRun: (...args) => getDefault().usage.ofRun(...args),
  ofDay: (...args) => getDefault().usage.ofDay(...args),
  report: (...args) => getDefault().usage.report(...args),
  closeRun: (...args) => getDefault().usage.closeRun(...args),
  problemsOf: (...args) => getDefault().usage.problemsOf(...args),
  problemsSince: (...args) => getDefault().usage.problemsSince(...args),
  fixedFees: (...args) => getDefault().usage.fixedFees(...args),
};
