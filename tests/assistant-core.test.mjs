import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { NOW, RECORDS } from './assistant-fixtures.mjs';
const require = createRequire(import.meta.url);
const core = require('../apps/miniprogram/cloudfunctions/assistant/assistantCore.js');

// 假模型：按顺序吐出预先写好的回复，并记下每次收到的请求
function fakeChat(responses) {
  const calls = [];
  const chat = async request => {
    calls.push(JSON.parse(JSON.stringify(request)));
    const next = responses[calls.length - 1];
    if (!next) throw new Error('fake chat 没有准备这么多回复');
    return typeof next === 'function' ? next(request) : next;
  };
  chat.model = 'fake-model';
  chat.calls = calls;
  return chat;
}
const toolCall = (name, args, id = `call-${name}`) => ({ id, type:'function', function:{ name, arguments:JSON.stringify(args) } });
const modelSays = (content, toolCalls) => ({ ok:true, status:200, message:{ role:'assistant', content, ...(toolCalls ? { tool_calls:toolCalls } : {}) }, raw:'{}', elapsedMs:5 });
const pass = async () => ({ suggest:'pass', label:100, traceId:'t' });

function deps(chat, overrides = {}) {
  const logs = [];
  return {
    logs,
    openid:'o-tester',
    chat,
    now:() => NOW,
    secCheck:pass,
    loadRecords:async () => RECORDS,
    loadHistory:async () => [],
    saveLog:async entry => { logs.push(entry); },
    ...overrides,
  };
}
const ask = (message, extra = {}) => ({ message, sessionId:'', profileCategories:[], ...extra });

describe('赛事助手：正常问答', () => {
  it('先查再答：卡片来自赛事库，回答标为 AI 生成，写一条记录', async () => {
    const chat = fakeChat([
      modelSays('', [toolCall('search_competitions', { professions:['计算机与AI'], participationFormats:['团队赛', '个人或团队均可'] })]),
      modelSays('按计算机与AI、能组队帮你查到 2 场，智能汽车竞赛 2026-10-28 截止。'),
    ]);
    const d = deps(chat);
    const result = await core.answer(ask('计算机专业能组队的比赛'), d);
    expect(result.ok).toBe(true);
    expect(result.data.status).toBe('answered');
    expect(result.data.aiGenerated).toBe(true);
    expect(result.data.cards.map(card => card.id).sort()).toEqual(['edition-a', 'edition-b']);
    expect(result.data.total).toBe(2);
    expect(result.data.filters).toEqual({ professions:['计算机与AI'], participationFormats:['团队赛', '个人或团队均可'] });
    expect(result.data.sessionId).toMatch(/^session-[0-9a-f]{24}$/);
    expect(chat.calls).toHaveLength(2);
    // 第二次调用里带着工具结果，且 tool_call_id 对得上
    const toolMessage = chat.calls[1].messages.find(message => message.role === 'tool');
    expect(toolMessage.tool_call_id).toBe('call-search_competitions');
    expect(d.logs).toHaveLength(1);
    expect(d.logs[0]).toMatchObject({ status:'answered', openid:'o-tester', model:'fake-model', cardIds:result.data.cards.map(card => card.id) });
    expect(d.logs[0].modelCalls).toHaveLength(2);
    expect(d.logs[0].toolCalls[0]).toMatchObject({ name:'search_competitions', total:2 });
  });

  it('查到 0 场：status 为 empty，没有卡片', async () => {
    const chat = fakeChat([modelSays('', [toolCall('search_competitions', { keyword:'围棋' })]), modelSays('赛事库里暂时没有围棋比赛。')]);
    const result = await core.answer(ask('有没有围棋比赛'), deps(chat));
    expect(result.data).toMatchObject({ status:'empty', cards:[], total:0, aiGenerated:true });
  });

  it('追问：返回问题和选项，本轮不再调用模型', async () => {
    const chat = fakeChat([modelSays('', [toolCall('ask_user', { question:'你是什么专业？', options:['计算机', '机械', '外语'] })])]);
    const result = await core.answer(ask('推荐比赛'), deps(chat));
    expect(result.data).toMatchObject({ status:'clarify', reply:'你是什么专业？', options:['计算机', '机械', '外语'], cards:[] });
    expect(chat.calls).toHaveLength(1);
  });

  it('跑题请求不查库直接回答：status 为 chat', async () => {
    const chat = fakeChat([modelSays('我只能帮你找比赛哦。')]);
    const result = await core.answer(ask('帮我写一首诗'), deps(chat));
    expect(result.data).toMatchObject({ status:'chat', reply:'我只能帮你找比赛哦。', cards:[], filters:null });
  });

  it('模型连续调工具：第三次强制写回答，总共不超过 3 次', async () => {
    const chat = fakeChat([
      modelSays('', [toolCall('search_competitions', { keyword:'围棋' }, 'c1')]),
      modelSays('', [toolCall('search_competitions', { keyword:'象棋' }, 'c2')]),
      modelSays('都没有查到。'),
    ]);
    const result = await core.answer(ask('棋类比赛'), deps(chat));
    expect(chat.calls.map(call => call.toolChoice)).toEqual(['auto', 'auto', 'none']);
    expect(result.data.status).toBe('empty');
  });

  it('非法参数被丢掉，查询照常执行，丢掉了什么写进记录', async () => {
    const chat = fakeChat([modelSays('', [toolCall('search_competitions', { professions:['量子玄学'], eventLevel:'国家级' })]), modelSays('查到了。')]);
    const d = deps(chat);
    const result = await core.answer(ask('国家级比赛'), d);
    expect(result.data.filters).toEqual({ eventLevel:'国家级' });
    expect(d.logs[0].toolCalls[0].dropped).toEqual(['professions']);
  });

  it('未知工具：告诉模型出错，不崩溃', async () => {
    const chat = fakeChat([modelSays('', [toolCall('delete_database', {})]), modelSays('抱歉，我只能查比赛。')]);
    const d = deps(chat);
    const result = await core.answer(ask('删库'), d);
    expect(result.data.status).toBe('chat');
    expect(d.logs[0].toolCalls[0]).toMatchObject({ name:'delete_database', unknown:true });
  });
});

