// 赛事助手照搬旧代码（apps/miniprogram/cloudfunctions/assistant/），只换三处对接（2026-11-01 用户定）：
//   调 DeepSeek → 经 AI 总管（用途 assistant）；读比赛 → 美国比赛库的工具；问答记录 → 助手自己的库文件（原来是云开发的集合）。
// 这里测这三处和入口；旧逻辑的测试原样在 assistant-*.test.mjs。不连网、不调真实 AI。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, test } from 'vitest';
import { openDb } from '../../../db/index.mjs';
import { 打开问答记录, saveTurnLog, loadRecentTurns, purgeExpiredLogs, RETENTION_DAYS } from '../../问答记录.mjs';
import { 读公开比赛 } from '../../读比赛.mjs';
import { 建对话 } from '../../AI总管对话.mjs';
import { 回答 } from '../../index.mjs';
import { 审查 } from '../../审查.mjs';
import { 准备工具 } from '../../工具.mjs';

const require = createRequire(import.meta.url);
const { runSearch } = require('../../tools.js');
const NOW = new Date('2026-10-16T04:00:00Z');   // 北京时间 2026-10-16 12:00

// Windows 上库文件开着删不掉：先关记录库再删目录
const 临时 = [], 开着 = [];
const 临时文件 = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), '助手-')); 临时.push(d); return path.join(d, '问答记录.db'); };
const 打开 = () => { const s = 打开问答记录(临时文件()); 开着.push(s); return s; };
afterEach(() => {
  while (开着.length) 开着.pop().关闭();
  while (临时.length) fs.rmSync(临时.pop(), { recursive: true, force: true });
});

function 比赛库() {
  const db = openDb({ file: ':memory:', now: () => NOW });
  db.transaction(tx => {
    tx.insert('competition', 'event-car', { name: '全国大学生智能汽车竞赛', aliases: ['智能车'], level: '国家级', region: '全国', professions: ['计算机与AI', '电子信息'], organizer: '教育部高等学校自动化类专业教学指导委员会' });
    tx.insert('edition', 'ed-car-21', { competition_id: 'event-car', ordinal: 1, edition_name: '第二十一届', status: '已发布', participation_format: '团队赛', fee_type: '免费',
      registration_start: '2026-10-01', registration_end: '2026-10-28', competition_start: '2026-11-20', time_note: '以学校通知为准', status_override: null });
    tx.insert('edition', 'ed-car-20', { competition_id: 'event-car', ordinal: 0, edition_name: '第二十届', status: '已归档', registration_end: '2025-10-28' });
    tx.insert('edition', 'ed-car-draft', { competition_id: 'event-car', ordinal: 2, edition_name: '第二十二届', status: '待人工审核' });
    tx.insert('competition', 'event-en', { name: '外研社杯全国英语演讲大赛', level: '国际级', region: '国际', professions: ['外语与教育'] });
    tx.insert('edition', 'ed-en', { competition_id: 'event-en', ordinal: 1, edition_name: '2026', level: '国家级', status: '已发布', participation_format: '个人赛' });
    tx.insert('competition', 'event-gone', { name: '删了的比赛', level: '国家级', professions: ['计算机与AI'] });
    tx.insert('edition', 'ed-gone', { competition_id: 'event-gone', ordinal: 1, edition_name: '2026', status: '已发布' });
  });
  db.标记删除('competition', 'event-gone', { by: '管理员' });
  return db;
}

