// 核对原文（AI 审查）：Codex 联网查官方来源，程序读网页逐字核对，核不到的不算。假 AI、假网页、内存里的比赛库。
// 待人工审核：通过的发布或归档，不收的进回收站，查不到的留着并写明原因（2026-11-05、11-06 用户定）。
// 已发布、已归档：只改有原文依据的时间、补空字段，AI 绝不撤下、不删除（9 月 29 日 AI 撤下 24 条已发布的教训）。
import { describe, expect, test } from 'vitest';
import { openDb, 屏蔽网站 } from '../../../../../index.mjs';
import { runMaintenance } from '../../../../index.mjs';
import { run, 用途 } from '../../index.mjs';
import { 检查, 输出格式 } from '../../schema.mjs';

const now = new Date('2026-11-06T02:00:00.000Z');
const quiet = { info() {}, warn() {}, error() {}, child() { return quiet; } };
const 官网 = 'https://www.mcm.example.org/notice';
const 正文 = `全国大学生数学建模竞赛通知。主办单位：中国工业与应用数学学会。参赛对象：全国高校在读大学生。报名时间：2026年11月1日至2026年12月20日。比赛时间：2027年1月10日至2027年1月12日。报名网址 https://www.mcm.example.org/signup 。${'竞赛面向全国高校，由组委会统一组织，详细赛制见章程。'.repeat(20)}`;
const 原文们 = {
  registration_start: '报名时间：2026年11月1日至2026年12月20日',
  registration_end: '报名时间：2026年11月1日至2026年12月20日',
  organizer: '主办单位：中国工业与应用数学学会',
};

function 库({ 届 = {}, 比赛 = {} } = {}) {
  const db = openDb({ file: ':memory:', now: () => now });
  db.transaction(tx => {
    tx.insert('competition', 'event-mcm', { name: '全国大学生数学建模竞赛', level: '国家级', organizer: '中国工业与应用数学学会', professions: ['数学与统计'], ...比赛 });
    tx.insert('edition', 'edition-mcm-2026', { competition_id: 'event-mcm', ordinal: 1, edition_name: '2026 全国大学生数学建模竞赛', edition_year: '2026',
      status: '待人工审核', status_reason: ['名录导入，待审核'], participants: '全国高校在读大学生', registration_url: 'https://www.mcm.example.org/signup', ...届 });
  });
  return db;
}

const 通过 = (改 = {}) => ({
  结论: '通过', 理由: '官网通知写明了时间', 来源性质: '官方', 名称: { 对不对: true, 改正: '' },
  字段们: [
    { 字段: 'registration_start', 值: '2026-11-01', 网址: 官网, 原文: 原文们.registration_start },
    { 字段: 'registration_end', 值: '2026-12-20', 网址: 官网, 原文: 原文们.registration_end },
  ],
  待公布: [], ...改,
});

function 工具(答案, 页 = 正文, 特殊网页 = {}) {
  const 调用们 = [];
  return {
    调用们,
    // 答案给列表时一轮用一个，用完重复最后一个
    ai: { chat: async 请求 => { 调用们.push(请求); const 这轮 = Array.isArray(答案) ? 答案[Math.min(调用们.length, 答案.length) - 1] : 答案; if (这轮 instanceof Error) throw 这轮; return { data: 这轮 }; }, 报告问题() {} },
    web: { 读网页: async 网址 => 特殊网页[网址] ?? (页 == null ? { url: 网址, status: '读取失败', text: '' } : { url: 网址, finalUrl: 网址, status: '成功', title: '竞赛通知', text: 页, links: [{ kind: '报名', text: '报名', url: 'https://www.mcm.example.org/signup' }] }) },
  };
}

const 跑 = async (db, t, 选项 = {}) => runMaintenance({ db, log: quiet, now: () => now, ai: t.ai, web: t.web, 比赛编号: 'event-mcm',
  checks: [{ name: '核对原文', timeoutMs: 60000, run }], ...选项 });
const 届次 = db => db.get('edition', 'edition-mcm-2026')?.data;
const 来源们 = db => db.find('source', { edition_id: 'edition-mcm-2026' });
// 进了回收站：查得到删除时间、删除人，理由写在 status_reason 最后一条，也有“维护放回收站”的记录
const 回收的 = (db, id = 'edition-mcm-2026') => db.get('edition', id, { 包括已删除: true }).data;
const 进了回收站 = (db, 理由片段, id = 'edition-mcm-2026') => {
  expect(db.get('edition', id)).toBeFalsy();
  expect(回收的(db, id).deleted_at).toBeTruthy();
  expect(回收的(db, id).status_reason.at(-1)).toContain(理由片段);
  expect(db.find('audit_log', { action: '维护放回收站' }).some(r => r.record_id === id && String(r.detail.依据).includes(理由片段))).toBe(true);
};

describe('输出格式', () => {
  test('JSON Schema 严格：每层都不许多字段、都写全必填（Codex --output-schema 的要求）', () => {
    const 查 = 节点 => {
      if (节点.type === 'object') {
        expect(节点.additionalProperties).toBe(false);
        expect([...节点.required].sort()).toEqual(Object.keys(节点.properties).sort());
        Object.values(节点.properties).forEach(查);
      }
      if (节点.type === 'array') 查(节点.items);
      (节点.anyOf || []).forEach(查);
    };
    查(输出格式);
    expect(输出格式.properties.结论.enum).toEqual(['通过', '继续', '不收', '查不到']);
  });
  test('按格式交回的答案（不收留空）过得了检查', () => {
    expect(检查(通过({ 不收: { 类别: '', 网址: '', 原文: '' } }))).toBeNull();
  });
});

