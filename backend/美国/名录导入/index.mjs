// 名录导入（2026-11-04 用户定）：把 2026-10-26 复判“可以入库”、2026-10-27 来源核查站得住的比赛写进比赛库，全部待人工审核。
// 只用这一次；数据没审过，所以不公开（公开比赛同步、赛事助手只读已发布、已归档）。说明见 README.md。
//
//   解析CSV(文本) → [{ 列名: 值 }]
//   排计划({ 行们, 核查们, 现有比赛们, 批次, at }) → { 比赛们, 届次们, 来源们, 跳过: [{ 源行号, 名称, 原因 }] }   纯计算
//   排补充计划({ 行们, 核查们, 已导入行号, 现有比赛们, 现有届次们, 不再收录们, 批次, at }) → 同上   2026-11-06：11-04 补查版剩下的，来源核查没过的也写，理由写清楚；库里有比赛没这一年的挂到已有比赛下
//   写入(db, 计划, { 批次, at }) → { 比赛, 届次, 来源 }     一个事务，出错整批撤回；同一批次写过就拒绝
//   撤回(db, { 批次, at }) → { 比赛, 届次, 来源, 留下 }      只删还在待人工审核的；已被人发布、归档的留下并报告
import { randomUUID } from 'node:crypto';
import { 规范名称 } from '../pipeline/common/规范名称.mjs';

const 站得住 = ['核实', '大部分核实'];
const 单独排除 = { 74: '用 2022 年学校转载的旧规则证明 2026 年资格，要单独处理', 1319: '缺主办方，要单独处理' };

const 级别们 = ['国际级', '国家级', '省级/区域级', '其他/未明确'];
const 举办情况 = ['长期举办', '首届', '不定期', '疑似停办', '已停办', '暂未明确'];
const 奖金分档 = ['无现金奖励', '万元以下', '1万-10万', '10万-50万', '50万以上', '暂未公布'];
const 非现金回报 = ['保研考研加分', '实习或直通面试', '就业绿色通道', '创业扶持', '国际交流', '证书荣誉', '实物奖品', '现金奖金'];
const 规模单位 = ['队', '人', '暂未公布'];
const 规模分档 = ['千人以下', '千人-1万', '1万-10万', '10万以上', '暂未公布'];
const 核验结果 = ['unchecked', 'valid', 'valid_auxiliary', 'valid_as_lead', 'invalid', 'content_unavailable'];
const 时间列 = { registration_start: ['schedule.registration_start', '报名开始'], registration_end: ['schedule.registration_end', '报名截止'], competition_start: ['schedule.competition_start', '比赛开始'], competition_end: ['schedule.competition_end', '比赛结束'] };

export function 解析CSV(文本) {
  const 行们 = [];
  let 行 = [], 格 = '', 引号里 = false;
  const 内容 = 文本.replace(/^﻿/, '');
  for (let i = 0; i < 内容.length; i += 1) {
    const 字 = 内容[i];
    if (引号里) {
      if (字 === '"' && 内容[i + 1] === '"') { 格 += '"'; i += 1; } else if (字 === '"') 引号里 = false; else 格 += 字;
    } else if (字 === '"') 引号里 = true;
    else if (字 === ',') { 行.push(格); 格 = ''; } else if (字 === '\n') { 行.push(格.replace(/\r$/, '')); 行们.push(行); 行 = []; 格 = ''; } else 格 += 字;
  }
  if (格 || 行.length) { 行.push(格); 行们.push(行); }
  const [表头, ...其余] = 行们;
  return 其余.map(值们 => Object.fromEntries(表头.map((列, i) => [列, 值们[i] ?? ''])));
}

const 拆 = 文字 => String(文字 || '').split(/[；;\n]/).map(x => x.trim()).filter(Boolean);
const 是网址 = 值 => { try { return /^https?:$/.test(new URL(值).protocol) && 值.length <= 1000; } catch { return false; } };
const 截 = (文字, 最长) => String(文字 || '').trim().slice(0, 最长);
const 只留有值 = 对象 => Object.fromEntries(Object.entries(对象).filter(([, 值]) => 值 !== '' && 值 != null && !(Array.isArray(值) && !值.length)));
const 当日 = 日期 => (/^\d{4}-\d{2}-\d{2}$/.test(日期 || '') ? `${日期}T00:00:00+08:00` : null);
const 年份起点 = 年 => Number(String(年 || '').slice(0, 4)) || 0;

