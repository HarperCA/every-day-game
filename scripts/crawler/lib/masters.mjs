// 把库里的记录（后台格式：eventId/name/aliases/sources）整理成
// classifyCandidates 认识的 masters 形状。单独拆出来（不放进
// run-crawl-pipeline.mjs）是因为那个文件顶层 import 了
// @cloudbase/js-sdk，单测环境里解析不到这个包（和 ingest-candidates.mjs
// 没有测试文件是同一个原因）——纯逻辑不该被这种依赖拖累，测不到。
import { hostOf } from './dedupe.mjs';

// sourceUrls：这场赛事所有届次的来源网址，给“网址完全相同才算重复”用；
// recordIds：这场赛事对应的全部记录，判重命中后要把线索挂到这些记录上。
export function buildMastersFromRecords(records) {
  const masters = [];
  const byEvent = new Map();
  for (const record of records || []) {
    if (!record?.eventId) continue;
    const urls = [...(record.sources || []).map(s => s?.url), record.registrationUrl].filter(url => /^https?:\/\//i.test(url || ''));
    const existing = byEvent.get(record.eventId);
    if (existing) {
      existing.sourceUrls.push(...urls.filter(url => !existing.sourceUrls.includes(url)));
      if (record.id && !existing.recordIds.includes(record.id)) existing.recordIds.push(record.id);
      continue;
    }
    const master = {
      id: record.eventId,
      standard_name: record.name,
      aliases: record.aliases || [],
      website_url: (record.sources || [])[0]?.url || '',
      sourceHosts: (record.sources || []).map(s => hostOf(s.url)).filter(Boolean),
      sourceUrls: [...new Set(urls)],
      recordIds: record.id ? [record.id] : [],
    };
    byEvent.set(record.eventId, master);
    masters.push(master);
  }
  return masters;
}
