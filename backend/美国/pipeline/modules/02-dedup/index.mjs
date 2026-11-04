// 02-dedup 对比去重：主运行文件，只负责按顺序调用下面几个接口，每个接口一个文件夹、各有说明。
//
//   读库/       读库(ctx)                    统一的查询：比赛、库里所有网址、不收录名单、30 天内拒过的网址
//   程序去重/   程序去重(候选们, 库)          和库里一样的直接扔
//   AI去重/     AI去重(候选们, 库, ctx)       程序留下的交 DeepSeek 判：库里已有的、同批重复的扔掉
//
// 扔掉的经 ctx.小数据库.删除 标成已丢弃并写明原因（前面写明“02 对比去重·哪一步”），条目留着；留下的仍是进行中，交给 03 筛选。
// 关键模块：AI 出错就抛错，整晚停下、不提交；已经删的由总控按经过撤回。
// 规矩：只通过 run(input, ctx) 和外面打交道；不 import 别的模块；不直接碰 run.db 和比赛库。
import { 读库 } from './读库/index.mjs';
import { 程序去重 } from './程序去重/index.mjs';
import { AI去重 } from './AI去重/index.mjs';

export const meta = { title: '对比去重', version: 2 };
export const DEFAULT_PARTS = { 读库, 程序去重, AI去重 };

export function createRun(parts = DEFAULT_PARTS) {
  return async function run(input, ctx) {
    const 候选们 = ctx.小数据库.查找({ kind: 'candidate' });
    if (!候选们.length) {
      ctx.log.info('对比去重：今晚没有候选');
      return { items: [], changes: [], problems: [] };
    }
    const 库 = parts.读库(ctx);
    const 程序 = parts.程序去重(候选们, 库);
    const 写明 = (扔, 步) => 扔.map(x => ({ ...x, 原因: `02 对比去重·${步}：${x.原因}` }));
    if (程序.扔.length) ctx.小数据库.删除(写明(程序.扔, '程序去重'));
    const ai = await parts.AI去重(程序.留, 库, ctx);
    if (ai.扔.length) ctx.小数据库.删除(写明(ai.扔, 'AI去重'));
    ctx.log.info(`对比去重：候选 ${候选们.length} 条，程序扔掉 ${程序.扔.length} 条，AI 扔掉 ${ai.扔.length} 条，留下 ${程序.留.length - ai.扔.length} 条`);
    return { items: [], changes: [], problems: ai.问题们 };
  };
}

export const run = createRun();
