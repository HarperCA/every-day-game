// 05 审核：总审核依次调 程序审核（范围闸、资料齐不齐、收录门槛）→ 三项核验；都过了交给 06 入库，没过的经小数据库标已丢弃，
// 原因写明是 05 审核的哪一步（2026-11-01 用户定：过了才入库，不过就不入库，没有待人工审核）。不连网、不调真实 AI。
import { describe, expect, test } from 'vitest';
import { fakeCtx } from '../../../../test/复用/假ctx.mjs';
import * as review from '../../index.mjs';
import { 三项核验, 提示词文件, 专业分类 } from '../../三项核验/index.mjs';
import { 合成记录 } from '../../../../common/candidate.mjs';
import { loadPrompt } from '../../../../common/prompt.mjs';

const now = '2026-11-01T12:00:00.000Z';
const 正文 = '第十届全国大学生某某竞赛由中国某某学会主办，面向全国普通高校在校本科生和研究生，报名时间 2026 年 11 月 1 日至 12 月 1 日，报名网址 https://reg.xh.org.cn 。'.repeat(3);
// 04 抽取过的候选
const 抽过 = (key, extra = {}, fields = {}) => ({ key, kind: 'candidate', status: '进行中', stage: '04-extract', data: { name: '第十届全国大学生某某竞赛通知页', url: key, snippet: '学会主办', ...extra,
  extraction: { fields: { competition_name: { value: '全国大学生某某竞赛', quote: '全国大学生某某竞赛' }, organizer: { value: '中国某某学会', quote: '由中国某某学会主办' },
    participants: { value: '全国普通高校在校本科生和研究生', quote: '面向全国普通高校在校本科生和研究生' }, format_and_rules: { value: '提交设计作品，专家评审', quote: '提交设计作品' },
    registration_start: { value: '2026-11-01', quote: '2026 年 11 月 1 日' }, registration_end: { value: '2026-12-01', quote: '12 月 1 日' }, ...fields } } } });
// 三项核验 Kimi 的回答
const 核对 = (over = {}) => ({ 名称对不对: true, 名称改正: '', 报名开始状态: '一致', 报名开始改正: '', 报名截止状态: '一致', 报名截止改正: '', 报名网址对不对: true, 报名网址改正: '',
  专业分类: ['设计与艺术'], 专业有把握: true, 来源性质: '官方', 摘要: '名称、时间、网址和来源一致', ...over });

function 假AI(回答们) {
  const ai = { calls: [], 报告: [], chat: async req => { ai.calls.push(req); const r = 回答们[ai.calls.length - 1]; if (r instanceof Error) throw r; return { data: typeof r === 'function' ? r(req) : r }; }, 报告问题: x => ai.报告.push(x) };
  return ai;
}
function 假web(表) {
  return { 读过: [], 读网页: async function (url) { this.读过.push(url); return 表[url] ? { url, finalUrl: url, status: '成功', title: '大赛通知', text: 表[url], links: [] } : { url, finalUrl: url, status: 'HTTP错误', title: '', text: '', links: [], error: '对方返回 404' }; } };
}
function 装(ctx, { ai = [], web = {}, 候选们 = [] } = {}) {
  ctx.ai = 假AI(ai);
  ctx.web = 假web(web);
  const 删过 = [];
  ctx.小数据库 = { 查找: ({ kind } = {}) => 候选们.filter(c => !kind || c.kind === kind).filter(c => !删过.some(d => d.key === c.key)), 删除: 列表 => { 删过.push(...列表); return { 删除: 列表.length }; } };
  return 删过;
}

describe('合成记录（common/candidate.mjs）', () => {
  test('抽取结果并进候选，用新库的字段名；来源是候选网址（补读到的正式通知也算）', () => {
    const r = 合成记录(抽过('https://xh.org.cn/n/1', { supplement: undefined }).data);
    expect(r).toMatchObject({ name: '全国大学生某某竞赛', organizer: '中国某某学会', participants: '全国普通高校在校本科生和研究生', format_and_rules: '提交设计作品，专家评审',
      registration_start: '2026-11-01', registration_end: '2026-12-01', registration_url: 'https://xh.org.cn/n/1', introduction: '学会主办', sources: [{ url: 'https://xh.org.cn/n/1' }] });
    const 带通知 = 抽过('https://xh.org.cn/n/1').data;
    带通知.extraction.supplement = { notice: { used: true, url: 'https://xh.org.cn/n/2' } };
    expect(合成记录(带通知).sources).toEqual([{ url: 'https://xh.org.cn/n/1' }, { url: 'https://xh.org.cn/n/2' }]);
  });
});

