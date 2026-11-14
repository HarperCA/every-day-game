// 程序审核：拿记录的字段对照规则。四关加发布门槛，各自只给函数；总的 审核() 按调用方说的几关依次查。
// 用例搬自旧仓库 tests/competition-scope、competition-admission、competition-admission-ai、intake-record、notice-resolution，字段改成新库的名字。
// 不连网、不调真实 AI。
import { describe, expect, test } from 'vitest';
import { 审核, 关们 } from '../../index.mjs';
import { 查标题, 是通知标题, 不是比赛的标题, 要追溯通知 } from '../../标题闸/index.mjs';
import { 查范围, 明显不是大学生 } from '../../范围闸/index.mjs';
import { 查资料 } from '../../资料齐不齐/index.mjs';
import { 查门槛, 收录门槛, 只在本校, 提示词文件 } from '../../收录门槛/index.mjs';
import { 查发布, 名称混了年份届次, 报名时间问题, 有核验过的官方来源, 报名网址顶上 } from '../../发布门槛/index.mjs';
import { loadPrompt } from '../../../../共用/工具/提示词.mjs';

const 齐全 = { name: '全国大学生电子设计竞赛', organizer: '中国电子学会', participants: '高校在校生', eligibility: '高校在校生', format_and_rules: '电子设计作品评审', professions: ['电子信息'], sources: [{ url: 'https://example.org/competition' }] };

describe('第 1 关 标题闸', () => {
  test.each([
    ['全国大学生电子设计竞赛报名通知', '通知'],
    ['2026年大学生创新大赛!', '感叹号'],
    ['2026年大学生创新大赛！', '感叹号'],
    ['2026年大学生创新大赛正式启动', '报道用语'],
    ['2026年大学生创新大赛启动仪式', '报道用语'],
  ])('“%s”不收（%s）', (name, 关键词) => {
    const r = 查标题({ name });
    expect(r.结果).toBe('不收');
    expect(r.原因).toContain(关键词);
  });
  test('届次名称含“通知”也不收；正常名称通过', () => {
    expect(查标题({ name: '全国大学生电子设计竞赛', edition_name: '2026年赛事通知' }).结果).toBe('不收');
    expect(查标题({ name: '全国大学生电子设计竞赛' })).toEqual({ 结果: '通过', 原因: '' });
  });
  test('通知标题的各种写法：关于、转发、栏目标签“竞赛通知丨”、以“的通知”结尾', () => {
    for (const t of ['关于举办第十届大赛', '转发：某某大赛', '竞赛通知丨2026全国大学生花园设计建造竞赛', '赛事通知 | 首届全国大学生零碳科技创新大赛', '某某大赛报名通知']) expect(是通知标题(t), t).toBe(true);
    expect(是通知标题('全国大学生数学建模竞赛')).toBe(false);
  });
  test('栏目、目录、决赛举行这类标题不是一场比赛；通知或这类标题要先追溯比赛本身', () => {
    for (const t of ['大赛动态', '学科竞赛目录清单', '某某大赛决赛在京举行']) expect(不是比赛的标题(t), t).toBe(true);
    expect(要追溯通知({ name: '大赛动态' })).toBe(true);
    expect(要追溯通知({ name: '全国大学生数学建模竞赛', edition_name: '关于举办2026年数学建模竞赛的通知' })).toBe(true);
    expect(要追溯通知({ name: '全国大学生数学建模竞赛' })).toBe(false);
  });
});

