// 程序去重：和库里比，一样的直接扔，不看相似（相似的交给 AI 去重）。按顺序看，碰上一条就扔：
//   1. 30 天内拒过的网址
//   2. 网址和库里一样（比赛官网、届次报名入口和线索通知、来源网址）
//   3. 在不收录名单里：网址一样，或标题规范化后和名称一样、标题里写着这个名称
//   4. 标题规范化后和库里某个比赛的名称或别名一样
// 认出是库里已有的比赛就扔，不管是哪一届：已有比赛的新一届由 维护 的“新一届”检查去找，寻找流程只找库里没有的新比赛。
//
//   程序去重(候选们, 库) → { 扔: [{ key, 原因 }], 留: [候选] }
import { 网址键 } from '../../../common/网址键.mjs';
import { 规范名称 } from '../../../common/规范名称.mjs';

export { 规范名称 };   // 规则在 common/规范名称.mjs（06 入库也用）


export function 程序去重(候选们, 库) {
  const 名称表 = new Map();
  for (const c of 库.比赛们) for (const name of [c.名称, ...c.别名们]) {
    const key = 规范名称(name);
    if (key && !名称表.has(key)) 名称表.set(key, c);
  }
  const 扔 = [];
  const 留 = [];
  for (const 候选 of 候选们) {
    const 原因 = 判(候选, 库, 名称表);
    if (原因) 扔.push({ key: 候选.key, 原因 }); else 留.push(候选);
  }
  return { 扔, 留 };
}

function 判(候选, 库, 名称表) {
  const 键 = 网址键(候选.data.url || 候选.key);
  const 标题 = String(候选.data.name || '');
  const 规范标题 = 规范名称(标题);
  if (库.拒过.has(键)) { const { 模块, 原因 } = 库.拒过.get(键); return `30 天内拒过（${模块}：${原因}）`; }
  if (库.网址们.has(键)) return `网址和库里一样：${库.网址们.get(键)}`;
  for (const b of 库.不收录) {
    if (b.网址键 && b.网址键 === 键) return `在不收录名单里：${b.名称们[0]}`;
    const 名称 = b.名称们.find(name => name && (规范名称(name) === 规范标题 || 标题.includes(name)));
    if (名称) return `在不收录名单里：${名称}`;
  }
  const 比赛 = 规范标题 && 名称表.get(规范标题);
  if (比赛) return `名称和库里比赛一样：${比赛.名称}（${比赛.编号}）`;
  return null;
}
