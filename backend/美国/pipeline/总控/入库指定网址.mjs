// 入库指定网址（2026-11-08 用户定：新维护爬到的通知“调用之前入库的工具进行网站的字段读取和入库”）：
// 给几个网址，照每晚流程跑 04 读详情和抽取 → 05 审核 → 06 入库，最后用 06 的 写入主库 写进比赛库。
// 规则和每晚流程完全一样（程序填 + DeepSeek 抽取、逐字核对、程序审核、Kimi 三项核验、对照主库、发布门槛；过了就是发布）。
// 不审核（2026-11-08 用户定“进行维护的时候不需要审核”“发现新的一届直接进行调换”）：不跑 05，04 抽取完直接交 06（见下面 不审核）。
// 小数据库开在内存里，跑完就扔；不写运行文件夹、不写当晚报告。新维护经这个文件用流程，不碰模块和零件。
//
//   入库指定网址([{ 网址, 标题, 比赛名, 比赛编号?, 届次? }], { 主库, ai, web, 来源, 试跑, 更新已有, 放宽资料, 不审核, log, now, 模块们, 写入主库 })
//     → { 条目们: [{ 网址, 状态, 原因, 入库, 入库类型, 改动, 写进 }], 写入 }
//     ai：AI 总管（每个模块开一个会话，来源写 来源、模块写“来源-模块名”）；web：{ 读网页 }
//     比赛编号（2026-11-08）：已经知道是哪个比赛（新维护维护的那个）。06 只在这个比赛下认届次，名字写法不同也不另建比赛。
//     届次（届次编号，2026-11-08）：已经知道是哪一届。06 直接用这一届（补来源 / 已处理过，开了更新已有就比字段），不按名字认；
//            这一届不存在或不属于比赛编号时这条失败，原因写明。
//     放宽资料（默认 false，2026-11-08 用户定，只给维护用）：05 审核的范围闸、资料齐不齐判“待定”（缺字段、缺依据）的不挡，“不收”照挡。
//     不审核（默认 false，2026-11-08 用户定，只给维护用）：true 时模块们里的 05-review 不跑（放宽资料也就不起作用），04 抽取完直接交 06，
//            06 收到 input.不审核：记录用 合成记录 合成，这条通知（和 04 补读到的正式通知）按核验过的官方来源写，核对理由写明“维护不审核”；
//            对上已有届次照 更新已有 比字段、补来源；新的一届不卡发布门槛直接新建发布（已截止的归档），原来最新的那一届归档；
//            对出来是新比赛的丢弃（维护不新建比赛）。见 ../modules/06-ingest/README.md。
//     更新已有（默认 false，2026-11-08）：对上库里已有的一届时，按这条通知改那一届的字段（2026-11-09：确定事实不同就改、其余只补空，见 06 README），照样补来源。
//     状态：进行中（06 放进待写入了）、已丢弃（哪一步、什么原因）、顺延、失败
//     入库：06 记的 data.ingest；入库类型：新比赛 / 新一届 / 补来源 / 已处理过，被 05 丢掉、被 06 丢掉（发布门槛、维护不新建比赛）或没走到 06 这一步的是 null
//     改动：[{ 届次, 字段, 改前, 改后 }]，改了已有届次的哪些字段；试跑照常算出来（不写库），真写时只留真的写进去的（版本冲突跳过的不算）
//     写进（2026-11-08）：这条在写入主库时真的写进去了——新比赛 / 新一届：新届次那一行写进去了；补来源 / 已处理过：补的来源或改届次的修改至少有一条写进去了。
//            写入主库整体失败撤回（写入.error 有值）、试跑、条目最后不是“进行中”（写入时字段不合格被丢弃、被 05 丢掉、失败）的都是 false；
//            新届次因“主库已有这一行”被跳过的是 false；已处理过又没改动的（没写东西）是 false
//     写入：写入主库交回的 { total, written, conflicts, rejected, dryRun, error, … } 原样交回，error 有值就是整体失败撤回了
//     模块出错就停下、不写主库，抛错交给调用方（新维护记下原因，下次再试）。
import { buildContext } from './零件/context.mjs';
import { loadModule, MODULES } from './零件/modules.mjs';
import { openRunDb } from '../小数据库/index.mjs';
import { 写入主库 as 默认写入主库 } from '../modules/06-ingest/index.mjs';
import { createBudget } from '../../../共用/工具/budget.mjs';