describe('待人工审核', () => {
  test('用途是 audit；核对通过、报名没截止：补上时间、加官方来源、发布，理由清掉', async () => {
    const db = 库(); const t = 工具(通过());
    const 回 = await 跑(db, t);
    expect(t.调用们[0].purpose).toBe(用途);
    expect(t.调用们[0].schema).toEqual(输出格式);
    expect(用途).toBe('audit');
    expect(回.检查.失败).toEqual([]);
    expect(届次(db)).toMatchObject({ status: '已发布', status_reason: [], registration_start: '2026-11-01', registration_end: '2026-12-20', status_at: now.toISOString() });
    expect(届次(db).last_verified_at).toBe(now.toISOString());
    expect(来源们(db)).toHaveLength(1);
    expect(来源们(db)[0]).toMatchObject({ url: 官网, is_official: true, validity_status: 'valid', evidence_excerpt: 原文们.registration_end });
    expect(来源们(db)[0].supports_fields).toEqual(expect.arrayContaining(['registration_start', 'registration_end']));
    db.close();
  });
  test('报名已截止：归档', async () => {
    const db = 库(); const 页 = 正文.replaceAll('2026年12月20日', '2026年10月20日').replaceAll('2026年11月1日', '2026年9月1日');
    const t = 工具(通过({ 字段们: [{ 字段: 'registration_start', 值: '2026-09-01', 网址: 官网, 原文: '报名时间：2026年9月1日至2026年10月20日' }, { 字段: 'registration_end', 值: '2026-10-20', 网址: 官网, 原文: '报名时间：2026年9月1日至2026年10月20日' }] }), 页);
    await 跑(db, t);
    expect(届次(db).status).toBe('已归档');
    db.close();
  });
  test('年份早于今年、没写报名截止：官方来源核到了就归档，不写日期（2026-11-06 试审发现：名录里早年的届次否则永远卡住）', async () => {
    const db = 库({ 届: { edition_year: '2018', edition_name: '2018 全国大学生数学建模竞赛', registration_url: null } });
    const t = 工具(通过({ 字段们: [{ 字段: 'organizer', 值: '中国工业与应用数学学会', 网址: 官网, 原文: 原文们.organizer }] }));
    await 跑(db, t);
    expect(届次(db).status).toBe('已归档');
    expect(届次(db).registration_end ?? null).toBeNull();
    expect(来源们(db)).toHaveLength(1);
    db.close();
  });
  test('今年的届次没写报名截止：不算结束，过不了发布门槛就进回收站', async () => {
    const db = 库({ 届: { edition_year: '2026', registration_url: null } });
    const t = 工具(通过({ 字段们: [{ 字段: 'organizer', 值: '中国工业与应用数学学会', 网址: 官网, 原文: 原文们.organizer }] }));
    await 跑(db, t);
    进了回收站(db, 'AI 审查没法发布');
    db.close();
  });
  test('跨年的届次（2025—2026）按后面那年算；今年 2026，不算早于今年', async () => {
    const db = 库({ 届: { edition_year: '2025—2026', registration_url: null } });
    const t = 工具(通过({ 字段们: [{ 字段: 'organizer', 值: '中国工业与应用数学学会', 网址: 官网, 原文: 原文们.organizer }] }));
    await 跑(db, t);
    进了回收站(db, 'AI 审查没法发布');
    db.close();
  });
  test('Codex 给的原文不在网页里：不算数、不发布，进回收站并写明', async () => {
    const db = 库();
    const t = 工具(通过({ 字段们: [{ 字段: 'registration_end', 值: '2026-12-25', 网址: 官网, 原文: '报名截止：2026年12月25日' }] }));
    await 跑(db, t);
    进了回收站(db, '报名截止');
    db.close();
  });
  test.each([
    ['超时', { status: '超时', text: '', error: '超时' }],
    ['网络错误', { status: '网络错误', text: '', error: '连不上' }],
    ['403', { status: 'HTTP错误', httpStatus: 403, text: '', error: '403' }],
    ['500', { status: 'HTTP错误', httpStatus: 500, text: '', error: '500' }],
  ])('网页%s（技术故障）：这个比赛算失败、什么都不写，下次再试，不能当成删除的理由', async (_, 结果) => {
    const db = 库(); const t = 工具(通过(), 正文, { [官网]: { url: 官网, links: [], ...结果 } });
    const 回 = await 跑(db, t);
    expect(回.检查.失败[0]).toMatchObject({ name: '核对原文', kind: '网页读不到' });
    expect(届次(db).status).toBe('待人工审核');
    expect(来源们(db)).toEqual([]);
    db.close();
  });
  test('页面 404：AI 给的页面不存在，不算技术故障，进回收站', async () => {
    const db = 库(); const t = 工具(通过(), 正文, { [官网]: { url: 官网, status: 'HTTP错误', httpStatus: 404, text: '', links: [], error: '404' } });
    await 跑(db, t);
    进了回收站(db, 'AI 审查没法发布');
    db.close();
  });
  test('来源不是官方的：进回收站', async () => {
    const db = 库(); const t = 工具(通过({ 来源性质: '判断不了' }));
    await 跑(db, t);
    进了回收站(db, '来源不是官方的');
    db.close();
  });
  test('过不了发布门槛（没有报名网址）：进回收站，理由写门槛原因，其他改动不写', async () => {
    const db = 库({ 届: { registration_url: null } }); const t = 工具(通过());
    await 跑(db, t);
    进了回收站(db, '没有报名网址');
    expect(回收的(db).registration_end ?? null).toBeNull();
    expect(来源们(db)).toEqual([]);
    db.close();
  });
  test('判定不收、原文核得到：放进回收站（可恢复），留后台记录', async () => {
    const db = 库();
    const t = 工具({ 结论: '不收', 理由: '只面向中小学', 来源性质: '官方', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [], 不收: { 类别: '不含大学生', 网址: 官网, 原文: '竞赛面向全国高校' } });
    await 跑(db, t);
    expect(届次(db)).toBeUndefined();
    expect(db.get('edition', 'edition-mcm-2026', { 包括已删除: true }).data.deleted_at).toBeTruthy();
    expect(db.find('audit_log', { action: '维护放回收站' })).toHaveLength(1);
    db.close();
  });
  test('判定不收、原文核不到：一样进回收站（用户定 AI 有权删，要写理由），理由里写明没核到', async () => {
    const db = 库();
    const t = 工具({ 结论: '不收', 理由: '像水赛', 来源性质: '官方', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [], 不收: { 类别: '水赛', 网址: 官网, 原文: '人人有奖' } });
    await 跑(db, t);
    进了回收站(db, '水赛：像水赛');
    expect(回收的(db).status_reason.at(-1)).toContain('没核到');
    db.close();
  });
  test('没写理由不许删：算内容用不了，只记下', async () => {
    const db = 库();
    const 回 = await 跑(db, 工具({ 结论: '不收', 理由: '  ', 来源性质: '官方', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [], 不收: { 类别: '水赛', 网址: 官网, 原文: '竞赛面向全国高校' } }));
    expect(届次(db).status).toBe('待人工审核');
    expect(回.留着.some(p => String(p.说明).includes('用不了'))).toBe(true);
    db.close();
  });
  test('状态是人工定的：不删，留给人决定', async () => {
    const db = 库({ 届: { manual_fields: ['status'] } });
    await 跑(db, 工具({ 结论: '查不到', 理由: '官网打不开', 来源性质: '判断不了', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [] }));
    expect(届次(db).status).toBe('待人工审核');
    expect(届次(db).status_reason.join()).toContain('人工定');
    db.close();
  });
  test('校内赛是例外，不进回收站（用户要留存，回收站 30 天后会彻底删）：留在待人工审核', async () => {
    const db = 库();
    const t = 工具({ 结论: '不收', 理由: '只在本校', 来源性质: '官方', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [], 不收: { 类别: '校内赛', 网址: 官网, 原文: '竞赛面向全国高校' } });
    await 跑(db, t);
    expect(届次(db).status).toBe('待人工审核');
    expect(届次(db).status_reason.join()).toContain('校内赛');
    db.close();
  });
  test('查不到：进回收站，理由写清楚，原有理由保留', async () => {
    const db = 库();
    await 跑(db, 工具({ 结论: '查不到', 理由: '只有 2024 届的通知', 来源性质: '判断不了', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [] }));
    进了回收站(db, '只有 2024 届的通知');
    expect(回收的(db).status_reason[0]).toBe('名录导入，待审核');
    db.close();
  });
  test('名称和官方不符（比如冠名）：照常发布，名称不自动改，官方写法记进后台记录', async () => {
    const db = 库(); const t = 工具(通过({ 名称: { 对不对: false, 改正: '“上纬杯”全国大学生数学建模竞赛' } }));
    const 回 = await 跑(db, t);
    expect(届次(db).status).toBe('已发布');
    expect(db.get('competition', 'event-mcm').data.name).toBe('全国大学生数学建模竞赛');
    expect(回.留着.some(p => String(p.说明).includes('上纬杯'))).toBe(true);
    db.close();
  });
  test('人工改成待人工审核的（status 在 manual_fields）：AI 不擅自发布', async () => {
    const db = 库({ 届: { manual_fields: ['status'] } }); const t = 工具(通过());
    await 跑(db, t);
    expect(届次(db).status).toBe('待人工审核');
    db.close();
  });
});

