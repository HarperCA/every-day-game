// 只在有届次与赛道依据时判重，官网或报名网址可能跨届或跨赛道复用。
import { 网址键 } from '../../../common/网址键.mjs';
import { 规范名称 } from '../../../common/规范名称.mjs';
import { 比赛身份, 比届次 } from '../../../common/届次与赛道.mjs';

export { 规范名称 };   // 规则在 common/规范名称.mjs（06 入库也用）


export function 程序去重(候选们, 库) {
  const 扔 = [];
  const 留 = [];
  for (const 候选 of 候选们) {
    const 原因 = 判(候选, 库);
    if (原因) 扔.push({ key: 候选.key, 原因 }); else 留.push(候选);
  }
  return { 扔, 留 };
}

function 判(候选, 库) {
  const 键 = 网址键(候选.data.url || 候选.key);
  const 标题 = String(候选.data.name || '');
  const 规范标题 = 规范名称(标题);
  const 身份 = 候选身份(候选);
  const 拒过 = 库.拒过.get(键);
  if (拒过 && !身份.赛道键 && !身份.赛道不明确 && 比届次(身份, 比赛身份(拒过.标题)) !== 1) {
    return '30 天内拒过（' + 拒过.模块 + '：' + 拒过.原因 + '）';
  }
  for (const b of 库.不收录) {
    if (b.网址键 && b.网址键 === 键) return `在不收录名单里：${b.名称们[0]}`;
    const 名称 = b.名称们.find(name => name && (规范名称(name) === 规范标题 || 标题.includes(name)));
    if (名称) return `在不收录名单里：${名称}`;
  }
  const 比赛 = 库.比赛们.find(c =>
    [c.名称, ...c.别名们].some(name => 比赛身份(name).名称键 === 身份.名称键)
    && 已有同赛道旧届(身份, 库.已收录届次?.get(c.编号)));
  if (比赛) return '同一比赛和赛道的旧届或同届：' + 比赛.名称 + '（' + 比赛.编号 + '）';
  return null;
}

export function 候选身份(候选) {
  const 身份 = 比赛身份(候选.data.name, 候选.data.track_name);
  return { ...身份, 赛道不明确: !身份.赛道键 && /赛道|专项赛/.test(候选.data.name + ' ' + (候选.data.snippet || '')) };
}

export function 已有同赛道旧届(候选, 届次们 = []) {
  return !候选.赛道不明确 && 届次们.some(届 => {
    const 次序 = 比届次(候选, 届);
    return 候选.赛道键 === 届.赛道键 && 次序 != null && 次序 <= 0;
  });
}
