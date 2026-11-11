// 找官网 · 给 DeepSeek 的选择题（2026-11-07 用户定改法）：像人一样只搜比赛名，把前 10 条结果列出来，让 DeepSeek 选哪条是官网，都不是填 0。
// 带上记忆里的教训；只回序号和理由。
//   选择题(比赛, 目标, 候选, 节) → 文字      候选：搜索结果 [{ title, url, content, date, authority, website }]
export const 提问版本 = 'official-pick-v1';
const 摘要最长 = 200;

const 一条 = (r, i) => {
  const 附 = [r.website, r.date, r.authority != null ? `权威等级 ${r.authority}` : ''].filter(Boolean).join('，');
  const 摘要 = String(r.content || '').replace(/\s+/g, ' ').trim().slice(0, 摘要最长);
  return [`${i + 1}. ${r.title || '（没有标题）'}`, `   ${r.url}${附 ? `（${附}）` : ''}`, ...(摘要 ? [`   摘要：${摘要}`] : [])].join('\n');
};

export function 选择题(比赛, 目标, 候选, 节) {
  const 别名 = 比赛.aliases?.length ? `；别名：${比赛.aliases.join('、')}` : '';
  const 主办 = 比赛.organizer ? `；记录里的主办方：${比赛.organizer}` : '';
  const 哪届 = [目标?.年份 != null ? `${目标.年份} 年` : '', 目标?.届次 || ''].filter(Boolean).join('、');
  const 教训们 = 节?.教训 || [];
  return [
    `比赛：${比赛.name}${别名}${主办}。`,
    `下面是搜索「${比赛.name}」的前 ${候选.length} 条结果。哪一条是这场比赛的官方网站，或者组委会、主办单位发布这场比赛通知的页面？`,
    '学校转发、新闻、竞赛聚合站、百科、公众号都不算；名字相近的别的比赛也不算。',
    ...(哪届 ? [`有好几条都是官方的，优先选 ${哪届}这一届的通知；没有就选最新一届的。`] : []),
    ...(教训们.length ? ['往年的教训：', ...教训们.map(条 => `- ${条}`)] : []),
    '',
    ...候选.map(一条),
    '',
    '最后只回 JSON：{"选":序号,"理由":"一句话"}，都不是填 0。',
  ].join('\n');
}