describe('第 2 关 范围闸', () => {
  test.each(['桂林信息科技学院 创意设计学院', '上海市文化和旅游局', '官宣!第二届娄底文化艺术季25场盛宴,速看安排→', '2026年度韶关市群众文艺作品评选启动!快来报名吧',
    '中国大学生服务外包创新创业大赛企业命题类赛题分析及应用', '“奔跑吧,少年” 2026年黑龙江省篮球锦标赛(男子甲组) 竞赛规程', '2026年教育部认可全国大学生学科竞赛目录(84项)'])('真实误收样本不收：%s', name => {
    expect(查范围({ name, organizer: '教育部', professions: ['计算机与AI'] }).结果).toBe('不收');
  });
  test.each(['全国大学生电子设计竞赛', '全国高校数字艺术设计大赛', '全国大学生数学建模竞赛'])('标题就能看出是大学生专业赛事：%s 通过', name => {
    expect(查范围({ name }).结果).toBe('通过');
  });
  test('资料不够只能待定，不能因为主办方权威就算合格', () => {
    expect(查范围({ name: '第二届新致杯创新大赛', organizer: '教育部' })).toEqual({ 结果: '待定', 原因: '缺少大学生参赛资格依据' });
  });
  test('校级选拔、标了“（初赛）”的：没挂上级比赛不收，挂了才行', () => {
    const school = { name: '第二十届“挑战杯”全国大学生课外学术科技作品竞赛某大学校级选拔赛', participants: '高校在校生', eligibility: '高校在校生', professions: ['综合/不限专业'] };
    expect(查范围(school).结果).toBe('不收');
    expect(查范围({ ...school, parent_id: 'event-challenge-cup' }).结果).toBe('通过');
    expect(查范围({ name: '第十二届湖南省大学生化工设计竞赛（初赛）', participants: '高校在校生' }).原因).toContain('阶段');
  });
  test('中小学、青少年、兴趣体育明显不是大学生；有专业赛道的保留', () => {
    expect(明显不是大学生({ name: '2026中小学智能未来邀请赛' })).toBe(true);
    expect(明显不是大学生({ name: '全国青少年信息学奥林匹克竞赛' })).toBe(true);
    expect(明显不是大学生({ name: '中国魔方运动巡回赛' })).toBe(true);
    expect(明显不是大学生({ name: '中国国际飞行器设计挑战赛暨科研类全国航空航天模型锦标赛' })).toBe(false);
    expect(明显不是大学生({ name: '某杯创新赛', participants: '全市初中生' })).toBe(true);
  });
  test.each([
    ['第九届“外教社杯”全国高校学生跨文化能力大赛（辽宁赛区）', '辽宁省高校在校大学生，中国学生组比赛。', '辽宁赛区比赛，设团队现场赛与短视频赛。', ['外语与教育']],
    ['2026年第五届辽宁省大学生商科综合能力大赛', '辽宁省高校经管类专业在校学生。', '具体赛制以附件通知为准。', ['经管与商科']],
  ])('专业分类已判定时不再用词表猜学科：%s', (name, participants, format_and_rules, professions) => {
    expect(查范围({ name, participants, eligibility: participants, format_and_rules, professions }).结果).toBe('通过');
  });
  test('看参赛对象的实际写法：非大学生的待定；“本科学生”“高等学校”这类写法认得', () => {
    expect(查范围({ name: '2026年中国飞盘精英挑战赛', participants: '面向全国飞盘爱好者，年满16周岁即可', professions: ['综合/不限专业'] }).结果).toBe('待定');
    expect(查范围({ name: '某大学生歌手挑战赛', participants: '社会各界歌唱爱好者', professions: ['设计与艺术'] }).结果).toBe('待定');
    for (const p of ['辽宁省普通高等学校在读全日制本科学生', '全省在校硕士研究生', '本省高职高专在籍学生']) {
      expect(查范围({ name: '2026年某省大学生专业技能竞赛', participants: p, format_and_rules: '实操竞赛评分', professions: ['机械与自动化'] }).结果, p).toBe('通过');
    }
  });
  test('来自榜单的以“奖”“展”“活动”结尾的算具体赛事，不是榜单来源的不算', () => {
    const 证据 = { participants: '普通高校全日制在校大学生', professions: ['设计与艺术'] };
    expect(查范围({ name: '时报金犊奖', curation_list: '2025年教育部认可的全国大学生学科竞赛目录', ...证据 }).结果).toBe('通过');
    expect(查范围({ name: '时报金犊奖', ...证据 })).toEqual({ 结果: '不收', 原因: '标题不是一场具体比赛' });
  });
});

