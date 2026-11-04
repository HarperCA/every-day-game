// 04 的三步（2026-11-01 用户定）：读正文和补读只用读网页的现成工具；抽取先程序填，必要的四项填不齐才交 DeepSeek，回来的逐字核对原文。
// 读网页、AI 都是假的：读网页按网址交回统一格式的结果，AI 记下收到什么、交回定好的 JSON。
import { describe, expect, test } from 'vitest';
import { fakeCtx } from '../../../../test/复用/假ctx.mjs';
import { readSource } from '../../steps/read-source.mjs';
import { extractFields } from '../../steps/extract.mjs';
import { supplement } from '../../steps/supplement.mjs';

const 页 = (url, fields = {}) => ({ url, finalUrl: url, status: '成功', httpStatus: 200, contentType: 'text/html', title: '', text: '', links: [], error: '', ...fields });
function 假网(页们) {
  const 读过 = [];
  return { 读过, 读网页: async url => { 读过.push(url); return 页们[url] || 页(url, { status: 'HTTP错误', httpStatus: 404, error: '404' }); } };
}
const 候选 = (data = {}) => ({ key: 'https://a.cn/', kind: 'candidate', status: '进行中', data: { name: '全国大学生数学建模竞赛', url: 'https://a.cn/', ...data } });

describe('读正文：读网页读详情页，再读最多 3 个报名入口、通知、附件链接', () => {
  const 链接 = (url, kind, text = '链接') => ({ url, kind, text });
  test('详情页在前，链接页跟在后面，写明链接是什么、实际网址；只读这三类、最多 3 个；还没读的通知链接交给补读', async () => {
    const web = 假网({
      'https://a.cn/': 页('https://a.cn/', { text: '首页正文', links: [链接('https://a.cn/n1', '通知', '关于举办竞赛的通知'), 链接('https://a.cn/f.pdf', '附件', '章程'),
        链接('https://a.cn/n2', '通知', '补充通知'), 链接('https://a.cn/reg', '报名入口', '报名'), 链接('https://a.cn/about', '其他', '关于我们'), 链接('https://a.cn/n3', '通知', '第三个通知')] }),
      'https://a.cn/n1': 页('https://a.cn/n1', { text: '通知正文' }),
      'https://a.cn/f.pdf': 页('https://a.cn/f.pdf', { contentType: 'application/pdf', text: 'PDF 正文' }),
      'https://a.cn/n2': 页('https://a.cn/n2', { status: '超时', error: '超时' }),
    });
    const r = await readSource(候选(), { ...fakeCtx(), web });
    expect(web.读过).toEqual(['https://a.cn/', 'https://a.cn/n1', 'https://a.cn/f.pdf', 'https://a.cn/n2']);
    expect(r).toMatchObject({ ok: true, url: 'https://a.cn/', 读过: ['https://a.cn/', 'https://a.cn/n1', 'https://a.cn/f.pdf'] });
    expect(r.text).toBe('来源页面：https://a.cn/\n首页正文\n\n链接（通知）：关于举办竞赛的通知；实际网址：https://a.cn/n1\n通知正文\n\n链接（附件）：章程；实际网址：https://a.cn/f.pdf\nPDF 正文');
    expect(r.余下通知.map(l => l.url)).toEqual(['https://a.cn/n3']);
  });
  test('详情页读不到：网络、超时、对方 5xx 能下一晚再试，别的不能；原因写明', async () => {
    const 读 = 结果 => readSource(候选(), { ...fakeCtx(), web: 假网({ 'https://a.cn/': 页('https://a.cn/', 结果) }) });
    expect(await 读({ status: '超时', error: '20 秒没读完' })).toEqual({ ok: false, retryable: true, reason: '超时：20 秒没读完' });
    expect(await 读({ status: 'HTTP错误', httpStatus: 503, error: '503' })).toMatchObject({ ok: false, retryable: true });
    expect(await 读({ status: 'robots不允许', error: '网站不让读' })).toEqual({ ok: false, retryable: false, reason: 'robots不允许：网站不让读' });
    expect(await readSource(候选({ url: '' }), { ...fakeCtx(), web: 假网({}) })).toEqual({ ok: false, retryable: false, reason: '没有网址' });
  });
  test('正文太短（多半是脚本加载的空壳页）也交回，让抽取判空壳、交给重读', async () => {
    const r = await readSource(候选(), { ...fakeCtx(), web: 假网({ 'https://a.cn/': 页('https://a.cn/', { status: '正文太短', text: '首页 登录', error: '只有 5 字' }) }) });
    expect(r).toMatchObject({ ok: true, text: '来源页面：https://a.cn/\n首页 登录' });
  });
});