const 数字 = '零一二三四五六七八九';
function 中文数(n) {
  if (n < 10) return 数字[n];
  if (n < 20) return `十${n % 10 ? 数字[n % 10] : ''}`;
  if (n < 100) return `${数字[Math.floor(n / 10)]}十${n % 10 ? 数字[n % 10] : ''}`;
  return String(n);
}
const 原文届次 = 值 => (/^\d+$/.test(String(值 || '')) ? `第${中文数(Number(值))}届` : 截(值, 40));

function 整理时间(行, 未写入) {
  const 结果 = {};
  const 说明们 = 行['schedule.time_note'] ? [行['schedule.time_note']] : [];
  for (const [字段, [列, 名]] of Object.entries(时间列)) {
    const 值 = 行[列];
    if (!值) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(值) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(值)) { 结果[字段] = 值; continue; }
    if (/^\d{4}-\d{2}-\d{2}T/.test(值)) 结果[字段] = 值.slice(0, 10); else 未写入[列] = 值;
    说明们.push(`${名}原文：${值}`);   // 原文没写时区，不替它补
  }
  return { ...结果, time_note: 截(说明们.join('；'), 2000) };
}

function 整理来源(行, 核查, 届次id) {
  const 打不开 = new Set(String(核查.打不开的网址 || '').match(/https?:\/\/\S+/g) || []);
  const 摘录们 = new Map();
  for (const 一行 of String(行.证据摘录 || '').split('\n')) {
    const 对上 = 一行.match(/^\[([^\]]+)\]\s*(?:摘录[:：])?\s*(.*?)\s*（(https?:\/\/[^）]+)）\s*$/);
    if (!对上) continue;
    const 已有 = 摘录们.get(对上[3]) || { 字段们: new Set(), 原文们: [] };
    已有.字段们.add(对上[1]); 已有.原文们.push(对上[2]);
    摘录们.set(对上[3], 已有);
  }
  const 见过 = new Set();
  const 来源们 = [];
  for (const 一行 of String(行.官方来源 || '').split('\n')) {
    const 段们 = 一行.split(' | ').map(x => x.trim());
    const 网址位 = 段们.findIndex(是网址);
    if (网址位 < 0 || 见过.has(段们[网址位])) continue;
    const url = 段们[网址位];
    见过.add(url);
    const 取 = 前缀 => 段们.slice(网址位 + 1).find(x => x.startsWith(前缀))?.slice(前缀.length).trim() || '';
    const 状态 = 取('状态 ');
    const 摘录 = 摘录们.get(url);
    来源们.push({
      id: `source-registry-${行.源行号}-${来源们.length + 1}`,
      data: 只留有值({
        edition_id: 届次id, url, title: 截(段们.slice(0, 网址位).join(' | '), 200), source_type: 取('类型 ') || '未标',
        is_official: 段们.slice(网址位 + 1).includes('官方'),
        validity_status: 打不开.has(url) ? 'content_unavailable' : 核验结果.includes(状态) ? 状态 : 'unchecked',
        review_reason: 核验结果.includes(状态) ? '' : 截(状态, 2000),
        supports_fields: 摘录 ? [...摘录.字段们] : [], evidence_excerpt: 摘录 ? 截(摘录.原文们.join('\n'), 20000) : '',
        last_verified_at: 当日(取('核验 ')),
      }),
    });
  }
  return 来源们;
}