describe('读比赛：用美国比赛库的工具读，整理成旧公开缓存的字段，旧的查询和排序代码不用改', () => {
  test('只读已发布、已归档的（待人工审核、已删除的不读），每届一条', () => {
    expect(读公开比赛(比赛库()).map(r => r.id).sort()).toEqual(['ed-car-20', 'ed-car-21', 'ed-en']);
  });
  test('字段换成旧名字：比赛和届次合成一条，级别、主办方届次没填用比赛的；搜索文字含别名', () => {
    const r = 读公开比赛(比赛库()).find(x => x.id === 'ed-car-21');
    expect(r).toMatchObject({ event_id: 'event-car', name: '全国大学生智能汽车竞赛', edition_name: '第二十一届', data_status: 'published', system_validation: 'passed', manual_review: 'passed',
      event_level: '国家级', professions: ['计算机与AI', '电子信息'], participation_format: '团队赛', fee_type: '免费', region: '全国',
      registration_start: '2026-10-01', registration_end: '2026-10-28', competition_start: '2026-11-20', registration_end_note: '以学校通知为准',
      organizer: '教育部高等学校自动化类专业教学指导委员会' });
    expect(r.search_text).toContain('智能车');
    expect(r.value_scores).toBeTypeOf('object');
    expect(读公开比赛(比赛库()).find(x => x.id === 'ed-car-20').data_status).toBe('archived');
    expect(读公开比赛(比赛库()).find(x => x.id === 'ed-en').event_level).toBe('国家级');
  });
  test('旧的查比赛工具在这些记录上照常能用：按专业查到、按截止日排', () => {
    const r = runSearch(读公开比赛(比赛库()), { professions: ['计算机与AI'] }, NOW);
    expect(r.items.map(x => x.id)).toContain('ed-car-21');
    expect(r.items.map(x => x.id)).not.toContain('ed-en');
  });
});

describe('问答记录：助手自己的库文件，规则同旧的（一轮一条、上下文最近 6 轮、存 180 天）', () => {
  const turn = (id, createdAt, overrides = {}) => ({ id, sessionId: 'session-1', openid: 'o1', createdAt, status: 'answered', message: `问${id}`, reply: `答${id}`, ...overrides });
  test('一轮一条；取上下文只取这个用户这个会话成功的轮次，早到晚，最多 6 轮；没有记录是空', async () => {
    const store = 打开();
    expect(await loadRecentTurns(store, 'o1', 'session-1')).toEqual([]);
    for (let i = 1; i <= 8; i += 1) await saveTurnLog(store, turn(`turn-${i}`, `2026-10-16T01:0${i}:00Z`), NOW);
    await saveTurnLog(store, turn('turn-other-user', '2026-10-16T02:00:00Z', { openid: 'o2' }), NOW);
    await saveTurnLog(store, turn('turn-other-session', '2026-10-16T02:00:00Z', { sessionId: 'session-2' }), NOW);
    await saveTurnLog(store, turn('turn-failed', '2026-10-16T02:00:00Z', { status: 'assistant_ai_failed', reply: '' }), NOW);
    await saveTurnLog(store, turn('turn-blocked', '2026-10-16T02:01:00Z', { status: 'blocked' }), NOW);
    const history = await loadRecentTurns(store, 'o1', 'session-1');
    expect(history.map(item => item.id)).toEqual(['turn-3', 'turn-4', 'turn-5', 'turn-6', 'turn-7', 'turn-8']);
    expect(history[0]).toEqual({ id: 'turn-3', message: '问turn-3', reply: '答turn-3' });
    expect(store.取('turn-1')).toMatchObject({ id: 'turn-1', reply: '答turn-1' });
  });
  test(`删掉保存满 ${RETENTION_DAYS} 天的，留下没满的；写记录时顺带清理，12 小时内只清一次`, async () => {
    const store = 打开();
    const now = new Date('2027-05-01T00:00:00Z');
    const daysAgo = d => new Date(now.getTime() - d * 86400000).toISOString();
    for (const [id, d] of [['old-200', 200], ['old-181', 181], ['edge-180', RETENTION_DAYS], ['new-179', 179], ['new-1', 1]]) store.存(turn(id, daysAgo(d)));
    expect(await purgeExpiredLogs(store, now)).toBe(3);
    expect(store.全部编号()).toEqual(['new-1', 'new-179']);
    const later = new Date('2028-01-01T00:00:00Z');
    store.存(turn('ancient', '2027-01-01T00:00:00Z'));
    await saveTurnLog(store, turn('fresh', later.toISOString()), later);
    expect(store.全部编号()).not.toContain('ancient');
    store.存(turn('ancient-2', '2027-01-01T00:00:00Z'));
    await saveTurnLog(store, turn('fresh-2', later.toISOString()), new Date(later.getTime() + 3600000));
    expect(store.全部编号()).toContain('ancient-2');
    await saveTurnLog(store, turn('fresh-3', later.toISOString()), new Date(later.getTime() + 13 * 3600000));
    expect(store.全部编号()).not.toContain('ancient-2');
  });
});