describe('赛事助手：回答里的日期和网址', () => {
  it('出现工具结果以外的日期：整句换成模板，卡片照常', async () => {
    const chat = fakeChat([modelSays('', [toolCall('search_competitions', { keyword:'智能汽车' })]), modelSays('智能汽车竞赛 12月1日截止。')]);
    const d = deps(chat);
    const result = await core.answer(ask('智能汽车'), d);
    expect(result.data.reply).toBe(core.UNSAFE_OUTPUT_REPLY);
    expect(result.data.aiGenerated).toBe(false);
    expect(result.data.cards).toHaveLength(1);
    expect(d.logs[0].replyViolations).toEqual(['date:12月1日']);
  });

  it('照抄工具结果里的日期没问题，写法不同也认', async () => {
    expect(core.replyViolations('10月28日截止', [{ result:{ items:[{ registration_end:'2026-10-28' }] } }])).toEqual([]);
    expect(core.replyViolations('2026年10月28日截止', [{ result:{ items:[{ registration_end:'2026-10-28' }] } }])).toEqual([]);
    expect(core.replyViolations('2026-10-28 截止', [{ result:{ items:[{ registration_end:'2026-10-28' }] } }])).toEqual([]);
  });

  it('出现网址：换成模板；没有卡片时用拦截文案', async () => {
    const chat = fakeChat([modelSays('去 https://example.com 看看')]);
    const result = await core.answer(ask('有什么比赛'), deps(chat));
    expect(result.data.reply).toBe(core.BLOCKED_REPLY);
    expect(result.data.aiGenerated).toBe(false);
  });

  it('模型编出不存在的比赛名：卡片里不会有它', async () => {
    const chat = fakeChat([modelSays('', [toolCall('search_competitions', { keyword:'智能汽车' })]), modelSays('还有一个“宇宙编程大赛”也很适合你。')]);
    const result = await core.answer(ask('智能汽车'), deps(chat));
    expect(result.data.cards.map(card => card.name)).toEqual(['全国大学生智能汽车竞赛']);
  });

  it('去掉 Markdown 符号', () => {
    expect(core.cleanReply('**推荐**：`这些`')).toBe('推荐：这些');
    expect(core.cleanReply('# 标题')).toBe('标题');
  });
});