function 整理届次(行, 核查, { 批次, at, 比赛id, 顺序, 来历 = null }) {
  const 未写入 = {};
  const 只认 = (列, 可选值) => { if (!行[列]) return ''; if (可选值.includes(行[列])) return 行[列]; 未写入[列] = 行[列]; return ''; };
  const 整数 = 列 => { if (!行[列]) return ''; if (/^\d+$/.test(行[列])) return Number(行[列]); 未写入[列] = 行[列]; return ''; };
  const 回报们 = 拆(行.rewardHighlights);
  if (回报们.some(x => !非现金回报.includes(x))) 未写入.rewardHighlights = 行.rewardHighlights;
  const 网址 = 列 => { if (!行[列]) return ''; if (是网址(行[列])) return 行[列]; 未写入[列] = 行[列]; return ''; };
  const data = 只留有值({
    competition_id: 比赛id, ordinal: 顺序, edition_name: 截(行.editionName || 行.name, 200), edition_year: 截(行.editionYear, 20), edition_ordinal: 原文届次(行.editionOrdinal),
    level: 级别们.includes(行.eventLevel) ? 行.eventLevel : '其他/未明确', organizer: 截(行.organizer, 200),
    participants: 截(行.participants, 2000), eligibility: 截(行.eligibility, 2000), format_and_rules: 截(行.formatAndRules, 20000),
    participation_format: 行.participationFormat, team_size: 截(行.teamSize, 200), team_size_category: 行.teamSizeCategory,
    registration_method: 截(行.registrationMethod, 2000), registration_organization: 行.registrationOrganization, registration_url: 网址('registrationUrl'),
    fees: 截(行.fees, 2000), fee_type: 行.feeType, pending_announcement: 行['schedule.pending_announcement'] === '是',
    ...整理时间(行, 未写入),
    track_name: 截(行['track.name'], 200), track_scope_note: 截(行['track.scope_note'], 200),
    reward_amount: 整数('rewardAmount'), reward_tier: 只认('rewardTier', 奖金分档), reward_highlights: 回报们.filter(x => 非现金回报.includes(x)), rewards: 截(行.rewards, 2000),
    participant_count: 整数('participantCount'), participant_unit: 只认('participantUnit', 规模单位), scale_tier: 只认('scaleTier', 规模分档), participant_scale: 截(行.participantScale, 200),
    status: '待人工审核', status_at: at,
    status_reason: [...(来历 || [`名录导入（${批次}）：2026-10-26 复判判为可以入库，未经人工审核`, `2026-10-27 来源网页核查：${核查.核查结论}`]), `结论类型：${行.结论类型}`, 行.尚缺发布字段 ? `发布前还缺：${行.尚缺发布字段.replace(/\s*\n\s*/g, '；')}` : ''].filter(Boolean),
    last_verified_at: 当日(行.lastVerifiedAt), discovery: { 路线: '比赛名录', 批次, 源行号: 行.源行号 }, discovery_notice_url: 网址('discoveryNoticeUrl'),
    created_by: 批次, updated_by: 批次,
  });
  data.legacy = {
    名录导入: 只留有值({
      批次, 源行号: 行.源行号, 源比赛名: 行['源：比赛名'], 结论类型: 行.结论类型, 结论原因: 行.结论原因, 核查结论: 核查.核查结论, 打不开的网址: 核查.打不开的网址,
      证据摘录: 行.证据摘录, 尚缺发布字段: 行.尚缺发布字段, 缺项与已查来源: 行.缺项与已查来源, 纠正记录: 行.纠正记录, 备注: 行.备注, qualityIssues: 行.qualityIssues,
      原专业表述: 行.原专业表述, lifecycle: 行.lifecycle, recognition: 行.recognition, 原文复核: 行.原文复核, 未写入: Object.keys(未写入).length ? 未写入 : null,
    }),
  };
  return data;
}

function 整理比赛(行, 比赛id, 全部别名) {
  const 级别 = 级别们.includes(行.eventLevel) ? 行.eventLevel : '其他/未明确';
  const 地区 = !['国家级', '国际级'].includes(级别) && 行.region.length <= 20 ? 行.region : '';
  return {
    id: 比赛id,
    data: 只留有值({
      name: 截(行.name, 200), aliases: [...new Set(全部别名)].filter(x => x !== 行.name), level: 级别, organizer: 截(行.organizer, 200), region: 地区,
      professions: 拆(行.professions), objective_tags: 拆(行.objectiveTags), lifecycle: 举办情况.includes(行.lifecycle) ? 行.lifecycle : '',
    }),
  };
}

