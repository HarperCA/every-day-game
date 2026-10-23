// 首页双列瀑布流：把卡片按估算高度分到左右两列，哪列矮就放哪列（2026-10 淘宝风格改版）。
// 不引用 wx，测试可以直接加载这个文件。

export const POSTER_PLACEHOLDER = '/assets/poster-placeholder.svg';

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
