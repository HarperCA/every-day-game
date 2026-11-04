// Jev：判断题怎么发、答案怎么整理。用假的 fetch，不连真实接口。
import { describe, expect, test } from 'vitest';
import { createJev } from '../../index.mjs';

const questions = {
  link_0: { type: 'choice', instructions: '这个链接是什么', choices: { registration: '报名', other: '无关' } },
  link_1: { type: 'choice', instructions: '同上', choices: {} },
};

describe('Jev 判断', () => {
  test('按题号交回选了什么和各类概率；没答的题交回 null', async () => {
    let sent;
    const jev = createJev({ fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ answers: { link_0: { choice: 'registration', probabilities: { registration: 0.92, other: 0.08 } } } })); } });
    const out = await jev.decide({ model: 'typesafe/jev-1.13', state: { contestName: '数模' }, questions, key: 'k' });
    expect(sent).toMatchObject({ url: 'https://openrouter.ai/api/alpha/decisions', body: { model: 'typesafe/jev-1.13', state: { contestName: '数模' } } });
    expect(out.answers).toEqual({ link_0: { choice: 'registration', probabilities: { registration: 0.92, other: 0.08 } }, link_1: { choice: null, probabilities: {} } });
  });
  test('没有题、返回里没有 answers：明确报错', async () => {
    const jev = createJev({ fetchImpl: async () => new Response('{}') });
    await expect(jev.decide({ questions: {}, key: 'k' })).rejects.toMatchObject({ kind: '请求有误' });
    await expect(jev.decide({ questions, key: 'k' })).rejects.toMatchObject({ kind: '对方出错' });
  });
});