export function 排计划({ 行们, 核查们, 现有比赛们 = [], 批次, at }) {
  const 核查表 = new Map(核查们.map(x => [String(x.源行号), x]));
  const 库里 = new Map();
  for (const c of 现有比赛们) for (const 名 of [c.name, ...(c.aliases || [])]) { const 键 = 规范名称(名); if (键 && !库里.has(键)) 库里.set(键, c.id); }
  const 跳过 = [];
  const 跳 = (行, 原因) => 跳过.push({ 源行号: String(行.源行号), 名称: 行.name || 行['源：比赛名'], 原因 });

  const 留下 = [];
  for (const 行 of 行们) {
    const 核查 = 核查表.get(String(行.源行号));
    if (行.最终分类 !== '可以入库') { 跳(行, '不在可以入库清单'); continue; }
    if (单独排除[行.源行号]) { 跳(行, 单独排除[行.源行号]); continue; }
    if (!核查) { 跳(行, '没有核查结果'); continue; }
    if (!站得住.includes(核查.核查结论)) { 跳(行, `核查结论：${核查.核查结论}`); continue; }
    if (String(行.关联记录 || '').startsWith('关联库内')) { 跳(行, 行.关联记录); continue; }
    const 同名库里 = [行.name, ...拆(行.aliases)].map(规范名称).map(键 => 库里.get(键)).find(Boolean);
    if (同名库里) { 跳(行, `库里已有 ${同名库里}`); continue; }
    const 来源数 = 整理来源(行, 核查, 'x').length;
    if (!来源数) { 跳(行, '没有可用的来源网址'); continue; }
    留下.push({ 行, 核查, 来源数 });
  }

  // 同名同年算同一届（和 06 入库的判断一致）：留来源多的，一样多留行号小的
  const 同届 = new Map();
  for (const 条 of 留下) {
    const 键 = `${规范名称(条.行.name)}|${条.行.editionYear}`;
    if (!同届.has(键)) 同届.set(键, []);
    同届.get(键).push(条);
  }
  const 同名 = new Map();
  for (const 组 of 同届.values()) {
    const [留, ...多的] = [...组].sort((a, b) => b.来源数 - a.来源数 || Number(a.行.源行号) - Number(b.行.源行号));
    for (const 条 of 多的) 跳(条.行, `和第 ${留.行.源行号} 行同名同年，留来源多的`);
    const 键 = 规范名称(留.行.name);
    if (!同名.has(键)) 同名.set(键, []);
    同名.get(键).push(留);
  }

  const 比赛们 = [], 届次们 = [], 来源们 = [];
  for (const 组 of 同名.values()) {
    const 排好 = [...组].sort((a, b) => 年份起点(a.行.editionYear) - 年份起点(b.行.editionYear) || Number(a.行.源行号) - Number(b.行.源行号));
    const 比赛id = `event-registry-${Math.min(...组.map(x => Number(x.行.源行号)))}`;
    比赛们.push(整理比赛(排好.at(-1).行, 比赛id, 排好.flatMap(x => 拆(x.行.aliases))));
    排好.forEach(({ 行, 核查 }, i) => {
      const id = `edition-registry-${行.源行号}`;
      届次们.push({ id, data: 整理届次(行, 核查, { 批次, at, 比赛id, 顺序: i + 1 }) });
      来源们.push(...整理来源(行, 核查, id));
    });
  }
  届次们.sort((a, b) => Number(a.data.legacy.名录导入.源行号) - Number(b.data.legacy.名录导入.源行号));
  return { 比赛们, 届次们, 来源们, 跳过 };
}

const 年份们 = 文字 => String(文字 || '').match(/(19|20)\d{2}/g)?.map(Number) || [];
const 单独说明 = { 74: '资格依据是 2022 年学校转载的旧规则，要单独核', 1319: '缺主办方，要单独核' };