describe('AI 总管对话：换掉原来直接调 DeepSeek 的 deepseek.js，交回的格式和原来一样，assistantCore.js 不用改', () => {
  test('经 AI 总管的会话调（用途 assistant），工具和 tool_choice 原样带上；交回 { ok, status, message, usage }', async () => {
    const 收到 = [];
    const chat = 建对话({ chat: async req => { 收到.push(req); return { message: { role: 'assistant', content: '好' }, usage: { prompt_tokens: 3 }, provider: 'deepseek' }; } });
    const r = await chat({ messages: [{ role: 'user', content: '找比赛' }], tools: [{ type: 'function' }], toolChoice: 'none', timeoutMs: 5000 });
    expect(收到[0]).toMatchObject({ purpose: 'assistant', messages: [{ role: 'user', content: '找比赛' }], tools: [{ type: 'function' }], toolChoice: 'none' });
    expect(收到[0].signal).toBeInstanceOf(AbortSignal);
    expect(r).toMatchObject({ ok: true, status: 200, message: { content: '好' }, usage: { prompt_tokens: 3 } });
    expect(typeof r.elapsedMs).toBe('number');
    expect(chat.model).toBeTruthy();
  });
  test('出错交回 ok:false 和原因；超时标 timedOut（assistantCore 据此回“超时”）', async () => {
    const 超时 = Object.assign(new Error('超过 12 秒'), { kind: '超时' });
    expect(await 建对话({ chat: async () => { throw 超时; } })({ messages: [], timeoutMs: 10 })).toMatchObject({ ok: false, timedOut: true, error: '超过 12 秒' });
    expect(await 建对话({ chat: async () => { throw new Error('密钥错误'); } })({ messages: [], timeoutMs: 10 })).toMatchObject({ ok: false, timedOut: false, error: '密钥错误' });
  });
});

describe('审查：有没有 openid → 动作是不是 ask → 提问和参数合不合格，三步合成一个（2026-11-01 用户定）', () => {
  test('按顺序查，停在第一个不合格的那步，交回和旧云函数一样的错误', () => {
    expect(审查({ action: 'list', message: '' }, '')).toEqual({ ok: false, message: 'unauthenticated' });
    expect(审查({ action: 'list' }, 'o1')).toEqual({ ok: false, message: 'unsupported_action' });
    expect(审查(undefined, 'o1')).toEqual({ ok: false, message: 'unsupported_action' });
    expect(审查({ action: 'ask', message: '' }, 'o1')).toEqual({ ok: false, message: 'assistant_input_invalid' });
  });
  test('都合格：交回检查过的提问，交给后面准备工具', () => {
    const r = 审查({ action: 'ask', message: '  找比赛  ', sessionId: 'session-0123456789abcdef01234567' }, 'o1');
    expect(r.ok).toBe(true);
    expect(r.input).toEqual({ message: '找比赛', sessionId: 'session-0123456789abcdef01234567', profileCategories: [] });
  });
});

