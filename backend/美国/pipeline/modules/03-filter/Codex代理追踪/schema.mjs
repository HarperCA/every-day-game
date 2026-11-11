// Codex 每一轮要交回的格式（和 prompt.md 一致）。检查动作() 交回用不了的地方（null 表示合格）；
// 有问题就报告给 AI 总管并截断流程。
export const 动作们 = ['搜索', '读网页', '结论'];
export const 结果们 = ['找到官方来源', '不是比赛', '只是赛区或校内选拔', '找不到官方来源', '读不出内容'];

export function 检查动作(data) {
  if (!data || typeof data !== 'object') return '没有交回 JSON 对象';
  if (!动作们.includes(data.动作)) return `动作「${data.动作}」不是 ${动作们.join('/')} 之一`;
  if (data.动作 === '搜索' && !String(data.搜索词 || '').trim()) return '搜索没给搜索词';
  if (data.动作 === '读网页' && !/^https?:\/\//.test(String(data.网址 || ''))) return `读网页的网址「${data.网址}」不对`;
  if (data.动作 === '结论') {
    const r = data.结论;
    if (!r || typeof r !== 'object') return '结论是空的';
    if (!结果们.includes(r.结果)) return `结论的结果「${r.结果}」不是 ${结果们.join('/')} 之一`;
    if (!Array.isArray(r.官方来源)) return '结论里没有官方来源列表';
    if (r.结果 === '找到官方来源' && !r.官方来源.length) return '结果是找到官方来源，但官方来源是空的';
  }
  return null;
}