describe('三项核验', () => {
  const 记录 = () => ({ ...合成记录(抽过('https://xh.org.cn/n/1').data), professions: [] });
  test('提示词放在 prompt.md，第一行是版本号；专业分类是小程序用的十三类', () => {
    expect(loadPrompt(提示词文件, { 专业分类: '', 记录: '{}', 来源: '[]' }).version).toMatch(/^verify-v\d+$/);
    expect(专业分类).toHaveLength(13);
  });
  test('读来源网页（ctx.web.读网页），经 AI 总管（用途 verify）交给 Kimi；全对就通过，交回补上专业分类的记录和核验过的官方来源', async () => {
    const ctx = fakeCtx({ now });
    装(ctx, { ai: [核对()], web: { 'https://xh.org.cn/n/1': 正文 } });
    const r = await 三项核验(记录(), ctx);
    expect(r.通过).toBe(true);
    expect(ctx.web.读过).toEqual(['https://xh.org.cn/n/1']);
    expect(ctx.ai.calls[0]).toMatchObject({ purpose: 'verify', json: true, promptVersion: expect.stringMatching(/^verify-v/) });
    expect(ctx.ai.calls[0].messages.map(m => m.content).join()).toContain('中国某某学会主办');
    expect(r.记录.professions).toEqual(['设计与艺术']);
    expect(r.来源们).toEqual([expect.objectContaining({ url: 'https://xh.org.cn/n/1', is_official: true, validity_status: 'valid', title: '大赛通知', content_summary: '名称、时间、网址和来源一致',
      evidence_excerpt: expect.stringContaining('由中国某某学会主办'), review_reason: expect.stringContaining('三项核验通过'), supports_fields: ['name', 'registration_start', 'registration_end', 'registration_url'], last_verified_at: now })]);
  });
  test('原文给了改正值的照改（名称、时间、网址）；原文没写报名时间的清空、标“时间待公布”，都不算没过', async () => {
    const ctx = fakeCtx({ now });
    装(ctx, { ai: [核对({ 名称对不对: false, 名称改正: '全国大学生某某设计竞赛', 报名开始状态: '原文没写', 报名截止状态: '不一致', 报名截止改正: '2026-12-10', 报名网址对不对: false, 报名网址改正: 'https://reg.xh.org.cn' })], web: { 'https://xh.org.cn/n/1': 正文 } });
    const r = await 三项核验(记录(), ctx);
    expect(r.通过).toBe(true);
    expect(r.记录).toMatchObject({ name: '全国大学生某某设计竞赛', registration_start: null, registration_end: '2026-12-10', registration_url: 'https://reg.xh.org.cn', pending_announcement: false });
    expect(r.来源们[0].supports_fields).toEqual(['name', 'registration_end', 'registration_url']);
  });
  test.each([
    ['名称不对又给不出改正', { 名称对不对: false }, '名称'],
    ['报名截止不对又给不出改正', { 报名截止状态: '不一致' }, '报名截止'],
    ['网址不对又给不出改正', { 报名网址对不对: false, 报名网址改正: '不是网址' }, '报名网址'],
    ['定不了专业分类', { 专业分类: [], 专业有把握: false }, '专业分类'],
    ['来源是学校转发', { 来源性质: '学校通知' }, '官方'],
  ])('没过：%s', async (_, over, 关键词) => {
    const ctx = fakeCtx({ now });
    装(ctx, { ai: [核对(over)], web: { 'https://xh.org.cn/n/1': 正文 } });
    const r = await 三项核验(记录(), ctx);
    expect(r.通过).toBe(false);
    expect(r.原因).toContain(关键词);
  });
  test('来源正文一个都没读到：不调 AI，直接没过', async () => {
    const ctx = fakeCtx({ now });
    装(ctx, { ai: [] });
    const r = await 三项核验(记录(), ctx);
    expect(r).toMatchObject({ 通过: false, 原因: expect.stringContaining('来源正文没读到') });
    expect(ctx.ai.calls).toHaveLength(0);
  });
  test('调用出错抛给调用方；返回内容用不了先报告给 AI 总管再抛；专业分类不在十三类里也算用不了', async () => {
    const c1 = fakeCtx({ now }); 装(c1, { ai: [new Error('Kimi 超时')], web: { 'https://xh.org.cn/n/1': 正文 } });
    await expect(三项核验(记录(), c1)).rejects.toThrow('Kimi 超时');
    const c2 = fakeCtx({ now }); 装(c2, { ai: [核对({ 报名开始状态: '大概对' })], web: { 'https://xh.org.cn/n/1': 正文 } });
    await expect(三项核验(记录(), c2)).rejects.toThrow('报名开始状态');
    expect(c2.ai.报告[0]).toMatchObject({ purpose: 'verify' });
    const c3 = fakeCtx({ now }); 装(c3, { ai: [核对({ 专业分类: ['火星学'] })], web: { 'https://xh.org.cn/n/1': 正文 } });
    await expect(三项核验(记录(), c3)).rejects.toThrow('专业分类');
  });
});

