// 首页双列瀑布流：把卡片按估算高度分到左右两列，哪列矮就放哪列（2026-10 淘宝风格改版）。
// 不引用 wx，测试可以直接加载这个文件。

// ---- 没有海报时的文字封面 ----
// 官网大多没有可用的封面图（实测 21 个能打开的官网只有 2 个声明了，其中 1 个还是报名平台的通用图），
// 所以没有海报、或海报加载失败时，用赛事名称排一张文字封面，颜色按专业大类区分。
// 不用 AI 画图：画出来的“海报”像官方物料，会让学生误以为是主办方发布的。
const TONE_BY_CATEGORY: Array<[RegExp, string]> = [
  [/计算机|电子信息/, 'blue'],
  [/数学/, 'indigo'],
  [/机械|建筑|能源|材料/, 'teal'],
  [/生物|医药/, 'green'],
  [/经管|商科/, 'orange'],
  [/设计|艺术/, 'purple'],
  [/人文|法学|外语|教育/, 'rose'],
];
const FALLBACK_TONES = ['indigo', 'blue', 'teal', 'purple'];

// 封面主标题：去掉年份、届次、杯名和“全国大学生”这类所有赛事都有的前缀，留下能区分比赛的部分。
// 前缀去掉后不足 5 个字就停（“中国国际大学生创新大赛”留“大学生创新大赛”，不剩一个光秃秃的“创新大赛”）
const MIN_COVER_TITLE = 5;
// 杯名：带引号的（“批改网杯”），或不带引号、紧跟着“全国/中国”的（蓝桥杯全国大学生……）
const QUOTED_CUP = /[“"「『]([^”"」』]{1,12}杯)[”"」』]/;
const LEADING_CUP = /^([一-龥A-Za-z0-9]{1,8}杯)(?=全国|中国)/;
export function coverTitleOf(name: string): string {
  const full = String(name || '').trim();
  let title = full
    .replace(/[“"「『][^”"」』]{1,20}[”"」』]/g, '')
    .replace(LEADING_CUP, '')
    .replace(/^(?:\d{4}\s*(?:—|-|－)?\s*\d{0,4}\s*(?:年度?|赛季)?)/, '')
    .replace(/第[一二三四五六七八九十百零〇\d]+届/g, '')
    .replace(/[（(][^）)]*[）)]$/, '')
    .trim();
  for (let i = 0; i < 3; i += 1) {
    const shorter = title.replace(/^(?:全国|中国|国际|首届|大学生|高校|普通高校|高等学校|学生)/, '');
    if (shorter === title || shorter.length < MIN_COVER_TITLE) break;
    title = shorter;
  }
  return title.length >= 2 ? title : full;
}

// 封面角标：有杯名用杯名（“批改网杯”），没有就用专业大类
export function coverOf(item: { id?: string; name?: string; professions?: string[] }) {
  const name = String(item.name || '').trim();
  const cup = QUOTED_CUP.exec(name)?.[1] || LEADING_CUP.exec(name)?.[1] || '';
  const category = (item.professions || []).find(value => value && value !== '综合/不限专业') || '';
  const matched = TONE_BY_CATEGORY.find(([pattern]) => pattern.test(category));
  let hash = 0;
  for (const ch of String(item.id || item.name || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    coverTitle: coverTitleOf(String(item.name || '')),
    coverKicker: cup || category || '大学生竞赛',
    coverTone: matched ? matched[1] : FALLBACK_TONES[hash % FALLBACK_TONES.length],
  };
}

export function withCover<T extends { id?: string; name?: string; professions?: string[] }>(item: T) {
  return { ...item, ...coverOf(item) };
}

// 卡片宽约 343rpx，名称 28rpx 字号一行大约放 11 个字，最多两行
const CHARS_PER_LINE = 11;
const POSTER_HEIGHT = 193;
const BODY_HEIGHT = 120;
const LINE_HEIGHT = 40;

export function estimateCardHeight(item: { name?: string }): number {
  const lines = Math.min(2, Math.max(1, Math.ceil(String(item.name || '').length / CHARS_PER_LINE)));
  return POSTER_HEIGHT + BODY_HEIGHT + lines * LINE_HEIGHT;
}

export function splitColumns<T extends { name?: string }>(items: T[]): { leftItems: T[]; rightItems: T[] } {
  const leftItems: T[] = [];
  const rightItems: T[] = [];
  let leftHeight = 0;
  let rightHeight = 0;
  for (const item of items) {
    const height = estimateCardHeight(item);
    if (leftHeight <= rightHeight) { leftItems.push(item); leftHeight += height; }
    else { rightItems.push(item); rightHeight += height; }
  }
  return { leftItems, rightItems };
}
