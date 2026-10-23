// 首页、收藏页双列卡片的显示字段：文字封面、截止倒计时、级别、推荐等级（2026-10 淘宝风格改版）。
// 不引用 wx，测试可以直接加载这个文件。
//
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

// ---- 卡片下方的信息行（2026-10，用户定：截止倒计时 + 赛事级别 + 推荐等级）----
const DAY_MS = 24 * 60 * 60 * 1000;
const REC_CLASS: Record<string, string> = { '强烈推荐':'r1', '值得参加':'r2', '适合练手':'r3', '高难挑战':'r4', '谨慎报名':'r5' };
const URGENT_DAYS = 7;

// 按北京时间的日历天数算“还剩几天”：截止当天是 0
function daysUntil(target: string, now: Date): number | null {
  const time = Date.parse(target);
  if (!Number.isFinite(time)) return null;
  const day = (value: number) => Math.floor((value + 8 * 60 * 60 * 1000) / DAY_MS);
  return day(time) - day(now.getTime());
}

export function deadlineOf(item: any, now = new Date()): { text: string; tone: '' | 'urgent' | 'muted' } {
  if (item.dataStatus === 'archived' || item.registrationStatus === '已截止') return { text:'已过报名日期', tone:'muted' };
  if (item.registrationStatus === '即将报名' && item.registrationStart) {
    const days = daysUntil(item.registrationStart, now);
    if (days !== null && days > 0) return { text:days === 1 ? '明天开始报名' : `${days} 天后开始报名`, tone:'' };
  }
  const days = item.registrationEnd ? daysUntil(item.registrationEnd, now) : null;
  if (days !== null && days >= 0) {
    if (days === 0) return { text:'今天截止', tone:'urgent' };
    if (days === 1) return { text:'明天截止', tone:'urgent' };
    return { text:`还剩 ${days} 天`, tone:days <= URGENT_DAYS ? 'urgent' : '' };
  }
  if (item.registrationEndNote) return { text:`截止 ${item.registrationEndNote}`, tone:'' };
  return { text:'报名时间待公布', tone:'muted' };
}

// 首页、收藏页卡片要的全部显示字段：封面 + 倒计时 + 级别 + 推荐等级
export function withCard<T extends { id?: string; name?: string; professions?: string[] }>(item: T, now = new Date()) {
  const any = item as any;
  const deadline = deadlineOf(any, now);
  return {
    ...withCover(item),
    deadlineText:deadline.text,
    deadlineTone:deadline.tone,
    levelTag:any.eventLevel && any.eventLevel !== '其他/未明确' ? String(any.eventLevel).replace('/区域级', '') : '',
    recClass:REC_CLASS[any.recommendationLevel] || '',
  };
}

// 首页“即将截止”：报名中、几天内截止的，按截止时间排，最多 limit 张
export function closingSoon(items: any[], { days = URGENT_DAYS, limit = 10, now = new Date() } = {}) {
  return items
    .filter(item => item.registrationStatus === '报名中' && item.dataStatus !== 'archived' && item.registrationEnd)
    .map(item => ({ item, left:daysUntil(item.registrationEnd, now) }))
    .filter(({ left }) => left !== null && left >= 0 && left <= days)
    .sort((a, b) => Date.parse(a.item.registrationEnd) - Date.parse(b.item.registrationEnd))
    .slice(0, limit)
    .map(({ item }) => withCard(item, now));
}
