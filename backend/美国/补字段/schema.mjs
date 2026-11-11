// Codex 补字段每一轮要交回的格式（和 prompt.md 一致）。检查动作() 交回用不了的地方（null 表示合格）。
export const 动作们 = ['搜索', '读网页', '结论'];

export function 检查动作(data) {
  if (!data || typeof data !== 'object') return '没有交回 JSON 对象';
  if (!动作们.includes(data.动作)) return `动作「${data.动作}」不是 ${动作们.join('/')} 之一`;
  if (data.动作 === '搜索' && !String(data.搜索词 || '').trim()) return '搜索没给搜索词';
  if (data.动作 === '读网页' && !/^https?:\/\//.test(String(data.网址 || ''))) return `读网页的网址「${data.网址}」不对`;
  if (data.动作 === '结论') {
    const r = data.结论;
    if (!r || typeof r !== 'object') return '结论是空的';
    if (!Array.isArray(r.字段们)) return '结论里没有字段们列表';
    if (r.待公布 != null && !Array.isArray(r.待公布)) return '结论里的待公布不是列表';
    for (const 项 of [...r.字段们, ...(r.待公布 || [])]) if (!项 || typeof 项 !== 'object' || !项.字段 || !项.网址) return '字段们、待公布里每一项都要有 字段、网址';
  }
  return null;
}
