// 把库里的记录（后台格式：eventId/name/aliases/sources）整理成
// classifyCandidates 认识的 masters 形状。单独拆出来（不放进
// run-crawl-pipeline.mjs）是因为那个文件顶层 import 了
// @cloudbase/js-sdk，单测环境里解析不到这个包（和 ingest-candidates.mjs
// 没有测试文件是同一个原因）——纯逻辑不该被这种依赖拖累，测不到。
import { hostOf } from './dedupe.mjs';

export function buildMastersFromRecords(records) {
  const masters = [];
  const seen = new Set();
  for (const record of records || []) {
    if (!record?.eventId || seen.has(record.eventId)) continue;
    seen.add(record.eventId);
    masters.push({
      id: record.eventId,
      standard_name: record.name,
      aliases: record.aliases || [],
      website_url: (record.sources || [])[0]?.url || '',
      sourceHosts: (record.sources || []).map(s => hostOf(s.url)).filter(Boolean),
    });
  }
  return masters;
}
