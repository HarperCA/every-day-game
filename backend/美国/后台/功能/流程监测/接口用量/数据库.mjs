// 接口用量 · 取数据（美国服务器上跑）：最近几天各家接口的调用，从 AI 总管的用量库读（2026-11-02 接上）。
// 读取函数由后台的服务器在环境里给：环境.AI用量 = { report(从哪天, 到哪天), fixedFees(月份) }，即 AI 总管的 usage.report、usage.fixedFees；
// 没给就写明没接上。report 交回按 天 × 来源 × 接口 汇总的行：次数、成功、失败、token、费用（元；价格没填的是 null）。
//
//   取({ 天数 }, { AI用量, now })   天数：1、7、30、90，按北京时间算，含今天；月费取今天所在的月份
export const 天数们 = [1, 7, 30, 90];
const DAY_MS = 24 * 3600 * 1000;
const 北京日期 = t => new Date(t.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

export async function 取({ 天数 = 7 } = {}, { AI用量, now = () => new Date() } = {}) {
  天数 = Number(天数);
  if (!天数们.includes(天数)) throw new Error(`天数只能是 ${天数们.join('、')}`);
  const 现在 = now();
  const 从 = 北京日期(new Date(现在.getTime() - (天数 - 1) * DAY_MS));
  const 到 = 北京日期(现在);
  const 月份 = 到.slice(0, 7);
  if (!AI用量) return { 天数, 从, 到, 月份, 行们: [], 固定费用: [], 没接上: true };
  return { 天数, 从, 到, 月份, 行们: await AI用量.report(从, 到), 固定费用: await AI用量.fixedFees(月份), 没接上: false };
}
