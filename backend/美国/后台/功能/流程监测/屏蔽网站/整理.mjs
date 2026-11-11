// 屏蔽网站 · 整理（纯计算）：时间写北京时间，出现的晚上只留日期；已屏蔽的后台确认在前、内置在后；刚做的操作给一句提示。
const 北京 = 时间 => (时间 ? new Date(new Date(时间).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—');
const 日期 = id => (id ? String(id).slice(0, 10) : '—');
const 提示们 = {
  block: h => `已屏蔽 ${h}，下一次搜索起生效`,
  dismiss: h => `${h} 不屏蔽，之后的统计不再建议`,
  unblock: h => `已取消屏蔽 ${h}，下一次搜索起生效`,
  restore: h => `${h} 已恢复，下一次统计还可能再建议`,
};

export function 整理(原始) {
  return {
    统计说明: 原始.generatedAt
      ? `统计于 ${北京(原始.generatedAt)}：近 ${原始.windowDays} 天 ${原始.runs} 晚的搜索结果里，出现 ${原始.minRefs} 次以上、一次都没被放行去读详情、也没追溯出官方来源的网站。学校网站（edu.cn）和库里比赛的来源网站不列。`
      : '还没有统计过，每周一 09:00 自动统计。',
    建议们: 原始.suggestions.map(x => ({ host: x.host, 次数: x.refs, 期间: `${日期(x.firstSeen)} ～ ${日期(x.lastSeen)}`, 情况: x.reason, 例子: x.samples || [] })),
    已屏蔽们: [
      ...原始.blocked.map(x => ({ host: x.host, 来源: '后台确认', 时间: 北京(x.decidedAt), 原因: x.reason || '—', 能取消: true })),
      ...原始.builtin.map(x => ({ host: x.host, 来源: '内置', 时间: '', 原因: x.reason, 能取消: false })),
    ],
    内置几个: 原始.builtin.length,
    确认几个: 原始.blocked.length,
    不屏蔽们: 原始.dismissed.map(x => ({ host: x.host, 时间: 北京(x.decidedAt), 当时次数: x.refs ?? null })),
    提示: 原始.结果 ? 提示们[原始.结果.decision]?.(原始.结果.host) || '' : '',
  };
}
