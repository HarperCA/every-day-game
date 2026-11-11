// AI 审查批量跑（2026-11-05、11-06 用户定）：定时器约每 5 小时启动一次，每次 100 个比赛；后台多选的排进队列，定时器每 2 分钟看一眼。
//   先跑队列（不占上限、不看 7 天），再按 挑下一个比赛（待人工审核的优先）；只跑“核对原文”这一项检查。
//   检查失败不记维护时间，这一批不再试它，后台留一条“维护失败”；额度用完马上停，连续失败 3 个也停；每晚流程开始了也停。
//
//   批量维护({ db, ai, web, log, now, 上限, 只队列, 该停, 续锁, dryRun }) → { 跑了, 手动, 自动, 失败, 停因 }
//     只队列：队列空了就退出（后台入口的定时器用）。试跑不碰队列。
//   额度用完停 2 小时、同一个比赛失败后退避（2026-11-07 用户定，见 额度和退避.mjs）。试跑不看也不写。
import { randomUUID } from 'node:crypto';
import { 维护队列, 审核进度 } from '../index.mjs';
import { 挑下一个比赛, 维护一个比赛 } from './轮流.mjs';
import { 写暂停, 清失败, 清暂停, 生效暂停, 记失败, 退避中的比赛 } from './额度和退避.mjs';

export const AI审查检查项 = '核对原文';
export const 每批上限 = 100;
export const 连续失败上限 = 3;

export async function 批量维护({ db, ai, web, log, now = () => new Date(), 上限 = 每批上限, 只队列 = false, 该停 = () => false, 续锁 = () => {}, dryRun = false, 维护 = 维护一个比赛 }) {
  const 试过 = new Set();
  const 统计 = { 跑了: 0, 手动: 0, 自动: 0, 失败: 0, 停因: '' };
  let 连续 = 0;
  let 有成功 = false;
  if (!dryRun) {
    const 暂停 = 生效暂停(db, now());
    if (暂停) {
      统计.停因 = `Codex 额度用完，暂停到 ${暂停.pausedUntil}`;
      log.info(`AI 审查：这一轮不跑；${统计.停因}`);
      return 统计;
    }
  }
  for (;;) {
    if (该停()) { 统计.停因 = '每晚流程开始了，这一批停下'; break; }
    const at = now().toISOString();
    const 手动 = dryRun ? null : 维护队列.领下一个(db, { at, 跳过: [...试过] });
    let 比赛 = 手动;
    if (!比赛) {
      if (只队列 || 统计.自动 >= 上限) break;
      比赛 = 挑下一个比赛(db, { now: now(), 跳过: [...试过, ...(dryRun ? [] : 退避中的比赛(db, now()))] });
      if (!比赛) break;
      统计.自动 += 1;
    } else 统计.手动 += 1;
    试过.add(比赛);
    续锁();
    统计.跑了 += 1;
    let 进度;
    const 记录进度 = fn => {
      try { fn(); } catch (error) {
        进度 = null;
        log.warn('记录审核进度失败：' + (error?.message || error));
      }
    };
    if (!dryRun) 记录进度(() => { 进度 = 审核进度.开始(db, 比赛, { 手动, now }); });
    const 报告进度 = (阶段, 详情) => 记录进度(() => 进度?.更新(阶段, 详情));
    const 结束进度 = (状态, 结果) => 记录进度(() => 进度?.结束(状态, 结果));
    let 结果;
    try {
      结果 = await 维护({ db, ai, web, log, now, dryRun, 比赛编号: 比赛, only: [AI审查检查项], 失败不记: true, 报告进度 });
    } catch (error) {
      结果 = { 检查: { 失败: [{ name: AI审查检查项, error: String(error?.message || error), kind: error?.kind }] } };
    }
    const 失败 = 结果.检查?.失败?.[0];
    if (!失败) {
      连续 = 0;
      有成功 = true;
      if (!dryRun) 清失败(db, 比赛);
      if (手动) 维护队列.完成(db, 比赛, { at: now().toISOString() });
      if (结果.commit?.error) 结束进度('审核失败', { 说明: '保存审核结果失败' });
      else 结束进度('审核完成', 结果.处理 ?? null);
      continue;
    }
    统计.失败 += 1;
    if (失败.kind !== '网页读不到') 连续 += 1;   // 网站的问题，不是 Codex 坏了，不用停这一批
    log.warn(`比赛 ${比赛} 维护失败：${失败.error}`);
    if (!dryRun) db.insert('audit_log', randomUUID(), { created_at: now().toISOString(), action: '维护失败', table_name: 'competition', record_id: 比赛, detail: { 错误: 失败.error, 种类: 失败.kind ?? null } });
    if (失败.kind === '额度用完') {
      if (手动) 维护队列.放回(db, 比赛, { at: now().toISOString() });
      if (!dryRun) 写暂停(db, 失败.error, now());
      结束进度('等待重试', { 说明: '审核额度不足' });
      统计.停因 = 'Codex 额度用完，这一批停下，暂停 2 小时';
      break;
    }
    if (!dryRun) 记失败(db, 比赛, 失败.error, now());
    结束进度('审核失败', { 说明: 失败.kind === '网页读不到' ? '官方网页读取失败' : '审核执行失败，详情见失败任务' });
    if (手动) 维护队列.完成(db, 比赛, { at: now().toISOString() });
    if (连续 >= 连续失败上限) { 统计.停因 = `连续 ${连续} 个比赛失败，这一批停下`; break; }
  }
  if (有成功 && !dryRun) 清暂停(db, now());
  log.info(`AI 审查：跑了 ${统计.跑了} 个（手动 ${统计.手动}，自动 ${统计.自动}），失败 ${统计.失败}${统计.停因 ? `；${统计.停因}` : ''}`);
  return 统计;
}
