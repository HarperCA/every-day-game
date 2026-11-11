// 03-filter 筛选：模块入口，主流程在 筛选总管/（说明见同目录 README.md）。
//   筛选总管/       主流程：调下面三个，经 ctx.小数据库 查找、删除、标记线索
//   标题筛选/       程序化筛选，只看标题
//   Jev筛选/        经 AI 总管问 Jev 是哪类页面
//   Codex代理追踪/  经 AI 总管让 Codex 追到比赛的官方来源（原来的 04 通知追溯，2026-11-01 并进来）
// 规矩：只通过 run(input, ctx) 和外面打交道；不 import 别的模块；不直接碰 run.db 和比赛库。
export { meta, run, createRun, DEFAULT_PARTS } from './筛选总管/index.mjs';