describe('搜索轮次（2026-11-06 用户定：最多 3 轮，每轮写摘要交给下一轮，下一轮不带上一轮的全部内容）', () => {
  const 摘要 = 轮 => ({ 进度: `第${轮}轮搜了官网首页`, 下一轮从哪里开始: `第${轮}轮之后去看通知公告栏目` });
  const 继续 = (轮, 改 = {}) => ({ 结论: '继续', 理由: '还没找到报名时间', 来源性质: '判断不了', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [], 搜索摘要: 摘要(轮), ...改 });
  const 查不到 = { 结论: '查不到', 理由: '官网打不开', 来源性质: '判断不了', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [] };
  const 用户话 = (t, 第几次) => t.调用们[第几次].messages.at(-1).content;

  test('第一轮就通过或查不到：只调一次', async () => {
    const db = 库(); const t = 工具(通过());
    await 跑(db, t);
    expect(t.调用们).toHaveLength(1);
    const db2 = 库(); const t2 = 工具(查不到);
    await 跑(db2, t2);
    expect(t2.调用们).toHaveLength(1);
    db.close(); db2.close();
  });
  test('每轮是单独一次调用；下一轮收到上一轮的摘要和轮次，第一轮没有摘要', async () => {
    const db = 库(); const t = 工具([继续(1), 继续(2), 通过()]);
    await 跑(db, t);
    expect(t.调用们).toHaveLength(3);
    expect(用户话(t, 0)).toContain('第 1 轮');
    expect(用户话(t, 0)).not.toContain('上一轮摘要');
    expect(用户话(t, 1)).toContain('第 2 轮');
    expect(用户话(t, 1)).toContain('第1轮搜了官网首页');
    expect(用户话(t, 1)).toContain('第1轮之后去看通知公告栏目');
    expect(用户话(t, 2)).toContain('第2轮之后去看通知公告栏目');
    expect(用户话(t, 2)).not.toContain('第1轮之后去看通知公告栏目');
    expect(用户话(t, 2)).toContain('最后一轮');
    expect(届次(db).status).toBe('已发布');
    db.close();
  });
  test('摘要太长只传前面一段，不把上一轮的内容整段带过去', async () => {
    const db = 库(); const t = 工具([继续(1, { 搜索摘要: { 进度: '长'.repeat(5000), 下一轮从哪里开始: '看通知' } }), 查不到]);
    await 跑(db, t);
    expect(用户话(t, 1).length).toBeLessThan(2000);
    db.close();
  });
  test('提示词写明每轮只搜 1 次、结束时写摘要', async () => {
    const db = 库(); const t = 工具(通过());
    await 跑(db, t);
    const 提示 = t.调用们[0].messages[0].content;
    expect(提示).toContain('只做 1 次关键词搜索');
    expect(提示).toContain('下一轮从哪里开始');
    db.close();
  });
  test('3 轮都没结论、也没核到东西：不再调，留在待人工审核，理由写最后的进度', async () => {
    const db = 库(); const t = 工具([继续(1), 继续(2), 继续(3)]);
    const 回 = await 跑(db, t);
    expect(t.调用们).toHaveLength(3);
    expect(回.检查.失败).toEqual([]);
    进了回收站(db, '搜了 3 轮');
    expect(回收的(db).status_reason.at(-1)).toContain('第3轮搜了官网首页');
    db.close();
  });
  test('几轮核到的字段合起来算，后面的覆盖前面同一字段', async () => {
    const db = 库();
    const 第一轮 = 继续(1, { 来源性质: '官方', 字段们: [{ 字段: 'registration_start', 值: '2026-11-01', 网址: 官网, 原文: 原文们.registration_start }, { 字段: 'registration_end', 值: '2026-12-25', 网址: 官网, 原文: '不在网页里的话' }] });
    const t = 工具([第一轮, 通过({ 字段们: [{ 字段: 'registration_end', 值: '2026-12-20', 网址: 官网, 原文: 原文们.registration_end }] })]);
    await 跑(db, t);
    expect(届次(db)).toMatchObject({ status: '已发布', registration_start: '2026-11-01', registration_end: '2026-12-20' });
    db.close();
  });
  test('不是官方来源那一轮的字段不算', async () => {
    const db = 库();
    const t = 工具([继续(1, { 字段们: [{ 字段: 'registration_end', 值: '2026-12-20', 网址: 官网, 原文: 原文们.registration_end }] }), 查不到]);
    await 跑(db, t);
    进了回收站(db, '官网打不开');
    expect(回收的(db).registration_end ?? null).toBeNull();
    db.close();
  });
  test('前面核到了官方字段、最后没说通过：不发布不归档，进回收站，理由写明', async () => {
    const db = 库();
    const 核到 = { 来源性质: '官方', 字段们: 通过().字段们 };
    const t = 工具([继续(1, 核到), 继续(2), 继续(3)]);
    await 跑(db, t);
    进了回收站(db, '没下结论');
    db.close();
  });
  test('已发布的：核到的字段照改，状态不动', async () => {
    const db = 库({ 届: { status: '已发布', status_reason: [], registration_start: '2026-11-01', registration_end: '2026-12-01' } });
    const t = 工具([继续(1, { 来源性质: '官方', 字段们: 通过().字段们 }), 查不到]);
    await 跑(db, t);
    expect(届次(db)).toMatchObject({ status: '已发布', registration_end: '2026-12-20' });
    db.close();
  });
  test('写继续却没写下一轮从哪里开始：算格式不对，只记下', async () => {
    const db = 库(); const t = 工具([继续(1, { 搜索摘要: { 进度: '搜了', 下一轮从哪里开始: ' ' } })]);
    const 回 = await 跑(db, t);
    expect(t.调用们).toHaveLength(1);
    expect(回.留着.some(p => String(p.说明).includes('用不了'))).toBe(true);
    db.close();
  });
  test('某轮搜索超限：这一轮作废但占轮次，下一轮接着做；3 轮都超限留着，不算失败', async () => {
    const 超限 = () => Object.assign(new Error('搜索超过上限'), { kind: '搜索超限' });
    const db = 库(); const t = 工具([超限(), 通过()]);
    await 跑(db, t);
    expect(t.调用们).toHaveLength(2);
    expect(用户话(t, 1)).toContain('超过了搜索次数');
    expect(届次(db).status).toBe('已发布');
    const db2 = 库(); const t2 = 工具([超限(), 超限(), 超限()]);
    const 回 = await 跑(db2, t2);
    expect(t2.调用们).toHaveLength(3);
    expect(回.检查.失败).toEqual([]);
    进了回收站(db2, '搜了 3 轮');
    db.close(); db2.close();
  });
  test('中途额度用完：这一项算失败，前面核到的不写', async () => {
    const db = 库(); const 错 = Object.assign(new Error('额度不足'), { kind: '额度用完' });
    const 回 = await 跑(db, 工具([继续(1, { 来源性质: '官方', 字段们: 通过().字段们 }), 错]));
    expect(回.检查.失败[0]).toMatchObject({ kind: '额度用完' });
    expect(届次(db).registration_end ?? null).toBeNull();
    db.close();
  });
});

