// 固定来源的抓取频率（2026-10-01，用户定）：不是百度搜索的、有固定网站或平台的来源（天池、辽宁平台），每 7 天才抓一次。
//
// 为什么：这些平台的赛事更新很慢，每晚抓一遍读到的几乎都是同一批，白占判重、读详情和抽取的额度。
// 百度搜索每晚的搜索词不一样（覆盖空白、新词试探、追溯），结果天天不同，所以仍然每晚跑。
//
// 记录：plans/source-schedule.json，{ 来源: { lastCrawledAt, runId } }，每次成功抓取之后写入。
// 判断：距离上次成功抓取满 everyDays 天才再抓；留 12 小时余量，免得定时器晚几秒就被推迟一整周。
// 手动指定了 --sources 的运行不受这个限制（你明确要抓就抓），也不会更新记录。
import fs from 'node:fs';
import path from 'node:path';

export const FIXED_SOURCE_INTERVAL_DAYS = 7;
const SLACK_MS = 12 * 3600 * 1000;
const DAY_MS = 86400000;

export function loadSchedule(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}

export function saveSchedule(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(temporary, file);
}

// 这个来源今天要不要抓。everyDays 为空表示每晚都抓（百度搜索）。
export function checkDue(state, source, everyDays, now = new Date()) {
  if (!everyDays) return { run:true, everyDays:0, reason:'每晚抓取' };
  const last = state?.[source]?.lastCrawledAt;
  const lastTime = last ? Date.parse(last) : NaN;
  if (!Number.isFinite(lastTime)) return { run:true, everyDays, lastCrawledAt:null, reason:'没有抓取记录，本轮抓取' };
  const dueAt = new Date(lastTime + everyDays * DAY_MS - SLACK_MS);
  const nextAt = new Date(lastTime + everyDays * DAY_MS);
  const daysSince = (now.getTime() - lastTime) / DAY_MS;
  if (now >= dueAt) return { run:true, everyDays, lastCrawledAt:last, nextDueAt:null, reason:`距上次抓取 ${daysSince.toFixed(1)} 天，已满 ${everyDays} 天，本轮抓取` };
  return { run:false, everyDays, lastCrawledAt:last, nextDueAt:nextAt.toISOString(), reason:`距上次抓取 ${daysSince.toFixed(1)} 天，每 ${everyDays} 天抓一次，本轮跳过` };
}

export function markCrawled(state, source, runId, now = new Date()) {
  return { ...state, [source]:{ lastCrawledAt:now.toISOString(), runId } };
}