describe('第 3 关 资料齐不齐', () => {
  test('主办方、参赛对象、资格依据、赛制、专业分类、来源网址齐了才通过', () => {
    expect(查资料(齐全).结果).toBe('通过');
    const r = 查资料({ name: 齐全.name, participants: '社会人士' });
    expect(r.结果).toBe('待定');
    expect(r.缺).toEqual(['主办方', '大学生资格依据', '专业任务与赛制', '专业分类', '来源网址']);
    expect(r.原因).toContain('不得以标题关键词代替核验');
  });
  test('参赛对象写明大学生时不再另要资格依据', () => {
    const { eligibility, ...rest } = 齐全;
    expect(查资料(rest).结果).toBe('通过');
  });
  test('新抓的允许专业分类待定（由 AI 判），发布时不行', () => {
    const { professions, ...rest } = 齐全;
    expect(查资料(rest).缺).toEqual(['专业分类']);
    expect(查资料(rest, { 允许专业待定: true }).结果).toBe('通过');
  });
});

describe('第 4 关 收录门槛（规则）', () => {
  test('冷门不是水赛：小众、人少的不拒；有真实认可度的直接收', () => {
    expect(查门槛({ organizer: '某小众专业委员会', introduction: '首届赛事，面向特定方向的在校学生。', participant_count: 23 }).结果).not.toBe('不收');
    expect(查门槛({ organizer: '某专业委员会', recognition: [{ path: '求职就业', level: '高' }] }).档).toBe('直接收');
  });
  test('水赛：人人有奖、证书收费、滚动报名不收；有权威背书时不一票否决；报名费本身不算问题', () => {
    const 水 = 查门槛({ organizer: '某教育科技有限公司', introduction: '人人有奖，保证获奖，证书可查询需缴纳工本费。', registration_method: '滚动报名，每月一期。' });
    expect(水.结果).toBe('不收');
    expect(水.红旗).toContain('宣称人人有奖');
    expect(查门槛({ introduction: '获奖率 95%，含金量极高，保研必备。' }).结果).toBe('不收');
    expect(查门槛({ organizer: '中国计算机学会', introduction: '由教育部指导，全国组委会主办。滚动报名，随时报名。' }).档).toBe('直接收');
    expect(查门槛({ organizer: '中国自动化学会', fees: '每队报名费 200 元', introduction: '全国组委会统一组织。' }).档).toBe('直接收');
  });
  test('只在本校办、又没有上级比赛的不在范围；校内选拔挂了上级的保留；层级不明不当校级', () => {
    expect(只在本校({ level: '校级' })).toBe(true);
    expect(查门槛({ level: '校级', organizer: '某大学教务处' })).toMatchObject({ 结果: '不收', 原因: expect.stringContaining('仅本校') });
    expect(查门槛({ level: '校级', parent_id: 'event-x', organizer: '某大学教务处' }).结果).not.toBe('不收');
    expect(查门槛({ organizer: '中国图象图形学学会' }).结果).not.toBe('不收');
  });
  test('没有证据的默认要人看，不猜；空记录不出错', () => {
    expect(查门槛({ organizer: '某公司', introduction: '一场面向开发者的挑战赛。' })).toMatchObject({ 结果: '通过', 档: '要人看' });
    expect(查门槛({}).档).toBe('要人看');
  });
  test('抽取出的权威信号、实质回报（直通面试）算分；现金、证书不算实质回报', () => {
    expect(查门槛({ organizer: '某公司', authority_signals: [{ signal: '支持单位', quote: '中国互联网协会人工智能工作委员会' }] }).加分项.join()).toContain('学术组织');
    expect(查门槛({ reward_highlights: ['实习或直通面试'] }).档).toBe('直接收');
    expect(查门槛({ reward_highlights: ['现金奖金', '证书荣誉'] }).档).toBe('要人看');
    expect(查门槛({ authority_signals: '乱写的' }).档).toBe('要人看');
  });
});

// 假的 AI 总管会话
function 假AI(回答们) {
  const ai = { calls: [], 报告: [], chat: async req => { ai.calls.push(req); const r = 回答们[ai.calls.length - 1]; if (r instanceof Error) throw r; return { data: r }; }, 报告问题: x => ai.报告.push(x) };
  return ai;
}
const 要人看 = { name: '某某挑战赛', organizer: '某科技公司', introduction: '由某科技公司提供算力和奖金。' };