describe('发布前查重（2026-11-07 用户定，照旧系统；判重的进回收站。线上华为 ICT 两届的年份写法不同，所以按年份重叠算）', () => {
  const 再加一届 = (db, 改 = {}) => db.insert('edition', 'edition-mcm-old', { competition_id: 'event-mcm', ordinal: 2, edition_name: '第二条', edition_year: '2026', status: '已发布', ...改 });
  test('同比赛、同年、已有公开届：不发布，留待审，理由写明和哪一届重复', async () => {
    const db = 库(); 再加一届(db);
    await 跑(db, 工具(通过()));
    进了回收站(db, '重复');
    expect(回收的(db).status_reason.at(-1)).toContain('edition-mcm-old');
    db.close();
  });
  test('年份写法不同但有重叠（2026 和 2026—2027）、届次相同：算重复', async () => {
    const db = 库({ 届: { edition_ordinal: '第十一届' } }); 再加一届(db, { edition_year: '2026—2027', edition_ordinal: '第十一届' });
    await 跑(db, 工具(通过()));
    进了回收站(db, '重复');
    db.close();
  });
  test('已归档的同一届也算；不同名的比赛下同名的也算', async () => {
    const db = 库(); 再加一届(db, { status: '已归档' });
    await 跑(db, 工具(通过()));
    进了回收站(db, '重复');
    const db2 = 库();
    db2.insert('competition', 'event-mcm2', { name: '全国大学生数学建模竞赛', level: '国家级' });
    db2.insert('edition', 'edition-other', { competition_id: 'event-mcm2', ordinal: 1, edition_name: '另一条', edition_year: '2026', status: '已发布' });
    await 跑(db2, 工具(通过()));
    进了回收站(db2, '重复');
    db.close(); db2.close();
  });
  test.each([
    ['别的年份', { edition_year: '2025' }],
    ['还在待审的', { status: '待人工审核' }],
  ])('%s：不算重复，照常发布', async (_, 改) => {
    const db = 库(); 再加一届(db, 改);
    await 跑(db, 工具(通过()));
    expect(届次(db).status).toBe('已发布');
    db.close();
  });
  test('同一年但届次明确不同，或赛道明确不同：不算重复', async () => {
    const db = 库({ 届: { edition_ordinal: '第十届' } }); 再加一届(db, { edition_ordinal: '第十一届' });
    await 跑(db, 工具(通过()));
    expect(届次(db).status).toBe('已发布');
    const db2 = 库({ 届: { track_name: '本科组' } }); 再加一届(db2, { track_name: '研究生组' });
    await 跑(db2, 工具(通过()));
    expect(届次(db2).status).toBe('已发布');
    db.close(); db2.close();
  });
  test('归档时同样查重；已发布的不受影响（AI 不撤下）', async () => {
    const db = 库({ 届: { edition_year: '2018', edition_name: '2018 甲', registration_url: null } }); 再加一届(db, { edition_year: '2018', status: '已归档' });
    await 跑(db, 工具(通过({ 字段们: [{ 字段: 'organizer', 值: '中国工业与应用数学学会', 网址: 官网, 原文: 原文们.organizer }] })));
    进了回收站(db, '重复');
    const db2 = 库({ 届: { status: '已发布', status_reason: [], registration_start: '2026-11-01', registration_end: '2026-12-20' } }); 再加一届(db2);
    await 跑(db2, 工具(通过()));
    expect(届次(db2).status).toBe('已发布');
    db.close(); db2.close();
  });
  test('提示词：没写报名截止但写了收稿、作品提交截止的，当报名截止', async () => {
    const db = 库(); const t = 工具(通过());
    await 跑(db, t);
    for (const 词 of ['收稿截止', '作品提交截止', '作品报送截止', '当作报名截止']) expect(t.调用们[0].messages[0].content).toContain(词);
    db.close();
  });
});

