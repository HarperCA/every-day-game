// 访问异常 · 取数据（美国服务器上跑）：读北京同步到美国的报错日志、加载统计（用户副本，沟通/用户数据同步，2026-11-02）。
//   取({}, { 用户副本库, now }) → { issues, stats, 现在, 接好了 }   没配用户副本时 接好了: false，界面显示占位
import { 用户副本 } from '../../../../db/index.mjs';

const 来源 = '北京同步来的报错日志（用户副本的 client_issues、client_stats）';

export async function 取(参数, { 用户副本库, now = () => new Date() } = {}) {
  if (!用户副本库) return { 条目: [], 来源, 接好了: false };
  return {
    issues: 用户副本.列出(用户副本库, 'client_issues'),
    stats: 用户副本.列出(用户副本库, 'client_stats'),
    现在: now().toISOString(), 来源, 接好了: true,
  };
}
