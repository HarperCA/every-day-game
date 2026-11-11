// 搜索词：搜索前的预处理。交回当晚的搜索词给搜索接口用，每个附上理由；搜完把每个词搜到几条记进本文件夹的记录表。
//
//   生成搜索词(ctx, { 额度, 专业们, 文件 }) → { 搜索词们: [{ 路线, 词, 理由, 专业, 专业代码, 专业类, 门类 }], 平台们: [], 问题们: [] }
//   记录搜索词(每个词: [{ 词, 路线, 候选数 }], ctx, { 文件 }) → { 记录: n }；试跑（ctx.dryRun）不写
//
// 现在只有细分专业一条路线（专业轮换.mjs，从旧的 search-plan.mjs 搬来）：旧代码里额度也是全给细分专业，
// 追溯和新词试探两条路线的份额都是 0，没有搬。平台脚本还是占位，先不列。
import { 默认额度, 挑专业, 载入专业目录 } from './专业轮换.mjs';
import { 打开记录表, 读历史, 默认文件 } from './记录表.mjs';

const 北京年份 = now => new Date(now.getTime() + 8 * 3600000).getUTCFullYear();

export async function 生成搜索词(ctx, { 额度 = 默认额度, 专业们 = 载入专业目录(), 文件 = 默认文件 } = {}) {
  const now = ctx.now();
  const 历史 = 读历史(文件);
  if (!Object.keys(历史).length) ctx.log.info('搜索词：记录表里还没有记录，按从没搜过挑');
  return { 搜索词们: 挑专业(专业们, 额度, 历史, now, 北京年份(now)), 平台们: [], 问题们: [] };
}

export async function 记录搜索词(每个词, ctx, { 文件 = 默认文件 } = {}) {
  if (ctx.dryRun) {
    ctx.log.info(`搜索词：试跑，不写记录表（本来要记 ${每个词.length} 个词）`);
    return { 记录: 0, 试跑: true };
  }
  if (!每个词.length) return { 记录: 0 };
  const 表 = 打开记录表(文件);
  try { 表.写入(每个词, ctx.now()); } finally { 表.close(); }
  return { 记录: 每个词.length };
}