describe('赛事助手：内容安全', () => {
  it('用户输入被判 risky：直接拦截，模型一次都不调用', async () => {
    const chat = fakeChat([]);
    const d = deps(chat, { secCheck:async () => ({ suggest:'risky', label:20001 }) });
    const result = await core.answer(ask('违规内容'), d);
    expect(result.data).toMatchObject({ status:'blocked', aiGenerated:false, cards:[] });
    expect(chat.calls).toHaveLength(0);
    expect(d.logs[0].status).toBe('blocked');
  });

  it('输出被判 risky：换成模板，有卡片时照常给卡片', async () => {
    let count = 0;
    const secCheck = async () => (count++ === 0 ? { suggest:'pass' } : { suggest:'risky', label:20001 });
    const chat = fakeChat([modelSays('', [toolCall('search_competitions', { keyword:'智能汽车' })]), modelSays('一段被判违规的话')]);
    const result = await core.answer(ask('智能汽车'), deps(chat, { secCheck }));
    expect(result.data).toMatchObject({ status:'blocked', reply:core.UNSAFE_OUTPUT_REPLY, aiGenerated:false });
    expect(result.data.cards).toHaveLength(1);
  });

  it('review（拿不准）放行，并记下结果', async () => {
    const chat = fakeChat([modelSays('我只能帮你找比赛。')]);
    const d = deps(chat, { secCheck:async () => ({ suggest:'review', label:21000 }) });
    const result = await core.answer(ask('你好'), d);
    expect(result.data.status).toBe('chat');
    expect(d.logs[0].inputCheck).toMatchObject({ suggest:'review', blocked:false });
  });

  it('检测接口出错：宁可不答，模型不调用', async () => {
    const chat = fakeChat([]);
    const d = deps(chat, { secCheck:async () => { throw new Error('wechat_http_error:502'); } });
    expect(await core.answer(ask('找比赛'), d)).toEqual({ ok:false, message:'assistant_check_failed' });
    expect(chat.calls).toHaveLength(0);
    expect(d.logs[0].status).toBe('assistant_check_failed');
  });
});

describe('赛事助手：失败与上下文', () => {
  it('模型返回 500：assistant_ai_failed，原始返回写进记录', async () => {
    const chat = fakeChat([{ ok:false, status:500, raw:'{"error":"boom"}', elapsedMs:3 }]);
    const d = deps(chat);
    expect(await core.answer(ask('找比赛'), d)).toEqual({ ok:false, message:'assistant_ai_failed' });
    expect(d.logs[0].modelCalls[0]).toMatchObject({ status:500, raw:'{"error":"boom"}' });
  });

  it('模型超时：assistant_timeout', async () => {
    const chat = fakeChat([{ ok:false, status:0, timedOut:true, error:'TimeoutError', elapsedMs:12000 }]);
    expect(await core.answer(ask('找比赛'), deps(chat))).toEqual({ ok:false, message:'assistant_timeout' });
  });

  it('整轮预算用完就不再发起调用', async () => {
    let time = 0;
    const chat = fakeChat([() => { time += 19000; return modelSays('', [toolCall('search_competitions', {})]); }]);
    const result = await core.answer(ask('找比赛'), deps(chat, { clock:() => time }));
    expect(result).toEqual({ ok:false, message:'assistant_timeout' });
    expect(chat.calls).toHaveLength(1);
  });

  it('模型回了空内容：assistant_ai_failed', async () => {
    const chat = fakeChat([modelSays('')]);
    expect(await core.answer(ask('找比赛'), deps(chat))).toEqual({ ok:false, message:'assistant_ai_failed' });
  });

  it('带 sessionId：从记录取历史，按早到晚放在当前问题前面', async () => {
    const loadHistory = vi.fn(async () => [{ id:'turn-1', message:'计算机专业', reply:'想找什么类型的？' }]);
    const chat = fakeChat([modelSays('好的。')]);
    const sessionId = 'session-' + 'b'.repeat(24);
    const d = deps(chat, { loadHistory });
    const result = await core.answer(ask('团队赛', { sessionId }), d);
    expect(loadHistory).toHaveBeenCalledWith('o-tester', sessionId);
    expect(result.data.sessionId).toBe(sessionId);
    expect(chat.calls[0].messages.slice(1).map(message => [message.role, message.content]))
      .toEqual([['user', '计算机专业'], ['assistant', '想找什么类型的？'], ['user', '团队赛']]);
    expect(d.logs[0].history).toEqual(['turn-1']);
  });

  it('没带 sessionId 时不读历史', async () => {
    const loadHistory = vi.fn(async () => []);
    await core.answer(ask('你好'), deps(fakeChat([modelSays('你好')]), { loadHistory }));
    expect(loadHistory).not.toHaveBeenCalled();
  });

  it('记录写入失败：用户照样拿到回答', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const chat = fakeChat([modelSays('我只能帮你找比赛。')]);
    const result = await core.answer(ask('你好'), deps(chat, { saveLog:async () => { throw new Error('disk full'); } }));
    expect(result.ok).toBe(true);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('系统提示里有今天的北京日期和用户偏好', async () => {
    const chat = fakeChat([modelSays('好的。')]);
    await core.answer(ask('推荐比赛', { profileCategories:['计算机与AI'] }), deps(chat));
    const system = chat.calls[0].messages[0];
    expect(system.role).toBe('system');
    expect(system.content).toContain('今天是 2026-10-16');
    expect(system.content).toContain('计算机与AI');
  });
});
