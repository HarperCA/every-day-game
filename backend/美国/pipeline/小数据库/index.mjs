// 小数据库（当晚的 run.db）的唯一入口。流程里只有总控直接引用，模块经 ctx.小数据库 调它的接口；流程外只读：后台（读最近失败、列出几晚、读一晚）、每周的屏蔽网站建议（读候选网站）。
//   openRunDb(file, { runId })   打开或创建当晚的库 → 处理接口：写入结果、已写入、创建当晚、条目和改动的读取、撤销重跑……
//   checkModuleOutput、summarize 结果的格式检查和统计（写入结果里已经调用，单独导出给测试用）
//   读最近失败({ 根, 天数, now })  只读最近几晚失败的模块和条目，给后台“失败任务”页
export { openRunDb, RUNDB_VERSION } from './库.mjs';
export { checkModuleOutput, summarize, ITEM_STATUSES, CHANGE_OPS } from './交接检查.mjs';
// 后台“失败任务”页只读最近几晚的失败（后台不经总控，直接经这个入口读）
export { 读最近失败 } from './读失败.mjs';
// 后台“抓取结果账”页：列出有哪几晚、读一晚的各模块、条目去向、写进比赛库没有
export { 列出几晚, 读一晚, 读候选网站 } from './读运行记录.mjs';