export const 默认模块们 = MODULES.filter(m => ['04-extract', '05-review', '06-ingest'].includes(m.name));
const 静 = { info() {}, warn() {}, error() {}, child() { return this; } };

export async function 入库指定网址(网址们, { 主库, ai = null, web = null, 来源 = '新维护', 试跑 = false, 更新已有 = false, 放宽资料 = false, 不审核 = false, log = 静, now = () => new Date(), 模块们 = 默认模块们, 写入主库 = 默认写入主库 } = {}) {
  const runId = `${来源}-${now().toISOString()}`;
  const rundb = openRunDb(':memory:', { runId });
  try {
    const 候选们 = 网址们.map(x => ({ key: x.网址, kind: 'candidate', status: '进行中', result: '新维护找到的通知', reason: `${来源}：爬虫脚本在官网列表里找到`,
      data: { url: x.网址, title: x.标题 || '', name: x.比赛名 || '', snippet: '', 渠道们: [来源], 路线们: [来源], 搜索词们: [], ...(x.比赛编号 ? { 比赛编号: x.比赛编号 } : {}), ...(x.届次 ? { 届次编号: x.届次 } : {}) } }));
    rundb.写入结果(来源, { items: 候选们, changes: [], problems: [] });
    const budget = createBudget({});
    // 不审核：05 审核不跑，04 抽取完直接交 06
    for (const entry of 不审核 ? 模块们.filter(m => m.name !== '05-review') : 模块们) {
      const mod = await loadModule(entry);
      const 会话 = ai?.session ? ai.session({ source: 来源, runId, module: `${来源}-${mod.name}` }) : ai;
      const ctx = buildContext({ module: mod.name, rundb, mainDb: 主库, logger: log, signal: undefined, budget, ai: 会话, web, dryRun: 试跑, now });
      let output;
      try {
        output = await mod.run({ runId, module: mod.name, items: rundb.activeItems(), 更新已有, 放宽资料, 不审核, 来源 }, ctx);
      } catch (error) {
        throw new Error(`${mod.name} 出错：${String(error?.message || error).slice(0, 200)}`);
      }
      if (!rundb.已写入(mod.name)) rundb.写入结果(mod.name, output);
    }
    const 写入 = 写入主库({ 小数据库: rundb, 主库, log, 试跑 });
    const 已写入 = rundb.changes().filter(ch => ch.result === '已写入' && ch.tbl !== 'audit_log');
    // 真写时：改已有届次的那条修改真的写进去了才算（版本冲突跳过、整条不合格的不算）
    const 写进去了 = (key, 届次) => 试跑 || 已写入.some(ch => ch.item_key === key && ch.tbl === 'edition' && ch.op === 'update' && ch.row_key === 届次);
    const 写进 = (key, 入库, 状态) => {
      if (试跑 || 写入?.error || !入库 || 状态 !== '进行中') return false;
      const 这条 = 已写入.filter(ch => ch.item_key === key);
      if (入库.decision === '新比赛' || 入库.decision === '新一届') return 这条.some(ch => ch.tbl === 'edition' && ch.op === 'insert' && ch.row_key === 入库.editionId);
      return 这条.some(ch => (ch.tbl === 'source' && ch.op === 'insert') || (ch.tbl === 'edition' && ch.op === 'update' && ch.row_key === 入库.editionId));
    };
    const 条目们 = 候选们.map(c => {
      const 现在 = rundb.item(c.key);
      const 最后 = rundb.trailOf(c.key).at(-1);   // 原因记在条目的经过里
      const 入库 = 现在?.data?.ingest ?? null;
      const 状态 = 现在?.status ?? '失败';
      const 改动 = (入库?.改动 || []).filter(x => 写进去了(c.key, x.届次));
      return { 网址: c.key, 状态, 原因: 最后?.reason ?? '', 入库, 入库类型: 入库?.decision ?? null, 改动, 写进: 写进(c.key, 入库, 状态) };
    });
    return { 条目们, 写入 };
  } finally {
    rundb.close?.();
  }
}
