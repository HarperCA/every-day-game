// 失败任务 · 取数据（美国服务器上跑）：只看，不重试、不标记（2026-11-01 用户定）。三个来源合在一页：
//   每晚流程            环境.每晚失败({ 天数, now })：最近几晚 run.db 里失败的模块和条目（pipeline/小数据库 的 读最近失败）
//   AI 返回的内容不能用   环境.AI问题(从哪天)：AI 总管用量库里调用方报告的问题（ai 的 usage.problemsSince）
//   维护                比赛库里“维护比赛”的记录，检查失败的每一项
// 前两个由后台的服务器在环境里给（这里只引用比赛库），没给就写明没接上。
// 同一来源、同一环节、同一原因的合成一组（维护每 5 分钟一次，没合的话一天几百条一样的），浏览器只拿合好的。
//
//   取({ 天数 }, { db, 每晚失败, AI问题, now })   天数：1、7、30、90（每晚的运行文件夹只留 90 天）
export const 天数们 = [1, 7, 30, 90];
const DAY_MS = 24 * 3600 * 1000;
const 北京日期 = t => new Date(t.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

function 维护的(db, 从何时) {
  const 名称 = new Map();
  const 比赛名 = id => {
    if (!名称.has(id)) 名称.set(id, db.get('competition', id, { 包括已删除: true })?.data?.name || id);
    return 名称.get(id);
  };
  return db.find('audit_log', { action: '维护比赛', created_at: { gte: 从何时 } }, { orderBy: '-created_at' })
    .flatMap(r => (Array.isArray(r.detail?.检查失败) ? r.detail.检查失败 : [])
      .map(f => ({ 来源: '维护', 时间: r.created_at, 环节: f.name, 原因: f.error || '', 对象: 比赛名(r.record_id), 网址: '' })));
}

// 时间新的在前，再按 来源|环节|原因 合并；对象按名称去重
function 合并(行们) {
  const 组 = new Map();
  for (const r of [...行们].sort((a, b) => (Date.parse(b.时间) || 0) - (Date.parse(a.时间) || 0))) {
    const 键 = `${r.来源}|${r.环节}|${r.原因}`;
    if (!组.has(键)) 组.set(键, { 来源: r.来源, 环节: r.环节, 原因: r.原因, 次数: 0, 最近: r.时间, 对象们: [] });
    const g = 组.get(键);
    g.次数 += 1;
    if (r.对象 && !g.对象们.some(o => o.名称 === r.对象)) g.对象们.push({ 名称: r.对象, 网址: r.网址 || '' });
  }
  return [...组.values()];
}

export async function 取({ 天数 = 7 } = {}, { db, 每晚失败, AI问题, now = () => new Date() }) {
  天数 = Number(天数);
  if (!天数们.includes(天数)) throw new Error(`天数只能是 ${天数们.join('、')}`);
  const 现在 = now();
  const 从哪天 = 北京日期(new Date(现在.getTime() - (天数 - 1) * DAY_MS));
  const 没接上 = [];
  const 行们 = [];

  if (typeof 每晚失败 === 'function') {
    for (const r of await 每晚失败({ 天数, now: 现在 })) {
      const 对象 = r.对象 === '整个模块' ? `${r.哪一晚} 那一晚（整个模块失败，${r.整晚停下 ? '整晚停下' : '跳过继续'}）` : r.对象;
      行们.push({ 来源: '每晚流程', 时间: r.时间, 环节: r.环节, 原因: r.原因, 对象, 网址: r.网址 });
    }
  } else 没接上.push('每晚流程');

  if (typeof AI问题 === 'function') {
    for (const p of await AI问题(从哪天)) {
      行们.push({ 来源: 'AI 返回的内容不能用', 时间: p.at, 环节: `${p.module || p.source} · ${p.purpose}`, 原因: p.reason,
        对象: p.run_id ? `${p.run_id} 那一晚` : p.source, 网址: '' });
    }
  } else 没接上.push('AI 返回的内容不能用');

  // 北京时间 从哪天 的 0 点
  行们.push(...维护的(db, new Date(Date.parse(`${从哪天}T00:00:00+08:00`)).toISOString()));
  return { 天数, 没接上, 组们: 合并(行们) };
}
