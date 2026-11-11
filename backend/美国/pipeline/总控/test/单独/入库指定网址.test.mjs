// 入库指定网址（2026-11-08 用户定：新维护爬到的通知“调用之前入库的工具”）：给几个网址，照每晚流程的 04 读详情和抽取 → 05 审核 → 06 入库跑一遍，
// 最后用 06 的 写入主库 写进比赛库（过了门槛就是发布）。小数据库开在内存里，跑完就扔。这里用假模块检查接线。
import { describe, expect, test } from 'vitest';
import { 入库指定网址, 默认模块们 } from '../../入库指定网址.mjs';
import { createMemoryMainDb } from '../../零件/maindb.mjs';
import { openDb } from '../../../../db/index.mjs';
import { 写入主库 as 默认写入主库 } from '../../../modules/06-ingest/index.mjs';

const 静 = { info() {}, warn() {}, error() {}, child() { return this; } };

describe('入库指定网址', () => {
  test('默认跑 04、05、06 三个模块', () => {
    expect(默认模块们.map(m => m.name)).toEqual(['04-extract', '05-review', '06-ingest']);
  });
  test('网址变成候选（键是网址），依次交给各模块（每个模块一个 AI 会话、同一个小数据库），最后调写入主库；交回每个网址的去向', async () => {
    const 记 = [];
    const 会话们 = [];
    const ai = { session: 身份 => { 会话们.push(身份); return { 身份 }; } };
    const 模块 = (name, 改) => ({ name, run: async (input, ctx) => {
      记.push([name, input.items.map(i => i.key), ctx.ai.身份.module]);
      return { items: input.items.map(i => ({ key: i.key, kind: i.kind, status: '进行中', data: { ...i.data, ...改(i) }, result: name, reason: `${name} 做完` })), changes: [], problems: [] };
    } });
    const 模块们 = [模块('04-extract', () => ({ extraction: { fields: {} } })), 模块('05-review', () => ({ review: { 结果: '通过' } })), 模块('06-ingest', i => ({ ingest: { decision: '新一届', competitionId: 'event-math', editionId: `${i.key}-届` } }))];
    let 写入参数;
    const 回 = await 入库指定网址([{ 网址: 'https://www.mcm.edu.cn/a.html', 标题: '关于举办2026年全国大学生数学建模竞赛的通知', 比赛名: '全国大学生数学建模竞赛' }], {
      主库: createMemoryMainDb(), ai, web: { 读网页: async () => ({}) }, 来源: '新维护', 模块们, log: 静,
      写入主库: 参数 => { 写入参数 = 参数; return { total: 0, written: 0, conflicts: 0, rejected: 0, dryRun: 参数.试跑, error: null }; },
    });
    expect(记.map(x => x[0])).toEqual(['04-extract', '05-review', '06-ingest']);
    expect(记[0][1]).toEqual(['https://www.mcm.edu.cn/a.html']);
    expect(会话们.map(x => x.module)).toEqual(['新维护-04-extract', '新维护-05-review', '新维护-06-ingest']);
    expect(会话们[0].source).toBe('新维护');
    expect(写入参数.试跑).toBe(false);
    expect(回.条目们).toEqual([{ 网址: 'https://www.mcm.edu.cn/a.html', 状态: '进行中', 原因: '06-ingest 做完', 入库: { decision: '新一届', competitionId: 'event-math', editionId: 'https://www.mcm.edu.cn/a.html-届' }, 入库类型: '新一届', 改动: [], 写进: false }]);
    expect(回.写入).toMatchObject({ written: 0 });
  });
  test('模块丢掉的条目（审核没过）交回已丢弃和原因；模块出错停下、不写主库', async () => {
    const 丢 = { name: '05-review', run: async (input, ctx) => { ctx.小数据库.删除(input.items.map(i => ({ key: i.key, 原因: '05 审核·收录门槛：不是大学生比赛' }))); return { items: [], changes: [], problems: [] }; } };
    const 过 = name => ({ name, run: async input => ({ items: input.items.map(i => ({ key: i.key, kind: i.kind, status: '进行中', data: i.data })), changes: [], problems: [] }) });
    let 写了 = false;
    const 回 = await 入库指定网址([{ 网址: 'https://a.cn/1', 标题: 'x', 比赛名: 'y' }], { 主库: createMemoryMainDb(), ai: null, 模块们: [过('04-extract'), 丢, 过('06-ingest')], log: 静, 写入主库: () => { 写了 = true; return {}; } });
    expect(回.条目们[0]).toMatchObject({ 状态: '已丢弃', 原因: '05 审核·收录门槛：不是大学生比赛', 入库: null, 入库类型: null, 改动: [], 写进: false });
    expect(写了).toBe(true);
    const 坏 = { name: '04-extract', run: async () => { throw new Error('读网页炸了'); } };
    写了 = false;
    await expect(入库指定网址([{ 网址: 'https://a.cn/1', 标题: 'x', 比赛名: 'y' }], { 主库: createMemoryMainDb(), 模块们: [坏], log: 静, 写入主库: () => { 写了 = true; } })).rejects.toThrow('04-extract 出错：读网页炸了');
    expect(写了).toBe(false);
  });
  test('放宽资料（维护用，2026-11-08）：传给各模块的 input；默认 false', async () => {
    const 看到 = [];
    const 记 = name => ({ name, run: async input => { 看到.push([name, input.放宽资料]); return { items: input.items.map(i => ({ key: i.key, kind: i.kind, status: '进行中', data: i.data })), changes: [], problems: [] }; } });
    const 参数 = { 主库: createMemoryMainDb(), 模块们: [记('04-extract'), 记('05-review')], log: 静, 写入主库: () => ({}) };
    await 入库指定网址([{ 网址: 'https://a.cn/1', 标题: 'x', 比赛名: 'y' }], { ...参数, 放宽资料: true });
    await 入库指定网址([{ 网址: 'https://a.cn/1', 标题: 'x', 比赛名: 'y' }], 参数);
    expect(看到).toEqual([['04-extract', true], ['05-review', true], ['04-extract', false], ['05-review', false]]);
  });
  // 2026-11-08 用户定：“进行维护的时候不需要审核”“发现新的一届直接进行调换”
  test('不审核：不跑 05，04 之后直接交 06，不审核传进 input；默认 false 照跑 05', async () => {
    const 看到 = [];
    const 记 = name => ({ name, run: async input => { 看到.push([name, input.不审核]); return { items: input.items.map(i => ({ key: i.key, kind: i.kind, status: '进行中', data: i.data })), changes: [], problems: [] }; } });
    const 参数 = { 主库: createMemoryMainDb(), 模块们: [记('04-extract'), 记('05-review'), 记('06-ingest')], log: 静, 写入主库: () => ({}) };
    await 入库指定网址([{ 网址: 'https://a.cn/1', 标题: 'x', 比赛名: 'y' }], { ...参数, 不审核: true });
    expect(看到).toEqual([['04-extract', true], ['06-ingest', true]]);
    看到.length = 0;
    await 入库指定网址([{ 网址: 'https://a.cn/1', 标题: 'x', 比赛名: 'y' }], 参数);
    expect(看到).toEqual([['04-extract', false], ['05-review', false], ['06-ingest', false]]);
  });
  test('试跑：照跑，写入主库按试跑（不写）', async () => {
    let 写入参数;
    await 入库指定网址([{ 网址: 'https://a.cn/1', 标题: 'x', 比赛名: 'y' }], { 主库: createMemoryMainDb(), 模块们: [], log: 静, 试跑: true, 写入主库: 参数 => { 写入参数 = 参数; return {}; } });
    expect(写入参数.试跑).toBe(true);
  });

  // 2026-11-08：新维护核对已有比赛——带比赛编号只在这个比赛下认届次，更新已有时按通知改已有届次的字段
  describe('更新已有、按已知比赛对照（用真的 06 和内存里的真比赛库）', () => {
    const now = new Date('2026-11-01T04:00:00.000Z');
    const 来源 = url => ({ url, final_url: url, source_type: 'organizer_notice', is_official: true, validity_status: 'valid', title: '通知', content_summary: '一致',
      evidence_excerpt: '由中国某某学会主办', review_reason: 'AI 三项核验通过：一致', supports_fields: ['name'], last_verified_at: now.toISOString() });
    const 准备 = () => {
      const db = openDb({ file: ':memory:', now: () => now });
      db.insert('competition', 'event-zl', { name: '全国高校某某设计大赛', level: '国家级' });
      db.insert('edition', 'edition-zl-2026', { competition_id: 'event-zl', ordinal: 1, edition_name: '2026年全国高校某某设计大赛', edition_year: '2026', status: '已发布', format_and_rules: '旧规则' });
      db.insert('source', 'source-zl-2026-1', { edition_id: 'edition-zl-2026', url: 'https://zl.cn/n/1', source_type: 'organizer_notice' });
      return db;
    };
    // 04 照抄；05 直接给审核通过的记录（名字是简称“中联杯”，和库里的写法不同）
    const 过04 = { name: '04-extract', run: async input => ({ items: input.items.map(i => ({ key: i.key, kind: i.kind, status: '进行中', data: i.data })), changes: [], problems: [] }) };
    const 审05名 = 名 => ({ name: '05-review', run: async input => ({ items: input.items.map(i => ({ key: i.key, kind: i.kind, status: '进行中', result: '通过', reason: '过了',
      data: { ...i.data, review: { 结果: '通过', 记录: { name: 名, organizer: '中国某某学会', format_and_rules: '新规则', registration_end: '2026-12-01', registration_url: 'https://reg.zl.cn', reward_highlights: [] }, 来源们: [来源(i.key)] } } })), changes: [], problems: [] }) });
    const 审05 = 审05名('2026年中联杯');
    const 真06 = 默认模块们.find(m => m.name === '06-ingest');
    // 2026-11-09 用户定只改确定的事实：库里有值的赛制（旧规则）不改；报名网址、报名截止、主办方原来空着，补上
    const 预期改动 = [
      { 届次: 'edition-zl-2026', 字段: 'registration_url', 改前: null, 改后: 'https://reg.zl.cn' },
      { 届次: 'edition-zl-2026', 字段: 'registration_end', 改前: null, 改后: '2026-12-01' },
      { 届次: 'edition-zl-2026', 字段: 'organizer', 改前: null, 改后: '中国某某学会' },
    ];
    const 按字段 = 列 => [...列].sort((a, b) => a.字段.localeCompare(b.字段));
    test('带比赛编号 + 更新已有：不另建比赛，补来源并改这一届的字段；交回 入库类型 和 改动，后台记录写明来源', async () => {
      const db = 准备();
      const 回 = await 入库指定网址([{ 网址: 'https://zl.cn/n/2', 标题: '关于举办2026年中联杯的通知', 比赛名: '中联杯', 比赛编号: 'event-zl' }],
        { 主库: db, 模块们: [过04, 审05, 真06], log: 静, now: () => now, 更新已有: true });
      expect(db.list('competition').map(x => x.key)).toEqual(['event-zl']);
      expect(回.条目们[0]).toMatchObject({ 状态: '进行中', 入库类型: '补来源', 入库: { decision: '补来源', competitionId: 'event-zl', editionId: 'edition-zl-2026' } });
      expect(按字段(回.条目们[0].改动)).toEqual(按字段(预期改动));
      expect(db.get('edition', 'edition-zl-2026').data).toMatchObject({ format_and_rules: '旧规则', registration_end: '2026-12-01', status: '已发布' });
      expect(db.get('source', 'source-zl-2026-2').data.url).toBe('https://zl.cn/n/2');
      expect(db.find('audit_log', { action: '入库改届次' })[0].detail).toMatchObject({ 来源: '新维护', 依据网址: 'https://zl.cn/n/2' });
      expect(回.条目们[0].写进).toBe(true);
    });
    test('试跑：照常算出改动，不写库', async () => {
      const db = 准备();
      const 回 = await 入库指定网址([{ 网址: 'https://zl.cn/n/2', 标题: 'x', 比赛名: '中联杯', 比赛编号: 'event-zl' }], { 主库: db, 模块们: [过04, 审05, 真06], log: 静, now: () => now, 更新已有: true, 试跑: true });
      expect(按字段(回.条目们[0].改动)).toEqual(按字段(预期改动));
      expect(db.get('edition', 'edition-zl-2026')).toMatchObject({ version: 1, data: { format_and_rules: '旧规则' } });
      expect(db.count('audit_log')).toBe(0);
      expect(回.条目们[0].写进).toBe(false);
    });
    test('不开更新已有：已有这一届只补来源，改动为空（行为和以前一样）', async () => {
      const db = 准备();
      const 回 = await 入库指定网址([{ 网址: 'https://zl.cn/n/2', 标题: 'x', 比赛名: '中联杯', 比赛编号: 'event-zl' }], { 主库: db, 模块们: [过04, 审05, 真06], log: 静, now: () => now });
      expect(回.条目们[0]).toMatchObject({ 入库类型: '补来源', 改动: [], 写进: true });
      expect(db.get('edition', 'edition-zl-2026').data.format_and_rules).toBe('旧规则');
    });
    test('真写时这一届被人改过（版本对不上）：没写进去的改动不算，改动交回空', async () => {
      const db = 准备();
      const 抢改06 = { name: '06-ingest', run: async (input, ctx) => {
        const mod = await import('../../../modules/06-ingest/index.mjs');
        const out = await mod.run(input, ctx);
        db.update('edition', 'edition-zl-2026', { time_note: '人工改的' }, 1);
        return out;
      } };
      const 回 = await 入库指定网址([{ 网址: 'https://zl.cn/n/2', 标题: 'x', 比赛名: '中联杯', 比赛编号: 'event-zl' }], { 主库: db, 模块们: [过04, 审05, 抢改06], log: 静, now: () => now, 更新已有: true });
      // 字段没改成，但来源补进去了，所以算写进
      expect(回.条目们[0]).toMatchObject({ 入库类型: '补来源', 改动: [], 写进: true });
      expect(db.get('edition', 'edition-zl-2026').data.format_and_rules).toBe('旧规则');
    });

    // 2026-11-08 代码审查：条目可以直接指定届次；交回的“写进”只看真的写进主库了没有
    const 真06先跑再 = 动手 => ({ name: '06-ingest', run: async (input, ctx) => {
      const mod = await import('../../../modules/06-ingest/index.mjs');
      const out = await mod.run(input, ctx);
      return 动手(out) || out;
    } });
    test('条目带届次：直接用这一届（名字里的年份对不上也不新建），年份不改；有值的赛制不改，空着的报名截止补上', async () => {
      const db = 准备();
      db.insert('edition', 'edition-zl-2025', { competition_id: 'event-zl', ordinal: 2, edition_name: '2025年全国高校某某设计大赛', edition_year: '2025', status: '已归档', format_and_rules: '旧规则' });
      const 回 = await 入库指定网址([{ 网址: 'https://zl.cn/n/2', 标题: 'x', 比赛名: '中联杯', 比赛编号: 'event-zl', 届次: 'edition-zl-2025' }],
        { 主库: db, 模块们: [过04, 审05, 真06], log: 静, now: () => now, 更新已有: true });
      expect(回.条目们[0]).toMatchObject({ 状态: '进行中', 入库类型: '补来源', 入库: { editionId: 'edition-zl-2025' }, 写进: true });
      expect(回.条目们[0].改动.map(x => x.字段)).not.toContain('edition_year');
      expect(db.get('edition', 'edition-zl-2025').data).toMatchObject({ edition_year: '2025', format_and_rules: '旧规则', registration_end: '2026-12-01' });
      expect(db.get('edition', 'edition-zl-2026').data.format_and_rules).toBe('旧规则');
    });
    test('条目带的届次不存在、或不属于这个比赛：这条失败，原因写清楚，写进 false', async () => {
      const db = 准备();
      db.insert('competition', 'event-other', { name: '别的比赛', level: '国家级' });
      db.insert('edition', 'edition-other-2026', { competition_id: 'event-other', ordinal: 1, edition_name: '2026年别的比赛', edition_year: '2026', status: '已发布' });
      const 回 = await 入库指定网址([
        { 网址: 'https://zl.cn/n/2', 标题: 'x', 比赛名: '中联杯', 比赛编号: 'event-zl', 届次: 'edition-none' },
        { 网址: 'https://zl.cn/n/3', 标题: 'x', 比赛名: '中联杯', 比赛编号: 'event-zl', 届次: 'edition-other-2026' },
      ], { 主库: db, 模块们: [过04, 审05, 真06], log: 静, now: () => now, 更新已有: true });
      expect(回.条目们[0]).toMatchObject({ 状态: '失败', 原因: expect.stringContaining('指定的届次 edition-none 主库里没有'), 写进: false });
      expect(回.条目们[1]).toMatchObject({ 状态: '失败', 原因: expect.stringContaining('指定的届次 edition-other-2026 不属于比赛 event-zl'), 写进: false });
      expect(db.count('source')).toBe(1);
    });
    test('已处理过（来源都有了、没改动）：写进 false', async () => {
      const db = 准备();
      const 回 = await 入库指定网址([{ 网址: 'https://zl.cn/n/1', 标题: 'x', 比赛名: '中联杯', 比赛编号: 'event-zl' }], { 主库: db, 模块们: [过04, 审05, 真06], log: 静, now: () => now });
      expect(回.条目们[0]).toMatchObject({ 状态: '已丢弃', 入库类型: '已处理过', 写进: false });
    });
    test('新一届真的写进去：写进 true；同一届在写之前已经被别人建了（主库已有这一行、跳过）：写进 false', async () => {
      const 新 = () => 入库指定网址([{ 网址: 'https://zl.cn/n/2', 标题: 'x', 比赛名: '中联杯', 比赛编号: 'event-zl' }], { 主库: db, 模块们: [过04, 审05名('2027年全国高校某某设计大赛'), 六], log: 静, now: () => now });
      let db = 准备();
      let 六 = 真06;
      const 回 = await 新();
      expect(回.条目们[0]).toMatchObject({ 状态: '进行中', 入库类型: '新一届', 写进: true });
      expect(db.get('edition', 'edition-zl-2027')).not.toBeNull();
      db = 准备();
      六 = 真06先跑再(() => { db.insert('edition', 'edition-zl-2027', { competition_id: 'event-zl', ordinal: 2, edition_name: '别人建的', edition_year: '2027', status: '已发布' }); });
      const 回2 = await 新();
      expect(回2.条目们[0]).toMatchObject({ 入库类型: '新一届', 写进: false });
      expect(db.get('edition', 'edition-zl-2027').data.edition_name).toBe('别人建的');
    });
    test('写入时字段不合格、这条被改成丢弃：写进 false', async () => {
      const db = 准备();
      const 坏06 = 真06先跑再(out => ({ ...out, changes: out.changes.map(c => (c.table === 'edition' && c.op === 'insert' ? { ...c, payload: { ...c.payload, ordinal: '第一' } } : c)) }));
      const 回 = await 入库指定网址([{ 网址: 'https://zl.cn/n/2', 标题: 'x', 比赛名: '中联杯', 比赛编号: 'event-zl' }], { 主库: db, 模块们: [过04, 审05名('2027年全国高校某某设计大赛'), 坏06], log: 静, now: () => now });
      expect(回.条目们[0]).toMatchObject({ 状态: '已丢弃', 入库类型: '新一届', 写进: false });
      expect(db.get('edition', 'edition-zl-2027')).toBeNull();
    });
    test('写入主库整体失败撤回：写入.error 交回，写进全为 false，改动为空', async () => {
      const db = 准备();
      const 坏主库写入 = 参数 => 默认写入主库({ ...参数, 主库: { transaction() { throw new Error('磁盘满了'); } } });
      const 回 = await 入库指定网址([{ 网址: 'https://zl.cn/n/2', 标题: 'x', 比赛名: '中联杯', 比赛编号: 'event-zl' }, { 网址: 'https://zl.cn/n/3', 标题: 'x', 比赛名: '中联杯', 比赛编号: 'event-zl' }],
        { 主库: db, 模块们: [过04, 审05, 真06], log: 静, now: () => now, 更新已有: true, 写入主库: 坏主库写入 });
      expect(回.写入.error).toBe('磁盘满了');
      expect(回.条目们.map(x => [x.状态, x.写进, x.改动])).toEqual([['进行中', false, []], ['进行中', false, []]]);
      expect(db.count('source')).toBe(1);
    });
    test('试跑：写进全为 false', async () => {
      const db = 准备();
      const 回 = await 入库指定网址([{ 网址: 'https://zl.cn/n/2', 标题: 'x', 比赛名: '中联杯', 比赛编号: 'event-zl' }], { 主库: db, 模块们: [过04, 审05名('2027年全国高校某某设计大赛'), 真06], log: 静, now: () => now, 试跑: true });
      expect(回.条目们[0]).toMatchObject({ 状态: '进行中', 入库类型: '新一届', 写进: false });
    });

    // 2026-11-08 用户定：维护不审核。04 抽完直接交真的 06：新的一届直接发布并把原来最新的那一届归档；对上已有届次照改字段
    describe('不审核（维护用）', () => {
      const 抽04 = 名 => ({ name: '04-extract', run: async input => ({ items: input.items.map(i => ({ key: i.key, kind: i.kind, status: '进行中', result: '抽取完成', reason: '抽取完成',
        data: { ...i.data, extraction: { fields: { competition_name: { value: 名, quote: 名 }, organizer: { value: '中国某某学会', quote: '由中国某某学会主办' },
          format_and_rules: { value: '新规则', quote: '新规则' }, registration_end: { value: '2026-12-01', quote: '12月1日截止' } } } } })), changes: [], problems: [] }) });
      const 不该跑05 = { name: '05-review', run: async () => { throw new Error('不审核时不该跑 05'); } };
      test('新的一届：直接新建发布，原来最新的那一届归档，来源是官方来源；交回 新一届、写进', async () => {
        const db = 准备();
        const 回 = await 入库指定网址([{ 网址: 'https://zl.cn/n/2', 标题: '关于举办2027年中联杯的通知', 比赛名: '中联杯', 比赛编号: 'event-zl' }],
          { 主库: db, 模块们: [抽04('2027年中联杯'), 不该跑05, 真06], log: 静, now: () => now, 更新已有: true, 不审核: true });
        expect(回.条目们[0]).toMatchObject({ 状态: '进行中', 入库类型: '新一届', 改动: [], 写进: true });
        expect(db.get('edition', 'edition-zl-2027').data).toMatchObject({ competition_id: 'event-zl', status: '已发布', format_and_rules: '新规则' });
        expect(db.get('edition', 'edition-zl-2026').data.status).toBe('已归档');
        expect(db.get('source', 'source-zl-2027-1').data).toMatchObject({ url: 'https://zl.cn/n/2', is_official: true, validity_status: 'valid', source_type: 'organizer_notice' });
        expect(db.list('competition').map(x => x.key)).toEqual(['event-zl']);
      });
      test('对上已有届次（带届次）：补来源、改字段', async () => {
        const db = 准备();
        const 回 = await 入库指定网址([{ 网址: 'https://zl.cn/n/2', 标题: 'x', 比赛名: '中联杯', 比赛编号: 'event-zl', 届次: 'edition-zl-2026' }],
          { 主库: db, 模块们: [抽04('2026年中联杯'), 不该跑05, 真06], log: 静, now: () => now, 更新已有: true, 不审核: true });
        expect(回.条目们[0]).toMatchObject({ 状态: '进行中', 入库类型: '补来源', 写进: true });
        expect(回.条目们[0].改动.map(x => x.字段).sort()).toEqual(['organizer', 'registration_end']);
        expect(db.get('edition', 'edition-zl-2026').data).toMatchObject({ format_and_rules: '旧规则', organizer: '中国某某学会', registration_end: '2026-12-01', status: '已发布' });
        expect(db.get('source', 'source-zl-2026-2').data).toMatchObject({ url: 'https://zl.cn/n/2', is_official: true });
      });
    });
  });
});
