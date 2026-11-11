// 01-search 搜索：主运行文件，只负责按顺序调用下面几个接口，每个接口一个文件夹、各有 README。
//
//   搜索词/     生成搜索词(ctx)              预处理：细分专业轮换，生成当晚的搜索词（每个附理由），列出要跑的平台；
//               记录搜索词(每个词, ctx)      搜完把每个词搜到几条记进搜索词自己的记录表（试跑不写）
//   搜索接口/   调用搜索(计划, ctx)          每个搜索词经 AI 总管搜一次（百度 → Kimi → DeepSeek 补位）
//   平台/       调用平台(计划, ctx)          针对性平台脚本的集成接口（天池、辽宁……），和搜索接口同时跑
//   结果处理/   处理结果({ 结果们, 问题们 }) 合并各渠道结果：同一网址合成一条候选，记下渠道、搜索词、路线
//   最终结果/   写入最终结果(…, ctx)         只调小数据库的接口：创建当晚、写入候选
//
// 和库里对比去重在下一个模块 02-dedup。规矩：只通过 run(input, ctx) 和外面打交道；不 import 别的模块；不直接碰 run.db。
import { 生成搜索词, 记录搜索词 } from './搜索词/index.mjs';
import { 调用搜索 } from './搜索接口/index.mjs';
import { 调用平台 } from './平台/index.mjs';
import { 处理结果 } from './结果处理/index.mjs';
import { 写入最终结果 } from './最终结果/index.mjs';

export const meta = { title: '搜索', version: 1 };
export const DEFAULT_PARTS = { 生成搜索词, 调用搜索, 调用平台, 处理结果, 写入最终结果, 记录搜索词 };

export function createRun(parts = DEFAULT_PARTS) {
  return async function run(input, ctx) {
    const 计划 = await parts.生成搜索词(ctx);
    const [搜到, 平台] = await Promise.all([parts.调用搜索(计划, ctx), parts.调用平台(计划, ctx)]);
    const { 候选们, 问题们 } = parts.处理结果({
      结果们: [...搜到.结果们, ...平台.结果们],
      问题们: [...(计划.问题们 || []), ...搜到.问题们, ...平台.问题们],
    });
    ctx.log.info(`搜索：搜索词 ${计划.搜索词们.length} 个、平台 ${计划.平台们.length} 个，候选 ${候选们.length} 条${问题们.length ? `，问题 ${问题们.length} 个` : ''}`);
    const 写好 = await parts.写入最终结果({ 计划, 候选们, 问题们 }, ctx);
    // 结果已经写进小数据库，记录表写不进去只记警告：明晚这些词可能被重复搜，不影响今晚
    const 搜成功 = (搜到.每个词 || []).filter(x => x.成功).map(({ 词, 路线, 候选数 }) => ({ 词, 路线, 候选数 }));
    try { await parts.记录搜索词(搜成功, ctx); } catch (error) { ctx.log.warn(`记录搜索词失败：${error.message}`); }
    return 写好;
  };
}

export const run = createRun();