export function 排补充计划({ 行们, 核查们 = [], 已导入行号 = [], 现有比赛们 = [], 现有届次们 = [], 不再收录们 = [], 批次, at }) {
  const 核查表 = new Map(核查们.map(x => [String(x.源行号), x]));
  const 已导入 = new Set(已导入行号.map(String));
  const 按名 = new Map();
  const 记名 = (名们, 项) => { for (const 名 of 名们) { const 键 = 规范名称(名); if (键 && !按名.has(键)) 按名.set(键, 项); } };
  for (const c of 不再收录们) 记名([c.name, ...(c.aliases || [])], { 不再收录: true });
  for (const c of 现有比赛们) 记名([c.name, ...(c.aliases || [])], { id: c.id, 在回收站: Boolean(c.deleted_at) });
  const 届次表 = new Map();
  const 届次归 = id => { if (!届次表.has(id)) 届次表.set(id, []); return 届次表.get(id); };
  for (const e of 现有届次们) 届次归(e.competition_id).push({ ordinal: e.ordinal, 年们: 年份们(e.edition_year) });

  const 跳过 = [];
  const 跳 = (行, 原因) => 跳过.push({ 源行号: String(行.源行号), 名称: 行.name || 行['源：比赛名'], 原因 });
  const 比赛们 = [], 新比赛 = new Map(), 要写 = [];
  for (const 行 of 行们) {
    if (已导入.has(String(行.源行号))) continue;
    if (行.最终分类 !== '可以入库') { 跳(行, '不在可以入库清单'); continue; }
    if (String(行.关联记录 || '').startsWith('关联库内')) { 跳(行, 行.关联记录); continue; }
    if (!整理来源(行, {}, 'x').length) { 跳(行, '没有可用的来源网址'); continue; }
    const 名们 = [行.name, ...拆(行.aliases)];
    let 比赛 = 名们.map(规范名称).map(键 => 按名.get(键)).find(Boolean);
    if (比赛?.不再收录) { 跳(行, '后台勾了不再收录'); continue; }
    if (比赛?.在回收站) { 跳(行, `比赛在回收站 ${比赛.id}`); continue; }
    const 年们 = 年份们(行.editionYear);
    if (比赛 && 届次归(比赛.id).some(e => e.年们.some(年 => 年们.includes(年)))) { 跳(行, `库里已有这一年 ${比赛.id}`); continue; }
    if (!比赛) {
      比赛 = { id: `event-registry-${行.源行号}` };
      新比赛.set(比赛.id, []);
      记名(名们, 比赛);
    }
    新比赛.get(比赛.id)?.push(行);
    届次归(比赛.id).push({ ordinal: null, 年们 });
    要写.push({ 行, 比赛id: 比赛.id });
  }
  // 顺序：新比赛按年份从 1 排；已有比赛新的接在最后，旧的排最前（UNIQUE (competition_id, ordinal)，已有届次不重排）
  const 顺序们 = new Map();
  for (const 项 of [...要写].sort((a, b) => 年份起点(a.行.editionYear) - 年份起点(b.行.editionYear) || Number(a.行.源行号) - Number(b.行.源行号))) {
    const 已有 = 届次归(项.比赛id).filter(e => e.ordinal != null);
    const 最大年 = Math.max(0, ...已有.flatMap(e => e.年们));
    const 比全部新 = !已有.length || Math.max(0, ...年份们(项.行.editionYear)) > 最大年;
    const 序 = !已有.length ? 1 : 比全部新 ? Math.max(...已有.map(e => e.ordinal)) + 1 : Math.min(...已有.map(e => e.ordinal)) - 1;
    顺序们.set(项.行.源行号, 序);
    const 占位 = 届次归(项.比赛id).find(e => e.ordinal == null && e.年们.join() === 年份们(项.行.editionYear).join());
    占位.ordinal = 序;
  }
  for (const [id, 组] of 新比赛) {
    const 排好 = [...组].sort((a, b) => 年份起点(a.editionYear) - 年份起点(b.editionYear) || Number(a.源行号) - Number(b.源行号));
    比赛们.push(整理比赛(排好.at(-1), id, 排好.flatMap(x => 拆(x.aliases))));
  }
  const 届次们 = [], 来源们 = [];
  for (const { 行, 比赛id } of 要写) {
    const 查 = 核查表.get(String(行.源行号));
    const 来历 = [`名录导入（${批次}）：2026-11-04 补查判为可以入库，未经人工审核`,
      查 ? `2026-10-27 来源网页核查：${查.核查结论}` : '没做过来源网页核查（11-04 补查才转入可以入库）',
      ...(单独说明[行.源行号] ? [单独说明[行.源行号]] : [])];
    const id = `edition-registry-${行.源行号}`;
    届次们.push({ id, data: 整理届次(行, 查 || { 核查结论: '没做过' }, { 批次, at, 比赛id, 顺序: 顺序们.get(行.源行号), 来历 }) });
    来源们.push(...整理来源(行, 查 || {}, id));
  }
  return { 比赛们, 届次们, 来源们, 跳过 };
}

