import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  runFieldVerification, validateFieldVerificationResult, buildFieldVerificationPrompt, buildRequestBody, PROFESSION_TAXONOMY,
} = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: { get: () => '' },
  };
}

const record = { id: 'e1', name: '某某挑战赛', schedule: {}, sources: [] };

const wellFormedResult = {
  name_correct: true, name_correction: '',
  registration_start_status: 'confirmed_correct', registration_start_correction: '',
  registration_end_status: 'confirmed_correct', registration_end_correction: '',
  registration_url_correct: true, registration_url_correction: '',
  professions: ['计算机与AI'], professions_confident: true,
  summary: '三项核验通过',
};

describe('field verification result validation', () => {
  it('requires the plain correctness booleans (name/url/professions_confident)', () => {
    const { name_correct, ...rest } = wellFormedResult;
    expect(() => validateFieldVerificationResult(rest)).toThrow('ai_field_verification_invalid_name_correct');
  });

  it('requires the date fields to be one of the three known statuses, not a boolean', () => {
    expect(() => validateFieldVerificationResult({ ...wellFormedResult, registration_start_status: true }))
      .toThrow('ai_field_verification_invalid_registration_start_status');
    expect(() => validateFieldVerificationResult({ ...wellFormedResult, registration_end_status: 'unknown_value' }))
      .toThrow('ai_field_verification_invalid_registration_end_status');
  });

  it('requires professions to be an array', () => {
    expect(() => validateFieldVerificationResult({ ...wellFormedResult, professions: null }))
      .toThrow('ai_field_verification_invalid_professions');
  });

  it('accepts a well-formed result', () => {
    expect(validateFieldVerificationResult(wellFormedResult)).toBe(wellFormedResult);
  });
});

describe('field verification prompt', () => {
  it('only offers profession choices from the real taxonomy', () => {
    const prompt = buildFieldVerificationPrompt(record, []);
    for (const label of PROFESSION_TAXONOMY) expect(prompt).toContain(label);
  });

  it('gives an explicit field-name example, not just prose — json_object mode has no schema to enforce it', () => {
    // 实测 2026-09-19：json_schema 模式当前对 DeepSeek 不可用，退化成 json_object 后
    // 模型只受提示词字面约束；没有示例时它把 url_correct 自己改写成了 registration_url_correct。
    const prompt = buildFieldVerificationPrompt(record, []);
    expect(prompt).toContain('registration_start_status');
    expect(prompt).toContain('registration_end_status');
    expect(prompt).toContain('registration_url_correct');
  });

  it('explains that "source never mentions this date" is not the same as "the record is wrong"', () => {
    // 实测 2026-09-19：来源没写报名日期时，之前的布尔字段把它和"日期错了"
    // 混为一谈，把没公布日期的合法赛事也一起拦住不让发布。
    const prompt = buildFieldVerificationPrompt(record, []);
    expect(prompt).toContain('not_specified');
    expect(prompt).toContain('不算错误');
  });
});

describe('the json_schema request actually carries the field-verification schema, not the general review schema', () => {
  // 回归测试：buildResponseFormat 曾经硬编码引用 resultSchema（通用审核的
  // decision/risk_level/summary/issues），三项核验请求 json_schema 模式时
  // 会被套上完全不相关的结构。当时被"该模式暂不可用"的 400 意外掩盖了。
  it('routes options.schema through to the request body', () => {
    const body = buildRequestBody({ model: 'm' }, [], { useJsonSchema: true, schema: { type: 'object', properties: { registration_start_status: {} } } });
    expect(body.response_format.json_schema.schema.properties).toHaveProperty('registration_start_status');
    expect(body.response_format.json_schema.schema.properties).not.toHaveProperty('decision');
  });

  it('falls back to the general review schema when no schema is given, keeping old callers working', () => {
    const body = buildRequestBody({ model: 'm' }, [], { useJsonSchema: true });
    expect(body.response_format.json_schema.schema.properties).toHaveProperty('decision');
  });
});

describe('runFieldVerification', () => {
  const originalKey = process.env.AI_API_KEY;
  const originalBaseUrl = process.env.AI_BASE_URL;
  beforeEach(() => { process.env.AI_API_KEY = 'test-key'; process.env.AI_BASE_URL = 'https://api.example.com/v1'; });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = originalKey;
    if (originalBaseUrl === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = originalBaseUrl;
  });

  it('refuses to run without a configured key', async () => {
    delete process.env.AI_API_KEY;
    await expect(runFieldVerification(record, () => {})).rejects.toThrow('ai_api_key_not_configured');
  });

  it('computes all_correct from name/dates/url, not from a model-supplied summary field', async () => {
    const request = async () => jsonResponse(200, { choices: [{ message: { content: JSON.stringify({
      ...wellFormedResult, registration_url_correct: false, registration_url_correction: 'https://real.example/notice', summary: '链接对不上',
    }) } }] });
    const result = await runFieldVerification(record, request);
    expect(result.all_correct).toBe(false);
    expect(result.registration_url_correction).toBe('https://real.example/notice');
  });

  it('reports all_correct true when both dates are confirmed correct and name/url pass', async () => {
    const request = async () => jsonResponse(200, { choices: [{ message: { content: JSON.stringify(wellFormedResult) } }] });
    const result = await runFieldVerification(record, request);
    expect(result.all_correct).toBe(true);
  });

  // 实测 2026-09-19：这是"不是一定要报名时间，只要知道有这个比赛就可以了"
  // 这条产品要求对应的行为——来源没写日期不该拦住发布。
  it('treats a date the source never mentions as resolved, not as a failure', async () => {
    const request = async () => jsonResponse(200, { choices: [{ message: { content: JSON.stringify({
      ...wellFormedResult, registration_start_status: 'not_specified', registration_end_status: 'not_specified',
    }) } }] });
    const result = await runFieldVerification(record, request);
    expect(result.all_correct).toBe(true);
  });

  it('still fails when a date is genuinely wrong (source contradicts the record)', async () => {
    const request = async () => jsonResponse(200, { choices: [{ message: { content: JSON.stringify({
      ...wellFormedResult, registration_start_status: 'incorrect', registration_start_correction: '2026-10-15',
    }) } }] });
    const result = await runFieldVerification(record, request);
    expect(result.all_correct).toBe(false);
  });

  it('degrades to json_object when json_schema mode is rejected, and still parses the result', async () => {
    // 复现 2026-09-19 实测的真实失败路径：DeepSeek 对 json_schema 返回 400，
    // 退化到 json_object 后模型正常作答。
    let call = 0;
    const request = async () => {
      call += 1;
      if (call === 1) return jsonResponse(400, { error: { message: 'This response_format type is unavailable now' } });
      return jsonResponse(200, { choices: [{ message: { content: JSON.stringify(wellFormedResult) } }] });
    };
    const result = await runFieldVerification(record, request);
    expect(call).toBe(2);
    expect(result.all_correct).toBe(true);
  });

  it('surfaces provider errors instead of swallowing them', async () => {
    const request = async () => jsonResponse(500, { error: { message: 'boom' } });
    await expect(runFieldVerification(record, request)).rejects.toThrow('ai_provider_error');
  });
});
