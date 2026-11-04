// 工具：回答一个问题要用的五个依赖，合成一个文件（2026-11-01 用户定）。旧 index.js 里传给 assistantCore.js 的是同样五个，只是都换成美国的：
//   chat          通过 AI 总管对话（来源“实时”、模块“赛事助手”、实时车道，用途 assistant），见 AI总管对话.mjs
//   secCheck      微信内容检查：提问和回答都过 msgSecCheck（secCheck.js 原样，共用/工具/微信.mjs 换 access_token）
//   loadRecords   读比赛：比赛库里已发布、已归档的届次，整理成旧公开缓存的字段，见 读比赛.mjs
//   loadHistory   读聊天历史：这个用户这个会话最近几轮成功的问答，见 问答记录.mjs
//   saveLog       保存问答：一轮一条，顺带清理满 180 天的，见 问答记录.mjs
//
//   准备工具({ openid, 比赛库, 问答记录, ai, 微信, now }) → { chat, secCheck, loadRecords, loadHistory, saveLog }
import { createRequire } from 'node:module';
import { 建对话 } from './AI总管对话.mjs';
import { 读公开比赛 } from './读比赛.mjs';
import { loadRecentTurns, saveTurnLog } from './问答记录.mjs';
import { createOpenApi } from '../../共用/工具/微信.mjs';

const require = createRequire(import.meta.url);
const { createSecCheck } = require('./secCheck.js');

export function 准备工具({ openid, 比赛库, 问答记录, ai, 微信, now = () => new Date() }) {
  return {
    chat: 建对话(ai.session({ source: '实时', module: '赛事助手', lane: 'realtime' })),
    secCheck: createSecCheck({ openapi: createOpenApi(微信) }, openid),
    loadRecords: () => 读公开比赛(比赛库),
    loadHistory: (id, sessionId) => loadRecentTurns(问答记录, id, sessionId),
    saveLog: entry => saveTurnLog(问答记录, entry, now()),
  };
}