describe('日期核得到、钟点对不上：只留日期（2026-11-07 试跑发现：CCF 算法能力大赛因 AI 多写钟点差点进回收站）', () => {
  test('AI 写了原文没有的钟点：照样发布，只写日期', async () => {
    const db = 库();
    await 跑(db, 工具(通过({ 字段们: [
      { 字段: 'registration_start', 值: '2026-11-01', 网址: 官网, 原文: 原文们.registration_start },
      { 字段: 'registration_end', 值: '2026-12-20T17:00:00+08:00', 网址: 官网, 原文: 原文们.registration_end },
    ] })));
    expect(届次(db)).toMatchObject({ status: '已发布', registration_end: '2026-12-20' });
    db.close();
  });
  test('日期本身就不对：还是核不到', async () => {
    const db = 库();
    await 跑(db, 工具(通过({ 字段们: [{ 字段: 'registration_end', 值: '2026-12-25T17:00:00+08:00', 网址: 官网, 原文: 原文们.registration_end }] })));
    进了回收站(db, '报名截止');
    db.close();
  });
});

describe('官网证书过期的比赛进回收站（2026-11-07 用户定）', () => {
  const 证书坏 = { [官网]: { url: 官网, status: '网络错误', text: '', links: [], error: 'fetch failed（CERT_HAS_EXPIRED）' } };
  test.each([['待人工审核', {}], ['已发布', { status: '已发布', status_reason: [] }], ['已归档', { status: '已归档', status_reason: [] }]])('%s：进回收站，理由写明证书过期，不算技术故障', async (_, 届) => {
    const db = 库({ 届 });
    const 回 = await 跑(db, 工具(通过(), 正文, 证书坏));
    expect(回.检查.失败).toEqual([]);
    进了回收站(db, '证书过期');
    db.close();
  });
  test('北京线路报的“certificate has expired”也算', async () => {
    const db = 库();
    await 跑(db, 工具(通过(), 正文, { [官网]: { url: 官网, status: '网络错误', text: '', links: [], error: 'fetch failed；北京也读不到：certificate has expired' } }));
    进了回收站(db, '证书过期');
    db.close();
  });
  test('状态是人工定的已发布：不删，只记下', async () => {
    const db = 库({ 届: { status: '已发布', status_reason: [], manual_fields: ['status'] } });
    await 跑(db, 工具(通过(), 正文, 证书坏));
    expect(届次(db).status).toBe('已发布');
    db.close();
  });
  test('别的连接错误还是技术故障，下次再试', async () => {
    const db = 库();
    const 回 = await 跑(db, 工具(通过(), 正文, { [官网]: { url: 官网, status: '网络错误', text: '', links: [], error: 'fetch failed（ECONNRESET）' } }));
    expect(回.检查.失败[0]).toMatchObject({ kind: '网页读不到' });
    db.close();
  });
});