describe('工具：回答要用的五个依赖合成一个文件（2026-11-01 用户定）', () => {
  test('交回 chat、secCheck、loadRecords、loadHistory、saveLog 五个，各自接到美国的对应地方', async () => {
    const 身份们 = [];
    const 收到 = [];
    const ai = { session: 身份 => { 身份们.push(身份); return { chat: async req => { 收到.push(req); return { message: { role: 'assistant', content: '好' } }; } }; } };
    const 检测 = [];
    const 微信 = { msgSecCheck: async o => { 检测.push(o); return { errcode: 0, result: { suggest: 'pass', label: 100 }, trace_id: 't1' }; } };
    const 记录 = 打开();
    const 工具 = 准备工具({ openid: 'o1', 比赛库: 比赛库(), 问答记录: 记录, ai, 微信, now: () => NOW });
    expect(Object.keys(工具).sort()).toEqual(['chat', 'loadHistory', 'loadRecords', 'saveLog', 'secCheck']);

    // chat：经 AI 总管，会话身份是“实时 / 赛事助手 / 实时车道”，用途 assistant
    expect(身份们).toEqual([{ source: '实时', module: '赛事助手', lane: 'realtime' }]);
    expect(await 工具.chat({ messages: [], timeoutMs: 1000 })).toMatchObject({ ok: true, message: { content: '好' } });
    expect(收到[0].purpose).toBe('assistant');
    // secCheck：微信内容安全，带上这个用户的 openid
    expect(await 工具.secCheck('找比赛')).toEqual({ suggest: 'pass', label: 100, traceId: 't1' });
    expect(检测[0]).toMatchObject({ openid: 'o1', content: '找比赛', version: 2 });
    // loadRecords：比赛库里已发布、已归档的
    const 编号们 = 工具.loadRecords().map(r => r.id);
    expect(编号们).toEqual(expect.arrayContaining(['ed-car-20', 'ed-car-21']));
    expect(编号们).not.toContain('ed-car-draft');
    // saveLog、loadHistory：问答记录，存了就能按用户和会话读回来
    await 工具.saveLog({ id: 't-1', openid: 'o1', sessionId: 's1', createdAt: NOW.toISOString(), status: 'answered', message: '问', reply: '答' });
    expect(await 工具.loadHistory('o1', 's1')).toEqual([{ id: 't-1', message: '问', reply: '答' }]);
  });
});

describe('入口 回答()：和旧 index.js 一样的检查，依赖换成美国的', () => {
  const 微信 = { 检测: [], msgSecCheck: async function (o) { this.检测.push(o); return { errcode: 0, result: { suggest: 'pass', label: 100 }, trace_id: 't' }; } };
  const toolCall = (name, args) => ({ id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  function 假AI(回答们) {
    const ai = { 身份: [], session(身份) { ai.身份.push(身份); let n = 0; return { chat: async () => ({ message: 回答们[n++] }) }; } };
    return ai;
  }
  test('没登录、动作不对、提问不合格：照旧拒绝', async () => {
    const env = { 比赛库: 比赛库(), 问答记录: 打开(), ai: 假AI([]), 微信 };
    expect(await 回答({ action: 'ask', message: '找比赛' }, { ...env, openid: '' })).toEqual({ ok: false, message: 'unauthenticated' });
    expect(await 回答({ action: 'list' }, { ...env, openid: 'o1' })).toEqual({ ok: false, message: 'unsupported_action' });
    expect(await 回答({ action: 'ask', message: '' }, { ...env, openid: 'o1' })).toEqual({ ok: false, message: 'assistant_input_invalid' });
  });
  test('一轮对话走通：AI 总管会话身份是“实时 / 赛事助手”，查比赛读的是比赛库，卡片来自库里，问答记下来，提问和回答都过内容安全', async () => {
    const ai = 假AI([
      { role: 'assistant', content: '', tool_calls: [toolCall('search_competitions', { professions: ['计算机与AI'] })] },
      { role: 'assistant', content: '帮你找到了智能汽车竞赛，报名 2026-10-28 截止。' },
    ]);
    const 记录 = 打开();
    const r = await 回答({ action: 'ask', message: '计算机专业有什么比赛' }, { openid: 'o1', 比赛库: 比赛库(), 问答记录: 记录, ai, 微信, now: () => NOW });
    expect(r.ok).toBe(true);
    expect(r.data.cards.map(c => c.id)).toContain('ed-car-21');
    expect(r.data.reply).toContain('智能汽车竞赛');
    expect(ai.身份[0]).toEqual({ source: '实时', module: '赛事助手', lane: 'realtime' });
    expect(微信.检测.map(x => x.content)).toEqual(['计算机专业有什么比赛', '帮你找到了智能汽车竞赛，报名 2026-10-28 截止。']);
    expect(记录.取(r.data.turnId)).toMatchObject({ openid: 'o1', status: 'answered', message: '计算机专业有什么比赛' });
  });
});
