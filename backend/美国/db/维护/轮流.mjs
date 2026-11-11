// 轮流维护：每天 9:00–18:00 每 5 分钟由定时器启动一次，每次维护一个比赛，依次进行（2026-11-01 用户定）。
//
//   挑下一个比赛(db, { now, 跳过 }) → 比赛编号 或 null
//     有待人工审核届次的比赛排最前（2026-11-06 用户定）；其次从没维护过的（同样按编号），再按上次维护时间从早到晚；7 天内维护过的、已删除的、跳过 里的不挑
//   维护一个比赛({ db, ai, web, checks, find, log, now, dryRun, 比赛编号 }) → { 比赛, 原因?, ...runMaintenance 的结果 }
//     没给 比赛编号 时自己挑；都在 7 天内维护过就什么都不做。做完记下比赛的 last_maintained_at，并留一条操作日志：
//     检查出错也照样标“维护过”，失败的检查写进日志，7 天后轮到再查（不然一项检查坏了，维护会一直卡在同一个比赛上）。
//     试跑不记时间、不留日志。失败不记（AI 审查用）：检查出错不写维护时间，额度用完、Codex 出错时不白白占掉 7 天，由批量维护决定停不停。
import { runMaintenance } from './index.mjs';

export const 间隔天数 = 7;

export function 挑下一个比赛(db, { now = new Date(), 跳过 = [] } = {}) {
  const 界线 = now.getTime() - 间隔天数 * 86400000;
  const 待审 = new Set(db.find('edition', { status: '待人工审核' }).map(e => e.competition_id));
  const 档 = c => (待审.has(c.key) ? 0 : 1);
  const 候选 = db.list('competition')
    .map(({ key, data }) => ({ key, at: data.last_maintained_at ? Date.parse(data.last_maintained_at) : null }))
    .filter(c => (c.at === null || c.at < 界线) && !跳过.includes(c.key))
    .sort((a, b) => 档(a) - 档(b) || (a.at ?? -Infinity) - (b.at ?? -Infinity) || a.key.localeCompare(b.key));
  return 候选[0]?.key ?? null;
}

export async function 维护一个比赛({ db, log, now = () => new Date(), dryRun = false, 比赛编号 = null, 失败不记 = false, ...其余 }) {
  const 比赛 = 比赛编号 || 挑下一个比赛(db, { now: now() });
  if (!比赛) {
    log.info(`没有要维护的比赛：都在 ${间隔天数} 天内维护过了`);
    return { 比赛: null, 原因: `都在 ${间隔天数} 天内维护过了` };
  }
  if (!db.get('competition', 比赛)) throw new Error(`比赛库里没有 ${比赛}（或已删除）`);
  log.info(`维护比赛 ${比赛}（${db.get('competition', 比赛).data.name}）`);
  const 结果 = await runMaintenance({ db, log, now, dryRun, 比赛编号: 比赛, ...其余 });
  if (!dryRun && !(失败不记 && 结果.检查.失败.length)) {
    const at = now().toISOString();
    db.transaction(tx => {
      const row = tx.get('competition', 比赛);
      tx.update('competition', 比赛, { last_maintained_at: at }, row.version);
      tx.insert('audit_log', `维护-${比赛}-${at}`, { created_at: at, action: '维护比赛', table_name: 'competition', record_id: 比赛,
        detail: { 检查完成: 结果.检查.完成, 检查失败: 结果.检查.失败, 改正: 结果.处理.改正, 转人工: 结果.处理.人工, 留着: 结果.处理.留着, 回收站: 结果.处理.回收站 ?? 0, ...(结果.留着?.length ? { 留着说明: 结果.留着 } : {}) } });
    });
  }
  return { 比赛, ...结果 };
}