describe('第 4 关 收录门槛（加 AI 再判，同一个文件）', () => {
  test('提示词放在 prompt.md，第一行是版本号', () => {
    expect(loadPrompt(提示词文件, { 候选资料: '{}' }).version).toMatch(/^admission-v\d+$/);
  });
  test('判成“要人看”的经 AI 总管（用途 admission）交 DeepSeek 再判；值得收录且有把握的升成直接收', async () => {
    const ai = 假AI([{ 值得收录: true, 有把握: true, 理由: '知名企业投入算力' }]);
    const r = await 收录门槛(要人看, { ai });
    expect(r).toMatchObject({ 结果: '通过', 档: '直接收', 再判: { 值得收录: true, 有把握: true, 理由: '知名企业投入算力' } });
    expect(ai.calls[0]).toMatchObject({ purpose: 'admission', json: true, promptVersion: expect.stringMatching(/^admission-v/) });
    expect(ai.calls[0].messages.map(m => m.content).join()).toContain('某科技公司');
  });
  test('没把握的仍是要人看；直接收、不收的不调 AI；没给 ai 的不再判', async () => {
    expect((await 收录门槛(要人看, { ai: 假AI([{ 值得收录: true, 有把握: false, 理由: '资料少' }]) })).档).toBe('要人看');
    const ai = 假AI([]);
    expect((await 收录门槛({ organizer: '中国计算机学会', introduction: '全国组委会主办' }, { ai })).档).toBe('直接收');
    expect((await 收录门槛({ introduction: '人人有奖，保证获奖' }, { ai })).结果).toBe('不收');
    expect(ai.calls).toHaveLength(0);
    expect((await 收录门槛(要人看)).再判).toBeNull();
  });
  test('调用出错抛给调用方；返回内容用不了先报告给 AI 总管再抛', async () => {
    await expect(收录门槛(要人看, { ai: 假AI([new Error('DeepSeek 超时')]) })).rejects.toThrow('DeepSeek 超时');
    const ai = 假AI([{ 值得收录: '是' }]);
    await expect(收录门槛(要人看, { ai })).rejects.toThrow('值得收录');
    expect(ai.报告[0]).toMatchObject({ purpose: 'admission' });
  });
});