describe('按名称找新网页（2026-11-07 用户定：根据名称找新的网页，不是官网就不要再纠缠）', () => {
  const 用户话 = t => t.调用们[0].messages.at(-1).content;
  test('不把库里的网址交给 Codex：只给名称、届次、年份等，让它按名称搜', async () => {
    const db = 库({ 比赛: { website: 'https://old-site.example.org/' }, 届: { registration_url: 'https://old-entry.example.org/' } });
    db.insert('source', 'source-old', { edition_id: 'edition-mcm-2026', url: 'https://old-source.example.org/a', source_type: 'search_candidate', is_official: false, validity_status: 'unchecked' });
    const t = 工具({ 结论: '查不到', 理由: '无', 来源性质: '判断不了', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [] });
    await 跑(db, t);
    expect(用户话(t)).toContain('全国大学生数学建模竞赛');
    expect(用户话(t)).toContain('2026');
    expect(用户话(t)).not.toContain('old-site.example.org');
    expect(用户话(t)).not.toContain('old-entry.example.org');
    expect(用户话(t)).not.toContain('old-source.example.org');
    db.close();
  });
  test('提示词写明：按名称搜新网页；不是官网的直接放弃，不追附件、不查人、不重试；下一轮换关键词', async () => {
    const db = 库(); const t = 工具(通过());
    await 跑(db, t);
    const 提示 = t.调用们[0].messages[0].content;
    for (const 句 of ['按比赛名称', '不是官方的页面直接放弃', '不要查文中提到的人', '打不开的网页不要重试', '新的搜索关键词']) expect(提示).toContain(句);
    db.close();
  });
  test('库里的官方来源核对通过时照样更新，不重复加（程序按网址对比，不靠 Codex 拿到旧网址）', async () => {
    const db = 库();
    db.insert('source', 'source-old', { edition_id: 'edition-mcm-2026', url: 官网, source_type: 'search_candidate', is_official: false, validity_status: 'unchecked' });
    await 跑(db, 工具(通过()));
    expect(来源们(db)).toHaveLength(1);
    expect(来源们(db)[0]).toMatchObject({ id: 'source-old', validity_status: 'valid' });
    db.close();
  });
});

describe('报名入口替换（2026-11-06 用户定：待审的按核对过的官方原文换；已发布、已归档的只在旧链接打不开时换）', () => {
  const 旧 = 'https://old.example.org/entry';
  const 新 = 'https://www.mcm.example.org/signup';
  const 新链接 = (值 = 新) => ({ 字段: 'registration_url', 值, 网址: 官网, 原文: `报名网址 ${值}` });
  const 带链接 = (值 = 新) => 通过({ 字段们: [...通过().字段们, 新链接(值)] });
  const 已发布 = { status: '已发布', status_reason: [], registration_start: '2026-11-01', registration_end: '2026-12-20', registration_url: 旧 };
  const 打不开 = httpStatus => ({ [旧]: { url: 旧, status: 'HTTP错误', httpStatus, text: '' } });

  test('待审：官方原文写的和库里不同，换成官方的并发布，改动留记录（旧值可查）', async () => {
    const db = 库({ 届: { registration_url: 旧 } });
    await 跑(db, 工具(带链接()));
    expect(届次(db)).toMatchObject({ status: '已发布', registration_url: 新 });
    const 记录 = db.find('audit_log', { action: '维护改正' }).find(r => r.detail.字段 === 'registration_url');
    expect(JSON.stringify(记录.detail)).toContain(旧);
    db.close();
  });
  test.each([
    ['结尾多个斜杠', `${新}/`],
    ['http 和 https', 新.replace('https:', 'http:')],
  ])('只差%s算同一个，不改', async (_, 库里的) => {
    const db = 库({ 届: { registration_url: 库里的 } });
    await 跑(db, 工具(带链接()));
    expect(届次(db).registration_url).toBe(库里的);
    db.close();
  });
  test('新链接没在读过的网页里：不换', async () => {
    const db = 库({ 届: { registration_url: 旧 } });
    await 跑(db, 工具(带链接('https://www.mcm.example.org/other')));
    expect(届次(db).registration_url).toBe(旧);
    expect(届次(db).status).toBe('已发布');
    db.close();
  });
  test('新链接在屏蔽名单：不换，空的也不填，理由写明', async () => {
    const 聚合 = 'https://x.52jingsai.com/signup';
    const 页 = `${正文} 报名网址 ${聚合} 。`;
    const db = 库({ 届: { registration_url: 旧 } });
    await 跑(db, 工具(带链接(聚合), 页));
    expect(届次(db).registration_url).toBe(旧);
    const db2 = 库({ 届: { registration_url: null } });
    await 跑(db2, 工具(带链接(聚合), 页));
    进了回收站(db2, '屏蔽');
    expect(回收的(db2).registration_url ?? null).toBeNull();
    db.close(); db2.close();
  });
  test('人工改过的链接：不换，也不因此挡住发布', async () => {
    const db = 库({ 届: { registration_url: 旧, manual_fields: ['registration_url'] } });
    await 跑(db, 工具(带链接()));
    expect(届次(db)).toMatchObject({ status: '已发布', registration_url: 旧 });
    db.close();
  });
  test.each([['已发布'], ['已归档']])('%s、旧链接 404：换成官方的，状态不变', async 状态 => {
    const db = 库({ 届: { ...已发布, status: 状态 } });
    await 跑(db, 工具(带链接(), 正文, 打不开(404)));
    expect(届次(db)).toMatchObject({ status: 状态, registration_url: 新 });
    db.close();
  });
  test('已发布、旧链接能打开：不换，把官方写的网址记下给人看', async () => {
    const db = 库({ 届: 已发布 });
    const 回 = await 跑(db, 工具(带链接()));
    expect(届次(db).registration_url).toBe(旧);
    expect(回.留着.some(p => String(p.说明).includes(新))).toBe(true);
    db.close();
  });
  test.each([
    ['403（常见的拦爬虫）', { url: 旧, status: 'HTTP错误', httpStatus: 403, text: '' }],
    ['超时（美国服务器读国内网站常见）', { url: 旧, status: '超时', text: '' }],
    ['网络错误', { url: 旧, status: '网络错误', text: '' }],
  ])('已发布、旧链接%s：不算打不开，不换，只记下', async (_, 结果) => {
    const db = 库({ 届: 已发布 });
    const 回 = await 跑(db, 工具(带链接(), 正文, { [旧]: 结果 }));
    expect(届次(db).registration_url).toBe(旧);
    expect(回.留着.some(p => String(p.说明).includes(新))).toBe(true);
    db.close();
  });
  test('已发布、旧链接是屏蔽名单里的聚合站：换成官方的', async () => {
    const 聚合 = 'https://x.52jingsai.com/entry';
    const db = 库({ 届: { ...已发布, registration_url: 聚合 } });
    await 跑(db, 工具(带链接()));
    expect(届次(db)).toMatchObject({ status: '已发布', registration_url: 新 });
    db.close();
  });
  test('提示词要求写官方页面上的报名网址，和记录不一样也写', async () => {
    const db = 库(); const t = 工具(通过());
    await 跑(db, t);
    expect(t.调用们[0].messages[0].content).toContain('和记录不一样也要写');
    db.close();
  });
});

