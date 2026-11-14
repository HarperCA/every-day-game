// 三项核验：读这条比赛的来源网页，经 AI 总管（用途 verify → Kimi）核对名称、报名开始和截止时间、报名网址，顺带判专业分类。
// 给总审核提供函数。搬自 adminData/competitionAiReview.js 的 runFieldVerification（提示词、三种日期状态）、
// intakeSchedule.js 的 applyFieldVerification（怎么改正、什么算没过）。读网页改用 ctx.web.读网页，最多读 3 个来源。
//
//   三项核验(记录, ctx, { 摘录 }) → { 通过, 原因, 记录（改正后、补上专业分类）, 来源们（核验过的官方来源，按来源表的字段）, 核验（Kimi 原样的回答） }
//
// 什么算过（2026-11-01 用户定：过了才入库）：
//   名称、报名网址：对；或不对但给了改正值（照改）
//   报名开始、截止：一致；原文没写（清空，落回“时间待公布”，不算错）；或不一致但给了有效的改正值（照改）
//   专业分类：有把握，且至少一类；来源性质：官方；至少一个来源读到了正文
// 来源正文一个都没读到时不调 AI，直接没过。调用出错抛给调用方；返回内容用不了先 ctx.ai.报告问题 再抛。
import { loadPrompt } from '../../../common/prompt.mjs';
import { 专业分类, 检查 } from './schema.mjs';

export { 专业分类 };
export const 用途 = 'verify';
export const 提示词文件 = new URL('./prompt.md', import.meta.url);
const 最多来源 = 3;
const 每个来源最多字 = 8000;
const 正文最少字 = 100;

const 有效日期 = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
const 记录摘要 = r => ({ name: r.name, track_name: r.track_name, organizer: r.organizer, participants: r.participants, eligibility: r.eligibility, format_and_rules: r.format_and_rules,
  registration_start: r.registration_start || null, registration_end: r.registration_end || null, registration_url: r.registration_url, sources: (r.sources || []).map(s => s.url) });

export async function 三项核验(记录, ctx, { 摘录 = '' } = {}) {
  const 网址们 = [...new Set((记录.sources || []).map(s => s.url).filter(u => /^https?:\/\//i.test(u || '')))].slice(0, 最多来源);
  const 读的 = await Promise.all(网址们.map(u => ctx.web.读网页(u, { signal: ctx.signal })));
  const 读到 = 读的.filter(p => ['成功', '正文太短'].includes(p.status) && String(p.text || '').length > 正文最少字);
  if (!读到.length) {
    return { 通过: false, 原因: `来源正文没读到（${读的.map(p => `${p.url}：${p.status}`).join('；') || '没有来源网址'}）`, 记录, 来源们: [], 核验: null };
  }

  const { version, text } = loadPrompt(提示词文件, {
    专业分类: 专业分类.join('、'),
    记录: JSON.stringify(记录摘要(记录)),
    来源: JSON.stringify(读到.map(p => ({ 网址: p.finalUrl || p.url, 标题: p.title, 正文: String(p.text).slice(0, 每个来源最多字) }))),
  });
  const { data } = await ctx.ai.chat({ purpose: 用途, json: true, promptVersion: version, signal: ctx.signal,
    messages: [{ role: 'system', content: '你是严谨的大学生竞赛数据核验助手。不得将推测写成事实，找不到依据就如实填 false 或留空。只输出 JSON，字段名必须和示例一致。' }, { role: 'user', content: text }] });
  const 问题 = 检查(data);
  if (问题) {
    ctx.ai.报告问题({ purpose: 用途, promptVersion: version, 原因: `${记录.name || ''}：${问题}` });
    throw new Error(`三项核验返回的内容用不了：${问题}`);
  }

  // 按规则改正、判过没过
  const 改后 = { ...记录 };
  const 没过 = [];
  const 支撑 = [];
  if (data.名称对不对) 支撑.push('name');
  else if (String(data.名称改正 || '').trim()) { 改后.name = data.名称改正.trim().slice(0, 200); 支撑.push('name'); }
  else 没过.push('名称和原文对不上，且给不出改正值');
  for (const [状态, 改正, 字段, 名] of [['报名开始状态', '报名开始改正', 'registration_start', '报名开始'], ['报名截止状态', '报名截止改正', 'registration_end', '报名截止']]) {
    if (data[状态] === '一致') 支撑.push(字段);
    else if (data[状态] === '原文没写') 改后[字段] = null;
    else if (有效日期(data[改正])) { 改后[字段] = data[改正]; 支撑.push(字段); }
    else 没过.push(`${名}时间和原文对不上，且给不出有效的改正值`);
  }
  改后.pending_announcement = !改后.registration_end;
  if (data.报名网址对不对) 支撑.push('registration_url');
  else if (/^https?:\/\//i.test(data.报名网址改正 || '')) { 改后.registration_url = data.报名网址改正; 支撑.push('registration_url'); }
  else 没过.push('报名网址和原文对不上，且给不出改正值');
  if (data.专业有把握 && data.专业分类.length) 改后.professions = [...new Set(data.专业分类)].slice(0, 5);
  else 没过.push('定不了专业分类');
  if (data.来源性质 !== '官方') 没过.push(`来源不是主办方或主管部门的官方原文（${data.来源性质}）`);

  if (没过.length) return { 通过: false, 原因: `${没过.join('；')}（${data.摘要 || ''}）`, 记录: 改后, 来源们: [], 核验: data };
  const at = ctx.now().toISOString();
  const 来源们 = 读到.map(p => ({
    url: p.url, final_url: p.finalUrl || p.url, source_type: 'organizer_notice', is_official: true, validity_status: 'valid',
    title: p.title || '', content_summary: data.摘要 || '', evidence_excerpt: (摘录 || String(p.text).slice(0, 300)).slice(0, 2000),
    review_reason: `AI 三项核验通过：${data.摘要 || ''}`, supports_fields: 支撑, last_verified_at: at,
  }));
  return { 通过: true, 原因: data.摘要 || '三项核验通过', 记录: 改后, 来源们, 核验: data };
}