export function 写入(db, 计划, { 批次, at }) {
  if (db.count('edition', { created_by: 批次 }, { 包括已删除: true })) throw new Error(`批次 ${批次} 已经导入过，不重复写`);
  db.transaction(tx => {
    for (const { id, data } of 计划.比赛们) tx.insert('competition', id, data);
    for (const { id, data } of 计划.届次们) tx.insert('edition', id, data);
    for (const { id, data } of 计划.来源们) tx.insert('source', id, data);
    tx.insert('audit_log', randomUUID(), { created_at: at, action: '名录导入', table_name: 'edition', detail: { 批次, 比赛: 计划.比赛们.length, 届次: 计划.届次们.length, 来源: 计划.来源们.length, 跳过: 计划.跳过.length, 操作人: '名录导入' } });
  });
  return { 比赛: 计划.比赛们.length, 届次: 计划.届次们.length, 来源: 计划.来源们.length };
}

// 只写日期的按北京时间当天结束算（和每日归档同一个算法）
const 结束时刻 = 值 => (!值 ? NaN : Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(值) ? `${值}T23:59:59.999+08:00` : 值));

// 转归档（2026-11-04 用户定）：把这一批里比赛结束日已过的历史届转成已归档。转了就会公开，所以只转有结束日期、没人动过的。
export function 转归档(db, { 批次, at, now = new Date(), 试跑 = false }) {
  const 过了 = 值 => 结束时刻(值) < now.getTime();
  const 要转 = db.find('edition', { created_by: 批次, status: '待人工审核' }, { orderBy: 'id' }).filter(e =>
    e.version === 1 && e.legacy?.名录导入?.结论类型?.startsWith('历史届') && 过了(e.competition_end) && !(结束时刻(e.registration_end) >= now.getTime()));
  const 编号们 = 要转.map(e => e.id).sort((a, b) => Number(a.split('-').at(-1)) - Number(b.split('-').at(-1)));
  if (试跑 || !要转.length) return { 编号们, 试跑 };
  db.transaction(tx => {
    for (const e of 要转) {
      tx.update('edition', e.id, {
        status: '已归档', status_at: at, updated_by: 批次, manual_fields: ['status'],
        status_reason: [`名录导入（${批次}）：比赛结束日 ${e.competition_end} 已过，按用户决定整批转已归档，未逐条人工审核`],
      }, e.version);
    }
    tx.insert('audit_log', randomUUID(), { created_at: at, action: '名录导入转归档', table_name: 'edition', detail: { 批次, 届次: 编号们.length, 编号们, 操作人: '名录导入' } });
  });
  return { 编号们, 试跑 };
}

export function 撤回(db, { 批次, at }) {
  return db.transaction(tx => {
    const 结果 = { 比赛: 0, 届次: 0, 来源: 0, 留下: [] };
    const 比赛们 = new Set();
    for (const e of tx.find('edition', { created_by: 批次 }, { 包括已删除: true })) {
      比赛们.add(e.competition_id);
      if (e.status !== '待人工审核') { 结果.留下.push({ 编号: e.id, 名称: e.edition_name, 状态: e.status }); continue; }
      const { 连带 } = tx.彻底删除('edition', e.id);
      结果.届次 += 1;
      结果.来源 += 连带.source || 0;
    }
    for (const id of 比赛们) {
      if (!id.startsWith('event-registry-') || tx.count('edition', { competition_id: id }, { 包括已删除: true })) continue;
      tx.彻底删除('competition', id);
      结果.比赛 += 1;
    }
    tx.insert('audit_log', randomUUID(), { created_at: at, action: '名录导入撤回', table_name: 'edition', detail: { 批次, 比赛: 结果.比赛, 届次: 结果.届次, 来源: 结果.来源, 留下: 结果.留下.length, 操作人: '名录导入' } });
    return 结果;
  });
}