describe('屏蔽名单里的网站不能当依据（2026-11-06 真实运行：AI 把 52jingsai 的子站当官方，发布了创研杯）', () => {
  const 聚合 = 'https://cycupzt.52jingsai.com/notice';
  const 走聚合 = () => 通过({ 字段们: [
    { 字段: 'registration_start', 值: '2026-11-01', 网址: 聚合, 原文: 原文们.registration_start },
    { 字段: 'registration_end', 值: '2026-12-20', 网址: 聚合, 原文: 原文们.registration_end },
  ] });
  test('依据全在聚合站子站：不发布、不加来源、不写时间，进回收站，理由写明', async () => {
    const db = 库(); const t = 工具(走聚合());
    await 跑(db, t);
    进了回收站(db, '屏蔽');
    expect(回收的(db).registration_end ?? null).toBeNull();
    expect(来源们(db)).toEqual([]);
    db.close();
  });
  test('已发布的：聚合站的日期也不采用', async () => {
    const db = 库({ 届: { status: '已发布', status_reason: [], registration_end: '2026-12-01' } });
    await 跑(db, 工具(走聚合()));
    expect(届次(db)).toMatchObject({ status: '已发布', registration_end: '2026-12-01' });
    expect(来源们(db)).toEqual([]);
    db.close();
  });
  test('判定不收、依据在聚合站：也进回收站，理由写明依据不算数', async () => {
    const db = 库();
    await 跑(db, 工具({ 结论: '不收', 理由: '水赛', 来源性质: '官方', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [], 不收: { 类别: '水赛', 网址: 聚合, 原文: '竞赛面向全国高校' } }));
    进了回收站(db, '水赛：水赛');
    expect(回收的(db).status_reason.at(-1)).toContain('屏蔽');
    db.close();
  });
  test('库里已有的聚合站来源就算标着官方，也不计入发布门槛', async () => {
    const db = 库();
    db.insert('source', 'source-agg', { edition_id: 'edition-mcm-2026', url: 聚合, source_type: 'organizer_notice', is_official: true, validity_status: 'valid', title: '通知', content_summary: '摘要', evidence_excerpt: '摘录', review_reason: '旧', supports_fields: ['name'], last_verified_at: now.toISOString() });
    // Codex 的依据只有已有聚合站这条，门槛必须按“没有核验过的官方来源”拦下
    await 跑(db, 工具(走聚合()));
    进了回收站(db, '没有核验过的官方来源');
    db.close();
  });
  test('后台确认屏蔽的网站同样不算', async () => {
    const db = 库();
    屏蔽网站.决定(db, { host: 'mcm.example.org', decision: 'block', note: '测试' }, { now: () => now });
    await 跑(db, 工具(通过()));
    进了回收站(db, '屏蔽');
    db.close();
  });
  test('官方网站不受影响；提示词写明聚合站及其子站不是官方', async () => {
    const db = 库(); const t = 工具(通过());
    await 跑(db, t);
    expect(届次(db).status).toBe('已发布');
    expect(t.调用们[0].messages[0].content).toContain('子站');
    db.close();
  });
});

describe('已发布、已归档：AI 只能把它放进回收站，不改状态（2026-11-07 用户定）', () => {
  const 已发布 = { status: '已发布', status_reason: [], registration_start: '2026-11-01', registration_end: '2026-12-01' };
  test('报名时间和原文不一致：改成原文的，还是已发布，留改正记录', async () => {
    const db = 库({ 届: 已发布 }); const t = 工具(通过());
    await 跑(db, t);
    expect(届次(db)).toMatchObject({ status: '已发布', registration_end: '2026-12-20' });
    expect(db.find('audit_log', { action: '维护改正' }).some(r => r.detail.字段 === 'registration_end')).toBe(true);
    db.close();
  });
  test.each([
    ['查不到', { 结论: '查不到', 理由: '官网打不开', 来源性质: '判断不了', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [] }],
    ['名称不符', 通过({ 名称: { 对不对: false, 改正: '别的名字' } })],
  ])('%s：状态和理由都不动，只记下', async (_, 答案) => {
    const db = 库({ 届: 已发布 });
    const 回 = await 跑(db, 工具(答案));
    expect(届次(db)).toMatchObject({ status: '已发布', status_reason: [] });
    expect(回.留着.length).toBeGreaterThan(0);
    db.close();
  });
  test('已归档的查不到：一样不动（老届次官方页面没了很正常，查不到不等于有问题）', async () => {
    const db = 库({ 届: { ...已发布, status: '已归档' } });
    await 跑(db, 工具({ 结论: '查不到', 理由: '官网打不开', 来源性质: '判断不了', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [] }));
    expect(届次(db).status).toBe('已归档');
    db.close();
  });
  const 不收答案 = (类别 = '水赛') => ({ 结论: '不收', 理由: '人人有奖', 来源性质: '官方', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [], 不收: { 类别, 网址: 官网, 原文: '竞赛面向全国高校' } });
  test.each([['已发布'], ['已归档']])('%s、AI 判定不收：进回收站，写明理由', async 状态 => {
    const db = 库({ 届: { ...已发布, status: 状态 } });
    await 跑(db, 工具(不收答案()));
    进了回收站(db, '水赛：人人有奖');
    db.close();
  });
  test('已发布、校内赛：不进回收站，只记下（用户要留存）', async () => {
    const db = 库({ 届: 已发布 });
    await 跑(db, 工具(不收答案('校内赛')));
    expect(届次(db)).toMatchObject({ status: '已发布', status_reason: [] });
    db.close();
  });
  test('已发布、状态是人工定的：不进回收站，也不下架，只记下', async () => {
    const db = 库({ 届: { ...已发布, manual_fields: ['status'] } });
    const 回 = await 跑(db, 工具(不收答案()));
    expect(届次(db)).toMatchObject({ status: '已发布', status_reason: [] });
    expect(回.留着.some(p => String(p.说明).includes('人工定'))).toBe(true);
    db.close();
  });
  test('人工改过的字段：机器不改，也不会因此转待人工审核', async () => {
    const db = 库({ 届: { ...已发布, manual_fields: ['registration_end'] } });
    const 回 = await 跑(db, 工具(通过()));
    expect(届次(db)).toMatchObject({ status: '已发布', registration_end: '2026-12-01' });
    expect(回.留着.some(p => String(p.说明).includes('人工改过'))).toBe(true);
    db.close();
  });
});

