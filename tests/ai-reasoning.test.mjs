// AI 思考过程：要求用中文思考、从返回里取出 reasoning_content、整理成存库的一条（2026-09-30 测试阶段打开）
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { REASONING_LANGUAGE_RULE, buildReasoningDoc, createReasoningCollector, reasoningFromPayload, withReasoningLanguage, MAX_STORED_CHARS } = require('../apps/miniprogram/cloudfunctions/adminData/aiReasoning.js');
const { buildRequestBody, runFieldVerification } = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');
const { extractFromDetailPage } = require('../apps/miniprogram/cloudfunctions/adminData/competitionExtract.js');

describe('要求用中文思考', () => {
  it('加在 system 末尾，没有 system 就补一条，不重复加', () => {
    const withSystem = withReasoningLanguage([{ role:'system', content:'你是审核助手。' }, { role:'user', content:'x' }]);
    expect(withSystem[0].content).toBe(`你是审核助手。\n${REASONING_LANGUAGE_RULE}`);
    expect(withReasoningLanguage(withSystem)).toBe(withSystem);
    expect(withReasoningLanguage([{ role:'user', content:'x' }])[0]).toEqual({ role:'system', content:REASONING_LANGUAGE_RULE });
  });
  it('每个请求体都带上', () => {
    const body = buildRequestBody({ model:'m', baseUrl:'https://api.kimi.com/coding/v1' }, [{ role:'user', content:'x' }], {});
    expect(body.messages[0].content).toContain('简体中文');
  });
});

describe('取出并整理思考过程', () => {
  const payload = { choices:[{ finish_reason:'stop', message:{ content:'{}', reasoning_content:'用户问两个名称是否同一比赛……' } }], usage:{ completion_tokens_details:{ reasoning_tokens:135 } } };
  it('有思考就取出文字、长度、token 数', () => {
    expect(reasoningFromPayload(payload)).toMatchObject({ text:'用户问两个名称是否同一比赛……', tokens:135, finishReason:'stop' });
    expect(reasoningFromPayload({ choices:[{ message:{ content:'x' } }] })).toBeNull();
  });
  it('超长的截取保存，并标明原长度', () => {
    const doc = buildReasoningDoc({ kind:'ai_review', recordId:'r1', recordName:'某大赛', reasoning:{ text:'想'.repeat(MAX_STORED_CHARS + 5) } });
    expect(doc).toMatchObject({ kind:'ai_review', record_id:'r1', chars:MAX_STORED_CHARS + 5, truncated:true });
    expect(doc.text).toHaveLength(MAX_STORED_CHARS);
  });
  it('收集器把赛事信息补到每一条上', () => {
    const collector = createReasoningCollector({ recordId:'r1', recordName:'某大赛' });
    collector.onReasoning({ kind:'field_verification', model:'kimi-for-coding', reasoning:reasoningFromPayload(payload) });
    expect(collector.docs()[0]).toMatchObject({ kind:'field_verification', record_id:'r1', record_name:'某大赛', model:'kimi-for-coding' });
  });
});

describe('调用点把思考过程交出来', () => {
  const reply = (content, reasoning, finish = 'stop') => async () => new Response(JSON.stringify({
    choices:[{ finish_reason:finish, message:{ content, reasoning_content:reasoning } }],
  }), { status:200 });

  it('三项核验：成功时回调拿到思考过程', async () => {
    process.env.AI_API_KEY = 'k';
    const seen = [];
    const verdict = JSON.stringify({ name_correct:true, registration_start_status:'not_specified', registration_end_status:'not_specified', registration_url_correct:true, professions:[], professions_confident:false, summary:'ok' });
    await runFieldVerification({ id:'r1', name:'某大赛', sources:[] }, reply(verdict, '先看名称是否一致……'), { onReasoning:entry => seen.push(entry) }).catch(() => {});
    expect(seen[0]).toMatchObject({ kind:'field_verification' });
    expect(seen[0].reasoning.text).toBe('先看名称是否一致……');
  });

  it('抽取：答案为空时不抛错，带回思考过程和截断原因', async () => {
    process.env.EXTRACT_AI_API_KEY = 'k';
    const text = '全国大学生某某竞赛面向全日制在校本科生。'.repeat(20);
    const result = await extractFromDetailPage('https://example.org/x', reply('', '想了很久……', 'length'), { contestName:'全国大学生某某竞赛', text });
    expect(result).toMatchObject({ ok:false, status:'ai_extract_empty_response', finishReason:'length' });
    expect(result.reasoning.text).toBe('想了很久……');
  });
});

describe('英文思考另存中文译文', () => {
  const { chineseRatio, needsTranslation, saveReasoningDocs, splitForTranslation, translateReasoning } = require('../apps/miniprogram/cloudfunctions/adminData/aiReasoning.js');

  it('汉字占不到一半才翻译；夹着中文引文的中文思考不翻', () => {
    expect(needsTranslation('Let me analyze the verification task. The record claims to be 第十二届国际高校BIM毕业设计大赛.')).toBe(true);
    expect(needsTranslation('先看名称：正文写“2026年第五届大学生英语翻译能力竞赛”，anchor 取 competition_name。')).toBe(false);
    expect(chineseRatio('')).toBe(1);
  });

  it('按段落切块，每块不超过上限', () => {
    const text = ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(130)].join('\n\n');
    const chunks = splitForTranslation(text, 60);
    expect(chunks.every(chunk => chunk.length <= 60)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });

  it('翻译请求关掉思考，逐块翻完拼起来', async () => {
    const bodies = [];
    const request = async (_url, init) => { const body = JSON.parse(init.body); bodies.push(body); return new Response(JSON.stringify({ choices:[{ message:{ content:`译文${bodies.length}` } }] }), { status:200 }); };
    const zh = await translateReasoning('First paragraph.\n\nSecond paragraph.', { request, env:{ EXTRACT_AI_API_KEY:'k' } });
    expect(zh).toBe('译文1');
    expect(bodies[0]).toMatchObject({ model:'deepseek-flash', thinking:{ type:'disabled' } });
  });

  it('先存原文，英文的再补上 text_zh；中文的不翻', async () => {
    const rows = new Map();
    let seq = 0;
    const db = { collection:() => ({
      add:async ({ data }) => { const id = `r${++seq}`; rows.set(id, { ...data }); return { _id:id }; },
      doc:id => ({ update:async ({ data }) => rows.set(id, { ...rows.get(id), ...data }) }),
    }) };
    const saved = await saveReasoningDocs(db, [
      { kind:'ai_review', text:'Let me analyze this audit task carefully before deciding.' },
      { kind:'extract', text:'我们需要从正文抽取事实，先看比赛名称。' },
    ], { translate:async text => `【译】${text.length}`, waitForTranslation:true });
    expect(saved).toBe(2);
    expect(rows.get('r1')).toMatchObject({ translation:'done', text_zh:expect.stringMatching(/^【译】/) });
    expect(rows.get('r2')).toMatchObject({ translation:'not_needed', text_zh:null });
  });
});
