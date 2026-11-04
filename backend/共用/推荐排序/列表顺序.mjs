// 首页列表顺序（《第一步：排序规则》①–⑥）。从旧代码 publicData/listOrder.js（buildPublicList + personalizePage）和
// preferenceMatch.js 搬来，逻辑不变，只有一处按规则 ① 改：搜索词对得上专业时，名称命中的也留着（旧代码会漏掉专业不对的名称命中）。
//
//   排列表(items, 条件, now) → { 条目们: [{ ...item, 列表分组, 搜索块 }], 搜到的专业 }
//     items：比赛和届次合在一起的条目（id 是届次编号，competition_id 是比赛编号，name 是比赛名称，edition_name 是届次全称……）
//     条件：
//       关键词       ① 名称、届次、主办方、别名、方向标签里含这段字的算名称命中；像专业名的，专业大类对得上的也算（排在名称命中的后面）
//       专业们、省份  ② 没有关键词时按专业大类、省份筛（“综合/不限专业”的比赛对任何专业都算；没写地区的对任何省份都算）
//       列表分组      ③ 只要这几组（报名中、时间待公布、比赛中、比赛已结束）；不给不筛
//       收藏、提醒    ④ 比赛编号、届次编号：组内 收藏且提醒 → 只收藏 → 只提醒 → 其他
//       用户专业、专业、目标路径、目标岗位   ⑥ 综合分用
//     顺序：搜索块（名称命中 0、只是专业对得上 1）→ ③ 分组 → ④ 档次 → ⑤ 截止日 → ⑥ 综合分
//   专业对得上(item, 专业们)、省份对得上(item, 省份)
// 收藏、提醒的比赛不符合筛选条件也不显示。其余筛选（级别、参赛形式、费用……）在调用前做。
import { 分组顺序, 状态分组, 时刻 } from './报名状态.mjs';
import { 综合分排名 } from './综合分.mjs';
import { 专业大类 } from './专业关键词.mjs';

const 大区 = {
  华东: ['上海', '江苏', '浙江', '安徽', '福建', '江西', '山东'], 华北: ['北京', '天津', '河北', '山西', '内蒙古'],
  华南: ['广东', '广西', '海南', '香港', '澳门'], 华中: ['河南', '湖北', '湖南'],
  西南: ['重庆', '四川', '贵州', '云南', '西藏'], 西北: ['陕西', '甘肃', '青海', '宁夏', '新疆'], 东北: ['辽宁', '吉林', '黑龙江'],
};

// 多选按“任意一项对上”，“综合/不限专业”的比赛对任何专业都算
export function 专业对得上(item, 专业们 = []) {
  if (!专业们.length) return true;
  return (item.professions || []).some(值 => 值 === '综合/不限专业' || 专业们.includes(值));
}

export function 省份对得上(item, 省份 = '') {
  if (!省份) return true;
  const 地区 = String(item.region || '').trim();
  // 没写地区限制的照样显示，免得把全国比赛或地区待核实的误排除
  if (!地区 || /全国|不限|全球|国际/.test(地区)) return true;
  // 选“全国”只要上面这些不限地区的
  if (省份 === '全国') return false;
  const 简称 = 省份.replace(/壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市/g, '');
  if (地区.includes(简称)) return true;
  return Object.keys(大区).some(名 => 地区.includes(名) && 大区[名].includes(简称));
}

const 搜索文字 = item => [item.name, item.edition_name, item.organizer, ...(item.aliases || []), ...(item.objective_tags || [])].filter(Boolean).join(' ').toLowerCase();

// ⑤ 报名中、时间待公布：截止日越近越靠前；已过截止日的两组：离今天越近（越晚截止）越靠前；没有截止日的排后面
function 比截止日(a, b, 分组) {
  const 甲 = 时刻(a.registration_end, '截止');
  const 乙 = 时刻(b.registration_end, '截止');
  if (甲 === null && 乙 === null) return 0;
  if (甲 === null) return 1;
  if (乙 === null) return -1;
  return 分组 === '比赛中' || 分组 === '比赛已结束' ? 乙 - 甲 : 甲 - 乙;
}

export function 排列表(items, 条件 = {}, now = new Date()) {
  const 词 = String(条件.关键词 || '').trim().toLowerCase().slice(0, 100);
  const 搜到的专业 = 词 ? 专业大类(词) : [];
  const 名称命中 = item => 搜索文字(item).includes(词);
  const 留下 = items.filter(item => {
    if (词) return 名称命中(item) || (搜到的专业.length > 0 && 专业对得上(item, 搜到的专业));
    return 专业对得上(item, 条件.专业们 || []) && 省份对得上(item, 条件.省份 || '');
  });

  // ③ 分组 → ⑤ 截止日 → ⑥ 综合分：对所有人一样
  const 综合名次 = new Map(综合分排名(留下, 条件, now).map((item, 名次) => [item, 名次]));
  const 要的分组 = new Set((条件.列表分组 || []).filter(名 => 分组顺序.includes(名)));
  const 公共 = 留下.map(item => ({ item, 分组: 状态分组(item, now) }))
    .sort((a, b) => 分组顺序.indexOf(a.分组) - 分组顺序.indexOf(b.分组) || 比截止日(a.item, b.item, a.分组) || 综合名次.get(a.item) - 综合名次.get(b.item))
    .filter(({ 分组 }) => !要的分组.size || 要的分组.has(分组));

  // ① 搜索块 → ③ 分组 → ④ 档次，同档保持上面的顺序
  const 分块 = 词 && 搜到的专业.length;
  const 收藏 = new Set(条件.收藏 || []);
  const 提醒 = new Set(条件.提醒 || []);
  const 档次 = item => {
    const 藏 = 收藏.has(item.competition_id);
    const 醒 = 提醒.has(item.id);
    return 藏 && 醒 ? 0 : 藏 ? 1 : 醒 ? 2 : 3;
  };
  const 条目们 = 公共
    .map(({ item, 分组 }, 位置) => ({ item: { ...item, 列表分组: 分组, 搜索块: 分块 && !名称命中(item) ? 1 : 0 }, 位置, 档: 档次(item) }))
    .sort((a, b) => a.item.搜索块 - b.item.搜索块 || 分组顺序.indexOf(a.item.列表分组) - 分组顺序.indexOf(b.item.列表分组) || a.档 - b.档 || a.位置 - b.位置)
    .map(({ item }) => item);
  return { 条目们, 搜到的专业: 词 ? 搜到的专业 : null };
}
