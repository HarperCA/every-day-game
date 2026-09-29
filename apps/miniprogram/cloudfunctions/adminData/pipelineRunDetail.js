// 抓取流水线单轮明细：把服务器 runs/<运行编号>/ 下各阶段留下的文件拼成逐条去向，
// 给后台“抓取结果账”的“查看明细”用（原先是 scripts/run-report/build.py 手动生成的 HTML）。
//
// 每一条候选从哪来、判重结果、前置筛选结论和理由、最终去向；搜索脚本内部丢掉的也逐条列出。
const fs = require('node:fs');
const path = require('node:path');

const RUNS_DIR = process.env.RUNS_DIR || path.resolve(__dirname, '..', '..', 'runs');
const RUN_ID = /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/;

const KIND = {
  repost_or_school_selection:'转载或校内选拔', news_or_result:'新闻或赛果', unrelated:'与赛事无关',
  organizer_notice:'主办方通知', competition_site:'赛事官网', registration_entry:'报名入口', directory_lead:'目录清单',
};
const ACTION = { fetch:'放行读正文', review:'低置信度，只留线索', lead:'只留线索', reject:'拦截' };
const SOURCE = { baidu:'百度搜索', tianchi:'天池', datafountain:'DataFountain' };

const clip = (value, n) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, n);

// files：{ 文件名: 解析后的 JSON }；缺的文件当作这一步没跑到。
function composeRunDetail(runId, files) {
  const baidu = files['baidu-candidates.json'] || {};
  const jev = files['jev-filter-report.json'] || {};
  const formal = files['formal-notices.json']?.candidates || [];
  const combined = files['combined-candidates.json']?.candidates || [];
  const extracted = files['combined-extracted.json']?.results || [];
  const leads = files['notice-resolution-leads.json']?.results || [];
  const ingest = files['ingest-report.json'] || {};
  const held = files['combined-candidates.json.scope-review.json']?.held || [];

  const decisionByUrl = new Map((jev.decisions || []).map(item => [item.url, item]));
  const formalUrls = new Set(formal.map(item => item.detailUrl));
  const combinedUrls = new Set(combined.map(item => item.detailUrl));
  const extractByUrl = new Map(extracted.map(item => [item.url, item]));
  const leadsByNotice = new Map(leads.map(item => [item.noticeUrl, item]));
  const heldReason = new Map(held.map(item => [item.candidate?.detailUrl, item.reason || item.scope?.reason || item.decision?.reason || item.assessment?.reason || '']));

  const rows = [];
  // 搜索脚本内部就丢掉的（9 月 26 日起逐条记录）
  for (const item of baidu.dropped || []) {
    rows.push({ source:'百度搜索', query:item.query || '', route:item.route || '', title:clip(item.title, 150), url:item.url || '', intro:clip(item.snippet, 160),
      dup:'', filter:'', kind:'', reason:item.reasonText || item.reason || '', confidence:null, final:`搜索时丢弃：${item.reasonText || item.reason || ''}`, stage:0 });
  }
  const sourceFiles = Object.keys(files).filter(name => /-candidates\.json$/.test(name) && !name.startsWith('combined') && name !== 'formal-notices.json');
  for (const name of sourceFiles) {
    const key = name.replace(/-candidates\.json$/, '');
    for (const candidate of files[name]?.candidates || []) {
      const url = candidate.detailUrl;
      const decision = decisionByUrl.get(url);
      const row = { source:SOURCE[key] || key, query:candidate.matchedQuery || '', route:candidate.discovery?.route || '', title:clip(candidate.name, 150), url:url || '',
        intro:clip(candidate.introduction, 160), dup:'', filter:'', kind:'', reason:'', confidence:null, final:'', stage:1 };
      if (!decision) {
        Object.assign(row, { dup:'已在库或疑似重复', reason:'判重时与库里已有赛事重名或疑似重名，本轮跳过', final:'判重跳过', stage:1 });
      } else {
        Object.assign(row, { dup:'新', filter:ACTION[decision.action] || decision.action, kind:KIND[decision.kind] || decision.kind || '',
          reason:decision.reason || '', confidence:Number.isFinite(decision.confidence) ? decision.confidence : null });
        if (formalUrls.has(url)) {
          const found = leadsByNotice.get(url)?.leads?.length || 0;
          Object.assign(row, { final:`转入通知追溯（找到 ${found} 个待核验页面）`, stage:3 });
        } else if (combinedUrls.has(url)) {
          const result = extractByUrl.get(url) || {};
          const why = heldReason.get(url);
          if (!result.ok) Object.assign(row, { final:`读详情页失败（${result.status || result.error || '未知'}）`, stage:4 });
          else Object.assign(row, { final:why ? `读了详情页，未入库：${why}` : '读了详情页，已写入后台', stage:4 });
        } else if (decision.action === 'fetch') Object.assign(row, { final:'放行但未读正文（未进入本轮读取名额）', stage:2 });
        else if (decision.action === 'reject') Object.assign(row, { final:'前置筛选拦截', stage:2 });
        else Object.assign(row, { final:'只留作线索，未入库', stage:2 });
      }
      rows.push(row);
    }
  }

  const count = map => Object.fromEntries(Object.entries(map));
  const actions = {};
  for (const item of jev.decisions || []) actions[item.action] = (actions[item.action] || 0) + 1;
  return {
    id:runId,
    summary:{
      searchResults:baidu.stats?.referencesTotal ?? null, queries:baidu.stats?.queries ?? (baidu.queries || []).length,
      dropped:baidu.droppedCount ?? (baidu.dropped || []).length,
      candidates:rows.filter(row => row.stage > 0).length,
      newCandidates:(jev.decisions || []).length, filter:count(actions),
      formalNotices:formal.length, detailRead:combined.length, extractOk:extracted.filter(item => item.ok).length,
      added:ingest.added ?? null, failureReasons:ingest.failureReasons || {},
    },
    rows,
    notices:leads.map(item => ({ title:clip(item.noticeTitle, 150), url:item.noticeUrl, name:item.proposedName || '', query:item.followupQuery || '',
      leads:(item.leads || []).map(lead => ({ title:clip(lead.title, 120), url:lead.url })) })),
    perQuery:(baidu.perQuery || []).map(item => ({ query:item.query, route:item.route || '', results:item.references, outOfScope:item.outOfScope,
      irrelevant:item.irrelevant, duplicate:item.duplicate, candidates:item.candidates })),
  };
}

function loadRunDetail(runId) {
  if (!RUN_ID.test(String(runId || ''))) throw new Error('invalid_run_id');
  const dir = path.join(RUNS_DIR, runId);
  if (!fs.existsSync(dir)) throw new Error('run_not_found');
  const files = {};
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.json'))) {
    try { files[name] = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { /* 写了一半的文件跳过 */ }
  }
  return composeRunDetail(runId, files);
}

module.exports = { composeRunDetail, loadRunDetail, RUN_ID };