const 通知全 = [
  '关于举办2026年全国大学生数学建模竞赛的通知',
  '一、主办单位：中国工业与应用数学学会',
  '二、参赛对象：全日制在校本科生、研究生',
  '三、竞赛形式：三人一队，72 小时内完成一道建模题并提交论文',
  '四、报名时间：2026年9月1日至2026年9月20日',
  // 真实通知页都在两百字以上（不到两百字的按旧规则当空壳页）
  '全国大学生数学建模竞赛创办于1992年，每年一届，目的在于激励学生学习数学的积极性，提高学生建立数学模型和运用计算机技术解决实际问题的综合能力，'
    + '鼓励广大学生踊跃参加课外科技活动，开拓知识面，培养创造精神及合作意识，推动大学数学教学体系、教学内容和方法的改革。竞赛题目一般来源于科学与工程技术、'
    + '人文与社会科学（含经济管理）等领域经过适当简化加工的实际问题，不要求参赛者预先掌握深入的专门知识，只需要学过高等学校的数学课程。',
].join('\n');

function 假AI(交回) {
  const 收到 = [];
  const 问题 = [];
  return { 收到, 问题, chat: async req => { 收到.push(req); if (交回 instanceof Error) throw 交回; return { data: 交回 }; }, 报告问题: p => 问题.push(p) };
}

