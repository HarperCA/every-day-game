import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildAdmissionJudgmentPrompt, judgeAdmissionWithAi, validateJudgment,
} = require('../apps/miniprogram/cloudfunctions/adminData/competitionAdmissionAi.js');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: { get: () => '' },
  };
}

const candidate = { name: '蚂蚁灵波具身大模型挑战赛', organizer: '蚂蚁灵波科技、魔搭社区、阿里云天池', reward_highlights: ['现金奖金', '创业扶持'] };

describe('admission judgment result validation', () => {
  it('requires both booleans', () => {
    expect(() => validateJudgment({ confident: true, reason: 'x' })).toThrow('ai_admission_judgment_invalid_worth_including');
    expect(() => validateJudgment({ worth_including: true, reason: 'x' })).toThrow('ai_admission_judgment_invalid_confident');
  });

  it('requires a non-empty reason so the call is auditable', () => {
    expect(() => validateJudgment({ worth_including: true, confident: true, reason: '' })).toThrow('ai_admission_judgment_invalid_reason');
  });

  it('accepts a well-formed result', () => {
    const value = { worth_including: true, confident: true, reason: '主办方为知名技术平台，有实质回报' };
    expect(validateJudgment(value)).toBe(value);
  });
});

describe('admission judgment prompt', () => {
  it('states the same "obscure is not worthless" principle as the keyword filter', () => {
    const prompt = buildAdmissionJudgmentPrompt(candidate);
    expect(prompt).toContain('冷门');
    expect(prompt).toContain('不是拒绝理由');
  });

  it('instructs the model to stay uncertain rather than guess when evidence is thin', () => {
    const prompt = buildAdmissionJudgmentPrompt(candidate);
    expect(prompt).toContain('confident 填 false');
    expect(prompt).toContain('不要脑补');
  });

  it('embeds the candidate data for grounding', () => {
    const prompt = buildAdmissionJudgmentPrompt(candidate);
    expect(prompt).toContain('蚂蚁灵波');
  });
});

describe('judgeAdmissionWithAi', () => {
  const originalKey = process.env.EXTRACT_AI_API_KEY;
  const originalBaseUrl = process.env.EXTRACT_AI_BASE_URL;
  beforeEach(() => { process.env.EXTRACT_AI_API_KEY = 'test-key'; process.env.EXTRACT_AI_BASE_URL = 'https://api.example.com/v1'; });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.EXTRACT_AI_API_KEY; else process.env.EXTRACT_AI_API_KEY = originalKey;
    if (originalBaseUrl === undefined) delete process.env.EXTRACT_AI_BASE_URL; else process.env.EXTRACT_AI_BASE_URL = originalBaseUrl;
  });

  it('refuses to run without the extraction-side key configured (separate from the review key)', async () => {
    delete process.env.EXTRACT_AI_API_KEY;
    await expect(judgeAdmissionWithAi(candidate, () => {})).rejects.toThrow('ai_api_key_not_configured');
  });

  it('returns a judgment the caller can act on', async () => {
    const request = async () => jsonResponse(200, { choices: [{ message: { content: JSON.stringify({
      worth_including: true, confident: true, reason: '主办方含知名技术平台，且有创业扶持等实质回报',
    }) } }] });
    const result = await judgeAdmissionWithAi(candidate, request);
    expect(result.worth_including).toBe(true);
    expect(result.confident).toBe(true);
    expect(result.provider).toBeTruthy();
  });

  it('surfaces provider errors instead of silently defaulting to a verdict', async () => {
    const request = async () => jsonResponse(500, { error: { message: 'boom' } });
    await expect(judgeAdmissionWithAi(candidate, request)).rejects.toThrow('ai_provider_error');
  });
});
