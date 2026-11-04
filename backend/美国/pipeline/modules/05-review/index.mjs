// 05-review 审核：模块入口，主流程在 总审核/（说明见同目录 README.md）。
//   总审核/     主流程：小数据库查找 → 程序审核（美国/程序审核）→ 三项核验 → 过了交 06，没过的经小数据库标已丢弃
//   三项核验/   读来源网页，经 AI 总管交 Kimi 核对名称、报名时间、报名网址，判专业分类
// 规矩：只通过 run(input, ctx) 和外面打交道；不 import 别的模块；不直接碰 run.db 和比赛库。
export { meta, run, createRun, DEFAULT_PARTS } from './总审核/index.mjs';