describe('抽取：先程序填，必要的四项填不齐才交 DeepSeek', () => {
  test('程序填齐了：不调 DeepSeek，字段都是程序填的', async () => {
    const ai = 假AI({});
    const r = await extractFields({ item: 候选(), text: 通知全 }, { ...fakeCtx(), ai });
    expect(ai.收到).toEqual([]);
    expect(r).toMatchObject({ ok: true, AI填了: [], promptVersion: null });
    expect(r.fields.organizer.value).toBe('中国工业与应用数学学会');
    expect(r.程序填了.sort()).toEqual(['format_and_rules', 'organizer', 'participants', 'registration_end', 'registration_start']);
  });
  test('填不齐：交 DeepSeek（用途 extract、要 JSON、带提示词版本），提示词里写明哪些已经填了；回来的逐字核对，程序填的优先', async () => {
    const 正文 = 通知全.replace('三、竞赛形式：三人一队，72 小时内完成一道建模题并提交论文\n', '比赛要求三人一队，72 小时内完成一道建模题并提交论文。获奖者可获得保研加分。\n');
    const ai = 假AI({
      organizer: { value: '别的学会', anchor: '中国工业与应用数学学会' },                       // 程序已经填了，不用 AI 的
      format_and_rules: { value: '三人一队，72 小时内完成建模', anchor: '72 小时内完成一道建模题' },
      reward_highlights: [{ value: '保研考研加分', anchor: '获奖者可获得保研加分' }, { value: '现金奖金', anchor: '一等奖奖金一万元' }],   // 第二条原文里没有
      missing: ['费用'],
    });
    const r = await extractFields({ item: 候选(), text: 正文 }, { ...fakeCtx(), ai });
    expect(ai.收到[0]).toMatchObject({ purpose: 'extract', json: true, promptVersion: 'extract-v5' });
    const 提示词 = ai.收到[0].messages[0].content;
    expect(提示词).toContain('不用再给：主办方、参赛对象、报名开始、报名截止');
    expect(提示词).toContain('赛事名称（仅供定位，不可作为证据）：全国大学生数学建模竞赛');
    expect(提示词).toContain('获奖者可获得保研加分');
    for (const v of ['自行报名', '学校统一报名', '保研考研加分', '求职就业', 'YYYY-MM-DD']) expect(提示词).toContain(v);
    expect(r.fields.organizer.value).toBe('中国工业与应用数学学会');
    expect(r.fields.format_and_rules).toMatchObject({ value: '三人一队，72 小时内完成建模' });
    expect(r.fields.format_and_rules.quote).toContain('72 小时内完成一道建模题');
    expect(r.fields.reward_highlights.map(x => x.value)).toEqual(['保研考研加分']);
    expect(r.dropped.map(x => x.value)).toEqual(['现金奖金']);
    expect(r).toMatchObject({ ok: true, AI填了: ['format_and_rules', 'reward_highlights'], missing: ['费用'], promptVersion: 'extract-v5' });
  });
  test('填不齐、正文里又找不到比赛名称：判成空壳页，不调 DeepSeek，交给重读', async () => {
    const ai = 假AI({});
    const r = await extractFields({ item: 候选(), text: '首页 新闻 通知公告 联系我们 '.repeat(20) }, { ...fakeCtx(), ai });
    expect(r).toMatchObject({ ok: false, status: 'page_is_boilerplate' });
    expect(ai.收到).toEqual([]);
  });
  test('DeepSeek 出错：这一条抽取失败，写明原因；交回的不是 JSON 对象：报告问题', async () => {
    const 正文 = 通知全.replace('三、竞赛形式', '三、其他');
    expect(await extractFields({ item: 候选(), text: 正文 }, { ...fakeCtx(), ai: 假AI(new Error('密钥错误')) })).toEqual({ ok: false, status: 'ai_error', reason: 'AI 出错：密钥错误' });
    const ai = 假AI(null);
    expect(await extractFields({ item: 候选(), text: 正文 }, { ...fakeCtx(), ai })).toMatchObject({ ok: false, status: 'ai_bad_response' });
    expect(ai.问题[0]).toMatchObject({ purpose: 'extract', promptVersion: 'extract-v5' });
  });
});

describe('补读：关键信息还缺时，读页面里还没读过的通知链接，最多 2 个', () => {
  const source = 余下通知 => ({ url: 'https://a.cn/', 余下通知 });
  test('读到第一个有正文的通知就用：通知在前、原页面在后，写明来源', async () => {
    const web = 假网({ 'https://a.cn/n1': 页('https://a.cn/n1', { status: '超时', error: '超时' }), 'https://a.cn/n2': 页('https://a.cn/n2', { text: '通'.repeat(150) }) });
    const r = await supplement({ item: 候选(), text: '原页面正文', missing: ['参赛对象'], source: source([{ url: 'https://a.cn/n1', text: '通知一' }, { url: 'https://a.cn/n2', text: '通知二' }, { url: 'https://a.cn/n3', text: '通知三' }]) }, { ...fakeCtx(), web });
    expect(web.读过).toEqual(['https://a.cn/n1', 'https://a.cn/n2']);
    expect(r).toEqual({ used: true, noticeUrl: 'https://a.cn/n2', reason: '', text: `来源：通知《通知二》 https://a.cn/n2\n${'通'.repeat(150)}\n\n来源：官网页面 https://a.cn/\n原页面正文` });
  });
  test('没有别的通知链接、都没读到正文：不用，写明原因', async () => {
    expect(await supplement({ item: 候选(), text: '正文', missing: [], source: source([]) }, { ...fakeCtx(), web: 假网({}) })).toEqual({ used: false, reason: '页面里没有别的通知链接' });
    const r = await supplement({ item: 候选(), text: '正文', missing: [], source: source([{ url: 'https://a.cn/n1', text: '通知' }]) }, { ...fakeCtx(), web: 假网({}) });
    expect(r).toEqual({ used: false, reason: '通知链接都没读到正文' });
  });
});
