// 读完详情、抽出真实的比赛全称之后，再用这个名字和库里比一次（2026-10-01，用户确认）。
//
// 为什么：前面的判重用的是搜索标题（“学会动态”“激发学习英语的兴趣…”）和网址，真名要读完正文才知道；
// 而通知正文里写出的官网又改成了只按网址判重。库里已有这场比赛、只是来源网址不一样时，
// 官网会被当成新比赛再入库一条。所以读完之后，名字规范化后完全一致的，不再新增，
// 改成给库里已有的那条补一个来源（待核验），由人决定是不是官方。
import crypto from 'node:crypto';

// 判重模块在服务器上是 ./crawler/lib/，在仓库里是 ../crawler/lib/：两个位置都试，不复制一份逻辑（复制会各改各的）
const { normalizeName, urlKey } = await import('./crawler/lib/dedupe.mjs').catch(() => import('../crawler/lib/dedupe.mjs'));

const MIN_KEY_LENGTH = 4; // 规范化后太短的名字（两三个字）撞名的可能太大，不据此判重
const STATUS_ORDER = { published:0, archived:1, draft:2, pending_manual_review:2 };

// 名字规范化后（去年份、届次、括号、引号、空白）与库里某条的名称或别名完全一致的，取最合适的那一条：
// 已发布 > 已归档 > 其他，再按最近更新。隔离的也找出来（调用方据此不新增，但不改它）。
export function findSameNameRecord(name, records = []) {
  const key = normalizeName(name);
  if (key.length < MIN_KEY_LENGTH) return null;
  const same = records.filter(record => [record?.name, ...(record?.aliases || [])].some(candidate => normalizeName(candidate) === key));
  if (!same.length) return null;
  const rank = record => (record.dataStatus === 'quarantined' ? 9 : STATUS_ORDER[record.dataStatus] ?? 3);
  return [...same].sort((a, b) => rank(a) - rank(b)
    || String(b.updatedAt || b.firstSeenAt || '').localeCompare(String(a.updatedAt || a.firstSeenAt || '')))[0];
}

// 给已有记录补一个来源。返回新的记录对象；网址不合法或来源里已经有了，原样返回同一个对象。
// 只补来源和一条提示，不动任何已经核验、审核过的字段——抓取不能覆盖已经做过的判断。
export function supplementSource(record, { url, foundName = '', now = new Date() } = {}) {
  const key = urlKey(url);
  if (!key) return record;
  if ((record.sources || []).some(source => urlKey(source?.url) === key)) return record;
  const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 10);
  const source = {
    id:`source-${record.id}-found-${hash}`,
    edition_id:record.id,
    url:String(url),
    source_type:'organizer_website',
    // 抓来的来源尚未核验，不能自称官方（和 candidateToRecord 一致）
    is_official:false,
    published_at:null,
    last_verified_at:now.toISOString(),
    validity_status:'unchecked',
  };
  return {
    ...record,
    sources:[...(record.sources || []), source],
    qualityIssues:[...(record.qualityIssues || []), `抓取发现同名赛事的新来源，待核验是否官方：${url}${foundName ? `（页面里的比赛名：${foundName}）` : ''}`],
  };
}