describe('发布门槛', () => {
  const 可发布 = { ...齐全, id: 'ed-1', registration_url: 'https://reg.example.org', registration_start: '2026-11-01', registration_end: '2026-12-01',
    sources: [{ id: 's1', edition_id: 'ed-1', url: 'https://example.org/n', source_type: 'organizer_notice', is_official: true, validity_status: 'valid', last_verified_at: '2026-11-01T00:00:00Z',
      title: '通知', content_summary: '摘要', evidence_excerpt: '原文', review_reason: '核对过', supports_fields: ['registration_end'] }] };
  test('都齐了通过', () => {
    expect(查发布(可发布)).toEqual({ 结果: '通过', 原因们: [] });
  });
  test('列出所有没过的地方：通知标题、范围、名称混年份届次、报名时间、报名网址、核验过的官方来源', () => {
    const r = 查发布({ ...可发布, name: '2026年全国大学生电子设计竞赛报名通知', registration_url: '', registration_start: '2026-12-05', sources: [{ url: 'https://example.org/n' }] });
    expect(r.结果).toBe('不通过');
    expect(r.原因们.join('；')).toMatch(/通知.*年份或届次.*报名开始时间晚于报名截止时间.*报名网址.*官方来源/);
  });
  test('名称混了年份届次、报名时间的检查', () => {
    expect(名称混了年份届次('2027年第九届全国大学生电子设计竞赛')).toBe(true);
    expect(名称混了年份届次('全国大学生电子设计竞赛')).toBe(false);
    expect(报名时间问题({ registration_start: null, registration_end: null })).toEqual(['报名起止时间均缺失，请核实或说明尚未公布']);
    expect(报名时间问题({ registration_start: null, registration_end: null, pending_announcement: true })).toEqual([]);
    expect(报名时间问题({ registration_end: '2026/12/01' })).toEqual(['报名截止时间格式无效']);
  });
  // 2026-11-12 用户定放宽两条：核过一次的官方来源就算（不要求发布前 24 小时内复核）；缺报名网址时用核验过的官方通知页顶上
  test('官方来源核过一次就算，不要求发布前 24 小时内复核', () => {
    const 早就核过 = { ...可发布, sources: [{ ...可发布.sources[0], last_verified_at: '2025-03-01T00:00:00Z' }] };
    expect(查发布(早就核过)).toEqual({ 结果: '通过', 原因们: [] });
    expect(有核验过的官方来源(早就核过)).toBe(true);
  });
  test('缺报名网址：有核验过的官方来源就不拦；没有核验过的官方来源照旧拦（报名网址、官方来源两条）', () => {
    expect(查发布({ ...可发布, registration_url: '' })).toEqual({ 结果: '通过', 原因们: [] });
    expect(查发布({ ...可发布, registration_url: null })).toEqual({ 结果: '通过', 原因们: [] });
    const 没核过 = 查发布({ ...可发布, registration_url: '', sources: [{ ...可发布.sources[0], validity_status: 'unchecked' }] });
    expect(没核过.原因们).toEqual(['没有报名网址', '没有核验过的官方来源']);
  });
  test('报名网址顶上：有报名网址用它；没有就用核验过的官方来源（主办方通知优先）；都没有给空', () => {
    const 官网 = { ...可发布.sources[0], id: 's0', url: 'https://example.org/home', source_type: 'organizer_website' };
    expect(报名网址顶上(可发布)).toBe('https://reg.example.org');
    expect(报名网址顶上({ ...可发布, registration_url: '' })).toBe('https://example.org/n');
    expect(报名网址顶上({ ...可发布, registration_url: null, sources: [官网, ...可发布.sources] })).toBe('https://example.org/n');
    expect(报名网址顶上({ ...可发布, registration_url: null, sources: [官网] })).toBe('https://example.org/home');
    expect(报名网址顶上({ ...可发布, registration_url: '', sources: [{ ...可发布.sources[0], is_official: false }] })).toBe('');
  });
  test('归档只查标题、范围、名称（报不上名了，报名网址、来源不再要求）', () => {
    expect(查发布({ ...齐全, registration_url: '' }, { 归档: true }).结果).toBe('通过');
    expect(查发布({ ...齐全, name: '某某大赛报名通知' }, { 归档: true }).结果).toBe('不通过');
  });
});

describe('总的 审核()', () => {
  test('按调用方给的几关依次查，碰到不是“通过”的就停，交回停在哪一关和每关的结果', async () => {
    const r = await 审核({ name: '全国大学生电子设计竞赛报名通知' }, { 关们: ['标题闸', '范围闸'] });
    expect(r).toMatchObject({ 结果: '不收', 停在: '标题闸', 原因: expect.stringContaining('通知') });
    expect(r.每关.map(x => x.关)).toEqual(['标题闸']);
    const ok = await 审核(齐全, { 关们: ['范围闸', '资料齐不齐', '收录门槛'] });
    expect(ok).toMatchObject({ 结果: '通过', 停在: null, 档: '直接收' });
    expect(ok.每关.map(x => [x.关, x.结果])).toEqual([['范围闸', '通过'], ['资料齐不齐', '通过'], ['收录门槛', '通过']]);
  });
  test('收录门槛经 审核() 也能再判；资料齐不齐的选项传得进去', async () => {
    const ai = 假AI([{ 值得收录: true, 有把握: true, 理由: '投入算力' }]);
    const { professions, ...没专业 } = { ...齐全, organizer: '某科技公司' };
    const r = await 审核(没专业, { 关们: ['资料齐不齐', '收录门槛'], ai, 允许专业待定: true });
    expect(r).toMatchObject({ 结果: '通过', 档: '直接收' });
  });
  test('关的名字写错直接报错；关们 列出全部可用的关', async () => {
    expect(关们).toEqual(['标题闸', '范围闸', '资料齐不齐', '收录门槛', '发布门槛']);
    await expect(审核(齐全, { 关们: ['不存在'] })).rejects.toThrow('不存在');
  });
});