describe('怎么改', () => {
  test('文字字段只补空的，有内容的不覆盖；比赛级的主办方补在比赛上', async () => {
    const db = 库({ 比赛: { organizer: null }, 届: { participants: '所有在校生' } });
    const t = 工具(通过({ 字段们: [...通过().字段们,
      { 字段: 'participants', 值: '全国高校在读大学生', 网址: 官网, 原文: '参赛对象：全国高校在读大学生' },
      { 字段: 'organizer', 值: '中国工业与应用数学学会', 网址: 官网, 原文: 原文们.organizer }] }));
    await 跑(db, t);
    expect(届次(db).participants).toBe('所有在校生');
    expect(db.get('competition', 'event-mcm').data.organizer).toBe('中国工业与应用数学学会');
    db.close();
  });
  test('日期不是这一届的（差一年以上）：不采用', async () => {
    const db = 库({ 届: { edition_year: '2024', edition_name: '2024 全国大学生数学建模竞赛' } }); const t = 工具(通过());
    await 跑(db, t);
    进了回收站(db, '不是这一届的日期');
    db.close();
  });
  test('官方写明待公布：标 pending_announcement，可以发布', async () => {
    const db = 库(); const 页 = `${正文}报名时间另行通知。`;
    const t = 工具(通过({ 字段们: [], 待公布: [{ 字段: 'registration_end', 网址: 官网, 原文: '报名时间另行通知' }] }), 页);
    await 跑(db, t);
    expect(届次(db)).toMatchObject({ status: '已发布', pending_announcement: true });
    db.close();
  });
  test('库里已有这个来源网址：更新成核验过，不重复加一条', async () => {
    const db = 库();
    db.insert('source', 'source-old', { edition_id: 'edition-mcm-2026', url: 官网, source_type: 'search_candidate', is_official: false, validity_status: 'unchecked' });
    await 跑(db, 工具(通过()));
    expect(来源们(db)).toHaveLength(1);
    expect(来源们(db)[0]).toMatchObject({ id: 'source-old', is_official: true, validity_status: 'valid', source_type: 'organizer_notice' });
    db.close();
  });
  test('试跑：什么都不写', async () => {
    const db = 库();
    await 跑(db, 工具(通过()), { dryRun: true });
    expect(届次(db).status).toBe('待人工审核');
    expect(来源们(db)).toEqual([]);
    await 跑(db, 工具({ 结论: '查不到', 理由: '无', 来源性质: '判断不了', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [] }), { dryRun: true });
    expect(届次(db).status).toBe('待人工审核');
    db.close();
  });
});

describe('出错和范围', () => {
  test('没给比赛范围：不调 AI，不做全库审查', async () => {
    const db = 库(); const t = 工具(通过());
    const 回 = await 跑(db, t, { 比赛编号: null });
    expect(t.调用们).toEqual([]);
    expect(回.问题).toBe(0);
    db.close();
  });
  test('额度用完、接口出错：这一项算失败并带上种类，什么都不写', async () => {
    const db = 库(); const 错 = Object.assign(new Error('额度不足'), { kind: '额度用完' });
    const 回 = await 跑(db, 工具(错));
    expect(回.检查.失败[0]).toMatchObject({ name: '核对原文', kind: '额度用完' });
    expect(届次(db).status).toBe('待人工审核');
    db.close();
  });
  test('Codex 交回的格式不对：这一届只记下，不影响状态', async () => {
    const db = 库();
    const 回 = await 跑(db, 工具({ 结论: '随便' }));
    expect(回.检查.失败).toEqual([]);
    expect(回.留着.some(p => String(p.说明).includes('用不了'))).toBe(true);
    expect(届次(db).status).toBe('待人工审核');
    db.close();
  });
  test('看哪几届：待人工审核、已发布、最新一届；更早的已归档不看', async () => {
    const db = 库();
    db.transaction(tx => {
      tx.insert('edition', 'edition-mcm-2024', { competition_id: 'event-mcm', ordinal: 0, edition_name: '2024 全国大学生数学建模竞赛', edition_year: '2024', status: '已归档' });
      tx.insert('edition', 'edition-mcm-2027', { competition_id: 'event-mcm', ordinal: 2, edition_name: '2027 全国大学生数学建模竞赛', edition_year: '2027', status: '已归档' });
    });
    const t = 工具({ 结论: '查不到', 理由: '无', 来源性质: '判断不了', 名称: { 对不对: true, 改正: '' }, 字段们: [], 待公布: [] });
    await 跑(db, t);
    const 问过 = t.调用们.map(r => r.messages.at(-1).content).join('\n');
    expect(问过).toContain('2026 全国大学生数学建模竞赛');
    expect(问过).toContain('2027 全国大学生数学建模竞赛');
    expect(问过).not.toContain('2024 全国大学生数学建模竞赛');
    db.close();
  });
});
