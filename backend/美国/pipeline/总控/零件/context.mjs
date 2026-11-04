// 给每个模块组装 ctx：模块需要的公用工具都从这里拿，模块之间不互相引用。
//
//   ctx.log        这个模块自己的日志
//   ctx.signal     停止信号：模块超时或整晚被停下时触发，长时间的调用要响应它
//   ctx.budget     当晚的额度（shared/budget.mjs）
//   ctx.dryRun     是不是试跑：试跑时总控不写总库，模块自己的记录（例如搜索词的记录表）也不写
//   ctx.items()    当晚还在进行中的条目（已丢弃、顺延、失败的不会出现）
//   ctx.view()     读总库里的一行，叠加当晚还没提交的改动，所以能看到前面模块新加的草稿
//   ctx.blobs      存取网页正文等大块内容
//   ctx.usage      记一次外部接口调用
//   ctx.小数据库    小数据库的处理接口：写入结果（自带格式检查）、创建当晚（记下当晚的运行信息）、
//                  查找（当晚的条目，默认进行中的）、删除（标成已丢弃）、标记线索（标成线索），都写明原因，记在这个模块名下
//   ctx.ai、ctx.web 调 AI（AI 总管给这个模块开的会话）、读网页（ctx.web.读网页）；没接入时一调就报错，提醒还没接
//   ctx.屏蔽网站() 百度搜索要带的屏蔽名单：内置 + 后台确认的（比赛库后台状态表）；读不到只用内置名单，不影响搜索
import { 屏蔽网站 } from '../../../db/index.mjs';

const notWired = name => new Proxy({}, { get: (_, prop) => () => { throw new Error(`${name}.${String(prop)} 骨架阶段还没接入`); } });

export function buildContext({ module, rundb, mainDb, logger, signal, budget, ai, web, dryRun = false, now = () => new Date() }) {
  function view(table, key) {
    const base = mainDb.get(table, key);
    const pending = rundb.pendingChangesFor(table, key).at(-1);
    if (!pending) return base;
    // 版本号仍是总库里的版本：后面的模块再改这一行时，要拿它做冲突检查
    return { version: base?.version ?? null, data: pending.payload, pending: true };
  }
  function list(table) {
    const rows = new Map(mainDb.list(table).map(row => [row.key, row]));
    for (const c of rundb.changes().filter(c => c.tbl === table && c.result === '待提交')) {
      rows.set(c.row_key, { key: c.row_key, version: rows.get(c.row_key)?.version ?? null, data: c.payload, pending: true });
    }
    return [...rows.values()];
  }
  return {
    module,
    log: logger.child(module),
    signal,
    budget,
    dryRun,
    now,
    items: (options = {}) => rundb.activeItems(options),
    item: key => rundb.item(key),
    view,
    list,
    blobs: { put: (body, kind) => rundb.putBlob(body, kind), get: hash => rundb.getBlob(hash) },
    屏蔽网站: () => {
      try { return 屏蔽网站.名单(mainDb.get('admin_state', 屏蔽网站.DOC)?.data?.data); } catch { return 屏蔽网站.BUILTIN_HOSTS; }
    },
    usage: { record: entry => rundb.recordCall({ module, ...entry }) },
    小数据库: {
      写入结果: output => rundb.写入结果(module, output),
      创建当晚: 信息 => rundb.创建当晚(信息),
      查找: 条件 => rundb.查找(条件),
      删除: 列表 => rundb.删除(module, 列表),
      标记线索: 列表 => rundb.标记线索(module, 列表),
    },
    ai: ai || notWired('ai'),
    web: web || notWired('web'),
  };
}
