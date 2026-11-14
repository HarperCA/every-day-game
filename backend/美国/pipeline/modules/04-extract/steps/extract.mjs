// 第 2 步 抽取：先程序填，必要的四项（主办方、参赛对象或资格、赛制、报名截止）填不齐才交 DeepSeek（2026-11-01 用户定）。
//   1 程序填（程序填.mjs）：按“主办单位：××”这类固定写法填，依据就是那一行
//   2 填齐了：不调 DeepSeek，直接交回
//   3 没填齐：正文里找不到比赛名称的，多半是导航空壳，交回 page_is_boilerplate 让第 3 步重读，不调 DeepSeek
//   4 交 DeepSeek（经 AI 总管，用途 extract），提示词写明哪些项程序已经填了；回来的每一项逐字核对原文（原文核对.mjs），核不上的删掉记进 dropped
//   5 合并：程序填的优先，DeepSeek 只补程序没填上的
// 提示词搬自 adminData/competitionExtract.js 的 buildExtractPrompt（仓库 main 的版本，比线上服务器的新：作品提交截止只在交作品就是首次参赛时才算报名截止）。
//
// 交回 { ok: true, fields, dropped, missing, promptVersion, 程序填了, AI填了 }
//   或 { ok: false, status, reason }；status：page_is_boilerplate（交给重读）、ai_error（AI 出错）、ai_bad_response（交回的不是 JSON 对象，已报告问题）
import { 比赛身份 } from '../../../common/届次与赛道.mjs';
import { loadPrompt } from '../../../common/prompt.mjs';
import { LIST_FIELDS, REGISTRATION_ORGANIZATIONS, RECOGNITION_LEVELS, RECOGNITION_PATHS, REWARD_HIGHLIGHTS, SINGLE_FIELDS } from '../schema.mjs';
import { PAGE_TEXT_LIMIT, looksLikeContestPage, toStructuredText, verifyAgainstSource } from './原文核对.mjs';
import { 必要齐了, 程序填 } from './程序填.mjs';

export const 用途 = 'extract';
export const 提示词文件 = new URL('../prompt.md', import.meta.url);
const 中文名 = {
  competition_name: '比赛名称', organizer: '主办方', participants: '参赛对象', eligibility: '参赛资格', format_and_rules: '赛制', team_size: '队伍人数',
  registration_method: '报名方式', registration_organization: '报名组织方式', fees: '费用', registration_start: '报名开始', registration_end: '报名截止',
};

export async function extractFields({ item, text }, ctx) {
  const 程序 = 程序填(text);
  const { 赛道, 赛道键 } = 比赛身份(item.data?.name, item.data?.track_name);
  if (必要齐了(程序.fields) && !赛道 && !/赛道|专项赛/.test(text)) return { ok: true, fields: 程序.fields, dropped: [], missing: [], promptVersion: null, 程序填了: 程序.填了, AI填了: [] };

  const 名称 = String(item.data?.name || '');
  const 目标 = 赛道 && !名称.includes(赛道) ? 名称 + '（' + 赛道 + '）' : 名称;
  const 正文 = toStructuredText(text, PAGE_TEXT_LIMIT);
  if (!looksLikeContestPage(正文, 比赛身份(名称).名称)) return { ok: false, status: 'page_is_boilerplate', reason: '正文里找不到这场比赛的名称，多半是只有导航的空壳页' };

  const { version, text: 提示词 } = loadPrompt(提示词文件, {
    回报可选值: REWARD_HIGHLIGHTS.join('、'), 认可路径: RECOGNITION_PATHS.join('、'), 认可等级: RECOGNITION_LEVELS.join('、'),
    报名组织可选值: REGISTRATION_ORGANIZATIONS.join('、'), 已填: 程序.填了.map(f => 中文名[f] || f).join('、') || '无', 比赛名: 目标, 正文,
  });
  let data;
  try {
    ({ data } = await ctx.ai.chat({ purpose: 用途, messages: [{ role: 'user', content: 提示词 }], json: true, promptVersion: version, signal: ctx.signal }));
  } catch (error) {
    return { ok: false, status: 'ai_error', reason: `AI 出错：${String(error?.message || error).slice(0, 200)}` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    ctx.ai.报告问题({ purpose: 用途, promptVersion: version, 原因: `${item.key}：交回的不是 JSON 对象` });
    return { ok: false, status: 'ai_bad_response', reason: 'AI 交回的不是 JSON 对象' };
  }

  const 核对 = verifyAgainstSource(data, 正文);
  const 已核对赛道 = 比赛身份(核对.competition_name?.value, 核对.track_name?.value);
  if (赛道键 && 已核对赛道.赛道键 !== 赛道键) {
    return { ok: false, status: 'track_not_verified', reason: '正文未能核实候选对应的赛道：' + 赛道 };
  }
  const fields = {};
  const AI填了 = [];
  for (const 名 of SINGLE_FIELDS) {
    if (!已核对赛道.赛道键 && 程序.fields[名]) fields[名] = 程序.fields[名];
    else if (核对[名]) { fields[名] = 核对[名]; AI填了.push(名); }
  }
  for (const 名 of Object.keys(LIST_FIELDS)) {
    fields[名] = 核对[名] || [];
    if (fields[名].length) AI填了.push(名);
  }
  return { ok: true, fields, dropped: 核对.dropped, missing: 核对.missing, promptVersion: version, 程序填了: 程序.填了, AI填了 };
}
