// 操作记录 · 整理（纯计算）：每条写成一行——北京时间、做了什么、哪个比赛或届次、谁做的，详情用中文写清楚；再算翻页。
// 维护和回收站清理是程序自己做的，操作人写“系统”。没见过的动作把内容原样列出来，不丢。
const 北京时间 = 时间 => 时间 ? new Date(new Date(时间).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') : '';
const 对象类 = { competition: '比赛', edition: '届次' };
const 系统做的 = new Set(['维护比赛', '维护改正', '回收站清理']);
const 表名中文 = { competition: '比赛', edition: '届次', source: '来源', process_log: '处理记录' };
const 值 = v => (v == null || v === '' ? '空' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const 详情们 = {
  编辑比赛: (d, 名) => [`改了：${(d.改了 || []).map(f => 名(f)).join('、')}`],
  编辑届次: (d, 名) => [`改了：${(d.改了 || []).map(f => 名(f)).join('、')}`],
  改状态: d => [`状态：${值(d.从)} → ${值(d.改成)}`],
  标记删除比赛: d => [`连同 ${d.届次 ?? 0} 届`, d.不再收录 ? `以后不再收录${d.理由 ? `：${d.理由}` : ''}` : null],
  恢复比赛: d => [`连同 ${d.届次 ?? 0} 届`],
  回收站清理: d => [
    `${北京时间(d.标记时间)} 由 ${d.标记人 || '未知'} 删除`,
    d.连带 && Object.keys(d.连带).length ? `连带删除：${Object.entries(d.连带).map(([表, n]) => `${表名中文[表] || 表} ${n}`).join('、')}` : null,
    d.断开的下级比赛?.length ? `断开的下级比赛：${d.断开的下级比赛.join('、')}` : null,
  ],
  // 检查完成是检查项名称的列表，检查失败是 [{ name, error }]（旧的轮流维护写的，2026-11-12 已删；历史记录还在，照旧显示）
  维护比赛: d => {
    const 失败 = Array.isArray(d.检查失败) ? d.检查失败 : [];
    return [`检查完成 ${Array.isArray(d.检查完成) ? d.检查完成.length : 0} 项、失败 ${失败.length} 项${失败.length ? `（${失败.map(f => f.name).join('、')}）` : ''}`,
      `改正 ${d.改正 ?? 0} 处、转人工 ${d.转人工 ?? 0} 处`];
  },
  维护改正: (d, 名) => {
    const 新 = d.新值 && typeof d.新值 === 'object' && d.字段 in d.新值 ? d.新值[d.字段] : d.新值;
    return [`${名(d.字段)}（${d.字段}）：${值(d.原值)} → ${值(新)}`, d.依据 ? `依据：${d.依据}` : null];
  },
  新建比赛: () => [],
  新建届次: d => (d.比赛 ? [`属于比赛 ${d.比赛}`] : []),
  标记删除届次: () => [],
  恢复届次: () => [],
};
const 原样 = d => Object.entries(d || {}).map(([k, v]) => `${k}：${值(v)}`);

export function 整理(原始) {
  const 行们 = 原始.条目.map(e => {
    const d = e.detail || {};
    const 名 = 字段 => 原始.字段名?.[e.table_name]?.[字段] || 字段;
    const 写 = 详情们[e.action];
    return {
      id: e.id,
      时间: 北京时间(e.created_at),
      动作: e.action,
      对象: d.名称 || e.record_id || '',
      对象类: 对象类[e.table_name] || '',
      编号: e.record_id || '',
      操作人: d.操作人 || (系统做的.has(e.action) ? '系统' : ''),
      详情: (写 ? 写(d, 名) : 原样(d)).filter(Boolean),
    };
  });
  const 共几页 = Math.max(1, Math.ceil(原始.总数 / 原始.每页));
  return { 行们, 总数: 原始.总数, 页: 原始.页, 共几页, 有上一页: 原始.页 > 1, 有下一页: 原始.页 < 共几页, 类型: 原始.类型, 搜: 原始.搜, 类型们: 原始.类型们 || ['全部'] };
}
