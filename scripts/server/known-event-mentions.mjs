// 抓取时判重命中“库里已有赛事”的通知：原先直接丢掉，现在当作追溯起点（2026-09-29 起）。
//
// 凌晨抓取（run-crawl-pipeline.mjs）调用 collectMentions，按赛事整理成 known-event-mentions.json；
// 02:15 记录追溯（trace-drafts.mjs）读它：
//   - 已归档（最可能是下一届）> 已发布 > 待审/草稿 的赛事，用当天闲置的搜索额度按赛事名搜当届官方来源；
//   - 所有被提到的赛事（含隔离），把提到它的通知、以及通知摘要里直接写出的网址挂上作待核验线索。
// 只挂线索，不改任何事实字段。
const STATUS_PRIORITY = { archived:0, published:1, pending_manual_review:2, pending_system_validation:2, draft:3, quarantined:9 };
const MATCH_VERDICTS = ['duplicate', 'likely_duplicate', 'same_event_other_tier'];
const MAX_NOTICES_PER_EVENT = 5;

const yearOf = text => {
  const years = String(text || '').match(/(?:19|20)\d{2}/g);
  return years ? Math.max(...years.map(Number)) : null;
};

// 这条记录是哪一年的届次：届次年份字段 > 名称里的年份 > 报名截止日的年份
export function recordYear(record) {
  return Number(record?.editionYear) || yearOf(`${record?.editionName || ''} ${record?.name || ''}`)
    || (record?.schedule?.registration_end ? new Date(record.schedule.registration_end).getFullYear() : null);
}

// 摘要里直接写出来的网址（去掉通知本身所在的网址）
export function urlsInText(text, exclude = '') {
  const found = String(text || '').match(/https?:\/\/[^\s<>"'，。；、）)】]+/g) || [];
  return [...new Set(found.map(url => url.replace(/[.,;:]+$/, '')))].filter(url => url !== exclude);
}

// buckets：某个来源 classifyCandidates 的结果；masters 需带 recordIds；recordsById：id → 记录
export function collectMentions(bucketsList, masters, recordsById, groups = new Map()) {
  const masterById = new Map(masters.map(master => [master.id, master]));
  for (const buckets of bucketsList) {
    for (const verdict of MATCH_VERDICTS) {
      for (const { candidate, match } of buckets[verdict] || []) {
        const master = masterById.get(match.matchedId);
        const records = (master?.recordIds || []).map(id => recordsById.get(id)).filter(Boolean);
        if (!records.length) continue;
        // 往届的通知不要：候选标题里的年份比库里最新一届还早
        const newest = Math.max(...records.map(record => recordYear(record) || 0));
        const candidateYear = yearOf(candidate.name);
        if (candidateYear && newest && candidateYear < newest) continue;
        if (!groups.has(master.id)) {
          groups.set(master.id, { eventId:master.id, name:master.standard_name,
            records:records.map(record => ({ id:record.id, status:record.dataStatus, year:recordYear(record) })), notices:[] });
        }
        const group = groups.get(master.id);
        if (group.notices.length >= MAX_NOTICES_PER_EVENT || group.notices.some(notice => notice.url === candidate.detailUrl)) continue;
        group.notices.push({ title:String(candidate.name || '').slice(0, 150), url:candidate.detailUrl, snippet:String(candidate.introduction || '').slice(0, 300),
          urls:urlsInText(candidate.introduction, candidate.detailUrl).slice(0, 5), verdict, reason:match.reason, query:candidate.matchedQuery || '' });
      }
    }
  }
  return groups;
}

// 这组提到的赛事里，线索挂到哪条记录上：状态最靠前的那条（已归档 > 已发布 > 待审 > 草稿 > 隔离），同状态取年份最新
export function primaryRecord(group) {
  return [...group.records].sort((a, b) => (STATUS_PRIORITY[a.status] ?? 5) - (STATUS_PRIORITY[b.status] ?? 5) || (b.year || 0) - (a.year || 0))[0];
}

// 要花搜索额度去追溯的赛事：不含隔离的，按状态优先级取前 budget 个
export function mentionSearchTargets(groups, budget) {
  const list = groups instanceof Map ? [...groups.values()] : groups;
  return list.map(group => ({ group, record:primaryRecord(group) }))
    .filter(item => item.record && item.record.status !== 'quarantined')
    .sort((a, b) => (STATUS_PRIORITY[a.record.status] ?? 5) - (STATUS_PRIORITY[b.record.status] ?? 5) || b.group.notices.length - a.group.notices.length)
    .slice(0, Math.max(0, budget));
}

// 不花搜索就能挂的线索：提到它的通知本身，以及通知摘要里写出的网址
export function noticeLeads(group, now = new Date()) {
  const leads = [];
  for (const notice of group.notices) {
    leads.push({ url:notice.url, title:notice.title, summary:`抓取时出现的相关通知：${notice.snippet.slice(0, 150)}`, foundAt:now.toISOString(), status:'待核验', source:'抓取中提及' });
    for (const url of notice.urls) leads.push({ url, title:`通知摘要里写出的网址（来自：${notice.title.slice(0, 40)}）`, summary:'', foundAt:now.toISOString(), status:'待核验', source:'通知摘要' });
  }
  return leads;
}