describe('总审核', () => {
  const 收录再判 = { 值得收录: true, 有把握: true, 理由: '学会主办' };
  test('程序审核、三项核验都过了：交给 06（data.review 里放核验后的记录和来源），不删', async () => {
    const ctx = fakeCtx({ now });
    const 删过 = 装(ctx, { ai: [核对()], web: { 'https://xh.org.cn/n/1': 正文 }, 候选们: [抽过('https://xh.org.cn/n/1'), { ...抽过('https://raw.cn'), data: { name: '没抽取过', url: 'https://raw.cn' } }] });
    const out = await review.run({ runId: '2026-11-01' }, ctx);
    expect(删过).toEqual([]);
    expect(out.items).toEqual([expect.objectContaining({ key: 'https://xh.org.cn/n/1', status: '进行中', result: '通过',
      data: expect.objectContaining({ review: expect.objectContaining({ 结果: '通过', 档: '直接收', 记录: expect.objectContaining({ professions: ['设计与艺术'] }), 来源们: [expect.objectContaining({ is_official: true })] }) }) })]);
    expect(out.changes).toEqual([]);
  });
  test('程序审核“不收”的：标已丢弃，原因写“05 审核·哪一关”，并记拒过的网址', async () => {
    const ctx = fakeCtx({ now });
    const 删过 = 装(ctx, { 候选们: [抽过('https://w.cn/1', {}, { competition_name: { value: '2026中小学智能未来邀请赛', quote: 'x' } })] });
    const out = await review.run({ runId: '2026-11-01' }, ctx);
    expect(删过).toEqual([{ key: 'https://w.cn/1', 原因: '05 审核·范围闸：非大学生专业赛事' }]);
    expect(out.changes).toEqual([expect.objectContaining({ table: 'rejected_url', itemKey: 'https://w.cn/1', payload: expect.objectContaining({ module: '05-review', reason: '05 审核·范围闸：非大学生专业赛事' }) })]);
  });
  test('资料不齐（待定）、门槛证据不足 AI 再判也没把握、依据来自图片识别、三项核验没过：都标已丢弃写明哪一步，不记拒过', async () => {
    const ctx = fakeCtx({ now });
    const 删过 = 装(ctx, {
      ai: [{ 值得收录: true, 有把握: false, 理由: '资料太少' }, 核对({ 来源性质: '学校通知' })],
      web: { 'https://d.cn/4': 正文 },
      候选们: [
        抽过('https://a.cn/1', {}, { organizer: { value: '', quote: '' } }),
        抽过('https://b.cn/2', {}, { organizer: { value: '某科技公司', quote: '某科技公司' } }),
        { ...抽过('https://c.cn/3'), data: { ...抽过('https://c.cn/3').data, extraction: { ...抽过('https://c.cn/3').data.extraction, imageEvidenceFields: ['报名截止'] } } },
        抽过('https://d.cn/4'),
      ],
    });
    const out = await createRunWith1(ctx);
    expect(删过.map(d => [d.key, d.原因.split('：')[0]])).toEqual([
      ['https://a.cn/1', '05 审核·资料齐不齐'], ['https://b.cn/2', '05 审核·收录门槛'], ['https://c.cn/3', '05 审核·图片依据'], ['https://d.cn/4', '05 审核·三项核验'],
    ]);
    expect(删过[1].原因).toContain('资料太少');
    expect(out.changes).toEqual([]);
    expect(out.items).toEqual([]);
  });
  test('收录门槛判成要人看、AI 再判值得收录且有把握：升成直接收，再做三项核验', async () => {
    const ctx = fakeCtx({ now });
    装(ctx, { ai: [收录再判, 核对()], web: { 'https://b.cn/2': 正文 }, 候选们: [抽过('https://b.cn/2', {}, { organizer: { value: '某科技公司', quote: '某科技公司' } })] });
    const out = await createRunWith1(ctx);
    expect(out.items[0].data.review).toMatchObject({ 结果: '通过', 档: '直接收' });
  });
  test('AI 调用出错（再判、三项核验）：这一条标已丢弃写明出错，不截断整晚，也不记拒过（明晚还会再搜到）', async () => {
    const ctx = fakeCtx({ now });
    const 删过 = 装(ctx, { ai: [new Error('Kimi 超时')], web: { 'https://xh.org.cn/n/1': 正文 }, 候选们: [抽过('https://xh.org.cn/n/1')] });
    const out = await review.run({ runId: '2026-11-01' }, ctx);
    expect(删过).toEqual([{ key: 'https://xh.org.cn/n/1', 原因: '05 审核·三项核验：调用出错：Kimi 超时' }]);
    expect(out.changes).toEqual([]);
  });
  test('放宽资料（只给维护用，2026-11-08 用户定“这些资料不一定要有，没有就算了”）：资料齐不齐缺字段、范围闸“缺少依据”的待定不挡，接着过收录门槛和三项核验；明确不收的照挡', async () => {
    const ctx = fakeCtx({ now });
    const 删过 = 装(ctx, { web: { 'https://a.cn/1': 正文 }, 候选们: [
      抽过('https://a.cn/1', {}, { competition_name: { value: '全国某某设计竞赛', quote: '全国某某设计竞赛' }, organizer: { value: '', quote: '' }, participants: { value: '', quote: '' } }),
      抽过('https://w.cn/1', {}, { competition_name: { value: '2026中小学智能未来邀请赛', quote: 'x' } }),
    ] });
    ctx.ai = { calls: [], 报告问题() {}, chat: async req => { ctx.ai.calls.push(req); return { data: req.purpose === 'admission' ? 收录再判 : 核对() }; } };
    const out = await review.run({ runId: '2026-11-08', 放宽资料: true }, ctx);
    expect(删过).toEqual([{ key: 'https://w.cn/1', 原因: '05 审核·范围闸：非大学生专业赛事' }]);
    expect(out.items.map(x => x.key)).toEqual(['https://a.cn/1']);
    expect(out.items[0].data.review.过程.join('；')).toMatch(/范围闸：缺少大学生参赛资格依据（放宽，不挡）/);
    expect(out.items[0].data.review.过程.join('；')).toMatch(/资料齐不齐：缺少主办方.*（放宽，不挡）/);
  });
  test('不放宽（每晚流程）：同样缺资料的照旧挡在范围闸', async () => {
    const ctx = fakeCtx({ now });
    const 删过 = 装(ctx, { 候选们: [抽过('https://a.cn/1', {}, { competition_name: { value: '全国某某设计竞赛', quote: '全国某某设计竞赛' }, organizer: { value: '', quote: '' }, participants: { value: '', quote: '' } })] });
    await review.run({ runId: '2026-11-08' }, ctx);
    expect(删过).toEqual([{ key: 'https://a.cn/1', 原因: '05 审核·范围闸：缺少大学生参赛资格依据' }]);
  });
  test('没有要审核的：什么都不调', async () => {
    const ctx = fakeCtx({ now });
    装(ctx, {});
    expect(await review.run({}, ctx)).toEqual({ items: [], changes: [], problems: [] });
  });
});

// 并发 1：按调用顺序排好的假回答才对得上
const createRunWith1 = ctx => review.createRun({ ...review.DEFAULT_PARTS, 并发: 1 })({ runId: '2026-11-01' }, ctx);
