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

// 封面主标题用完整赛事名称，不删字（用户定）；角标是专业大类
export function coverOf(item: { id?: string; name?: string; professions?: string[] }) {
  const category = (item.professions || []).find(value => value && value !== '综合/不限专业') || '';
  const matched = TONE_BY_CATEGORY.find(([pattern]) => pattern.test(category));
  let hash = 0;
  for (const ch of String(item.id || item.name || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    coverTitle: String(item.name || '').trim(),
    coverKicker: category || '大学生竞赛',
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
