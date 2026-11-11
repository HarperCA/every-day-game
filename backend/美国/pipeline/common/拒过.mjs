// 拒过的网址：03 筛选、05 审核丢弃候选时，在返回的改动里顺带提一条，总控统一写进比赛库的 rejected_url；
// 30 天内 02 对比去重遇到同一个网址就扔掉，不再白花额度。超过 30 天由每日清理删掉。
//   拒过改动({ item, 原因, module, runId, now }) → 一条改动；网址不合规时交回 null（不提）
import { 网址键 } from './网址键.mjs';

export function 拒过改动({ item, 原因, module, runId, now }) {
  const url = item.data?.url || item.key;
  const key = 网址键(url);
  if (!key) return null;
  return {
    table: 'rejected_url', key: `${runId}:${key}`, op: 'insert', itemKey: item.key,
    payload: { url, url_key: key, title: String(item.data?.name || '').slice(0, 300), reason: String(原因).slice(0, 300), module, run_id: runId, rejected_at: now.toISOString() },
  };
}
