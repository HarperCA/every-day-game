// 判重拿不准的，交给 AI 裁决（2026-10-01）。规则和 AI 各管什么见 cjs/dedupeArbitrationAi.js 的文件头。
//
// 两部分：
//   selectAmbiguous(buckets, masters, recordsById)  纯函数：从判重结果里挑出“规则判不好、值得问 AI”的候选
//   命令行：node arbitrate-dedupe.mjs <输入.json> <输出.json>   逐个问 AI，写出每条的结论和思考过程
//
// 哪些要问 AI：
//   · 相似度在“拿不准”和“很可能重复”之间的（搜索来的；平台条目按网址判重，不在此列）
//   · 标题包含库里赛事名 / 名字规范化后一致，但库里那条是往届、已归档或已隔离的旧记录——页面可能是新一届
// 哪些不用问：网址相同的（确定）；库里那条是当前这一届、还在审核或发布中的（同一届，重复）；
//   标题明显是学校、学院、系的校内选拔或转发通知的（下级通知，本来就不单独收录，只作追溯线索）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_GROUPS = 60;      // 每个来源每晚最多问多少次，防止一晚上突然几百次
const CONCURRENCY = 4;
const OLD_STATUSES = new Set(['archived', 'quarantined']);
// 学校、学院、系发的校内选拔、校赛、转发通知：上级比赛的下级环节
const SCHOOL_LEVEL = /校赛|校级|校内|院赛|院级|系赛|选拔赛|选拔|我校|校园|辅导会|^(?:【[^】]*】)?[一-龥]{2,14}(?:学院|学部|系|大学)关于/;

const editionYear = record => Number(String(record?.editionYear || '').match(/20\d{2}/)?.[0]) || Number(String(record?.schedule?.registration_end || record?.schedule?.registration_start || '').slice(0, 4)) || 0;

function recordSummary(record) {
  return {
    id:record.id, name:record.name, editionName:record.editionName, editionYear:record.editionYear, dataStatus:record.dataStatus,
    registration_start:record.schedule?.registration_start || '', registration_end:record.schedule?.registration_end || '',
    organizer:record.organizer || '', sourceUrl:(record.sources || []).find(source => /^https?:/i.test(source?.url || ''))?.url || record.registrationUrl || '',
  };
}

export function selectAmbiguous(buckets, masters, recordsById, { max = MAX_GROUPS, includeUncertain = true } = {}) {
  const masterById = new Map(masters.map(master => [master.id, master]));
  const items = [];
  const consider = ({ candidate, match }, kind) => {
    const master = masterById.get(match.matchedId);
    const records = (master?.recordIds || []).map(id => recordsById.get(id)).filter(Boolean);
    if (!records.length) return;
    const title = String(candidate.name || '');
    if (kind === 'duplicate') {
      if (!/完整包含|完全一致/.test(match.reason)) return;                                  // 网址相同等确定的不用问
      if (SCHOOL_LEVEL.test(title)) return;                                                // 下级通知，只作追溯线索
      if (records.some(record => !OLD_STATUSES.has(record.dataStatus))) return;           // 库里有当前这一届（审核中/已发布）：同一届，重复
    }
    items.push({
      key:candidate.detailUrl, kind,
      candidate:{ name:title, url:candidate.detailUrl, introduction:candidate.introduction || '', source:candidate.discovery?.source || candidate.source || '' },
      records:[...records].sort((a, b) => editionYear(b) - editionYear(a)).slice(0, 3).map(recordSummary),
      matchedMasterId:master.id, matchedMasterName:master.standard_name, matchReason:match.reason,
    });
  };
  if (includeUncertain) for (const entry of buckets.uncertain || []) consider(entry, 'uncertain');
  for (const entry of buckets.likely_duplicate || []) consider(entry, 'likely_duplicate');
  for (const entry of buckets.duplicate || []) consider(entry, 'duplicate');
  // 同一个标题对同一场库里的赛事只问一次（如同一通知转发了好几个网址）
  const seen = new Set();
  let groups = 0;
  return items.filter(item => {
    const group = `${item.candidate.name}|${item.matchedMasterId}`;
    if (!seen.has(group)) { if (groups >= max) return false; seen.add(group); groups += 1; }
    return true;
  });
}

async function main() {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile || !outFile) throw new Error('用法: node arbitrate-dedupe.mjs <输入.json> <输出.json>');
  // 抽取、收录判断用的 DeepSeek 钥匙，从 .extract-key 读（不接受命令行参数，免得进 shell 历史）
  const keyFile = path.join(HERE, '.extract-key');
  if (!process.env.EXTRACT_AI_API_KEY && fs.existsSync(keyFile)) process.env.EXTRACT_AI_API_KEY = fs.readFileSync(keyFile, 'utf8').trim();
  process.env.EXTRACT_AI_BASE_URL = process.env.EXTRACT_AI_BASE_URL || 'https://api.deepseek.com';
  process.env.EXTRACT_AI_MODEL = process.env.EXTRACT_AI_MODEL || 'deepseek-flash';
  const require = createRequire(import.meta.url);
  const { arbitrateDuplicate } = require(path.join(HERE, 'cjs', 'dedupeArbitrationAi.js'));

  const { items = [] } = JSON.parse(fs.readFileSync(path.resolve(HERE, inFile), 'utf8'));
  const groups = new Map();
  for (const item of items) {
    const group = `${item.candidate.name}|${item.matchedMasterId}`;
    if (!groups.has(group)) groups.set(group, { first:item, members:[] });
    groups.get(group).members.push(item);
  }
  const list = [...groups.values()];
  console.log(`判重裁决：${items.length} 条候选，合并成 ${list.length} 次询问`);
  const decisions = {};
  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const group = list[cursor++];
      let outcome;
      const reasoning = [];
      try {
        outcome = await arbitrateDuplicate(group.first, undefined, { onReasoning:entry => reasoning.push(entry) });
      } catch (error) {
        outcome = { error:String(error?.message || error).slice(0, 200), promote:false, relation:'unclear' };
      }
      const thinking = reasoning[0]?.reasoning?.text || '';
      for (const member of group.members) {
        decisions[member.key] = {
          ...outcome, title:member.candidate.name, matched:{ id:member.matchedMasterId, name:member.matchedMasterName },
          records:member.records.map(record => ({ id:record.id, dataStatus:record.dataStatus, editionName:record.editionName })),
          thinking,
        };
      }
      console.log(`  ${outcome.promote ? '继续' : '跳过'}  ${String(outcome.relation).padEnd(18)} ${String(outcome.confidence ?? '').slice(0, 4)}  ${group.first.candidate.name.slice(0, 36)} ← ${String(outcome.reason || outcome.error || '').slice(0, 60)}`);
    }
  }
  await Promise.all(Array.from({ length:Math.min(CONCURRENCY, list.length) }, () => worker()));
  fs.writeFileSync(path.resolve(HERE, outFile), JSON.stringify({ generatedAt:new Date().toISOString(), decisions }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(`判重裁决失败：${error.message}`); process.exit(1); });
}
