// 抓取流水线单轮明细：把服务器 runs/<运行编号>/ 下各阶段留下的文件拼成逐条去向，
// 给后台“抓取结果账”的“查看明细”用（原先是 scripts/run-report/build.py 手动生成的 HTML）。
//
// 每一条候选从哪来、判重结果、前置筛选结论和理由、最终去向；搜索脚本内部丢掉的也逐条列出。
const fs = require('node:fs');
const path = require('node:path');
const { toSafeId } = require('./candidateToRecord');

const RUNS_DIR = process.env.RUNS_DIR || path.resolve(__dirname, '..', '..', 'runs');
const RUN_ID = /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/;

const KIND = {
  repost_or_school_selection:'转载或校内选拔', news_or_result:'新闻或赛果', unrelated:'与赛事无关',
  organizer_notice:'主办方通知', competition_site:'赛事官网', registration_entry:'报名入口', directory_lead:'目录清单',
};
const ACTION = { fetch:'放行读正文', review:'低置信度，只留线索', lead:'只留线索', trace:'追溯上级赛事', reject:'丢弃（与赛事无关）' };
const SOURCE = { baidu:'百度搜索', tianchi:'天池', upln:'辽宁平台', datafountain:'DataFountain' };

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
  const candidateByUrl = new Map(combined.map(item => [item.detailUrl, item]));
  // 入库报告里实际写入的记录编号（新增或更新）；老的运行没有这个字段，退回原来的判断
  const writtenIds = Array.isArray(ingest.addedIds) ? new Set([...(ingest.addedIds || []), ...(ingest.updatedIds || [])]) : null;
  // 入库时跳过的（比如“发现时已过报名截止”）不在 scope-review 里，按名字对上入库报告的 skippedList（2026-10-01 起才有）
  const skippedReason = new Map((ingest.skippedList || []).map(item => [item.name, item.reason]));

  // 读了详情页的那一条最后怎样：读失败 / 被入库关拦下 / 跳过 / 写入（2026-10-01：原先没被拦下的一律显示“已写入后台”，
  // 实际上入库时因“已过报名截止”跳过的也会这样显示，现在对照入库报告里真正写入的编号）
  function readOutcome(url) {
    const result = extractByUrl.get(url) || {};
    if (!result.ok) return { final:`读详情页失败（${result.status || result.error || '未知'}）`, extracted:false, added:false };
    const why = heldReason.get(url);
    if (why) return { final:`读了详情页，未入库：${why}`, extracted:true, added:false };
    const candidate = candidateByUrl.get(url);
    if (!writtenIds) return { final:'读了详情页，已写入后台', extracted:true, added:true };
    let id = '';
    try { id = candidate?.externalId ? toSafeId('edition', candidate.externalId) : ''; } catch { id = ''; }
    if (id && writtenIds.has(id)) return { final:'读了详情页，已写入后台', extracted:true, added:true };
    const name = result.extracted?.competition_name?.value;
    const skipped = skippedReason.get(candidate?.name) || (name && skippedReason.get(name));
    if (skipped) return { final:`读了详情页，未入库：${skipped}`, extracted:true, added:false };
    if (ingest.persisted === false || ingest.dryRun) return { final:'读了详情页（试运行，未写库）', extracted:true, added:false };
    return { final:'读了详情页，未入库（原因见入库报告汇总）', extracted:true, added:false };
  }

  const rows = [];
  // 搜索脚本内部就丢掉的（9 月 26 日起逐条记录）
  for (const item of baidu.dropped || []) {
    rows.push({ source:'百度搜索', query:item.query || '', route:item.route || '', title:clip(item.title, 150), url:item.url || '', intro:clip(item.snippet, 160),
      dup:'', filter:'', kind:'', reason:item.reasonText || item.reason || '', confidence:null, final:`搜索时丢弃：${item.reasonText || item.reason || ''}`, stage:0, steps:['search'] });
  }
  const sourceFiles = Object.keys(files).filter(name => /-candidates\.json$/.test(name) && !name.startsWith('combined') && name !== 'formal-notices.json');
  for (const name of sourceFiles) {
    const key = name.replace(/-candidates\.json$/, '');
    for (const candidate of files[name]?.candidates || []) {
      const url = candidate.detailUrl;
      const decision = decisionByUrl.get(url);
      const row = { source:SOURCE[key] || key, query:candidate.matchedQuery || '', route:candidate.discovery?.route || '', title:clip(candidate.name, 150), url:url || '',
        intro:clip(candidate.introduction, 160), dup:'', filter:'', kind:'', reason:'', confidence:null, final:'', stage:1,
        // 这一条走到了漏斗的哪几步（后台点漏斗、选“流程环节”按这个筛）
        steps:key === 'baidu' ? ['search', 'candidate'] : ['candidate'] };
      if (!decision) {
        Object.assign(row, { dup:'已在库或疑似重复', reason:'判重时与库里已有赛事重名或疑似重名，本轮跳过', final:'判重跳过', stage:1 });
      } else {
        Object.assign(row, { dup:'新', filter:ACTION[decision.action] || decision.action, kind:KIND[decision.kind] || decision.kind || '',
          reason:decision.reason || '', confidence:Number.isFinite(decision.confidence) ? decision.confidence : null });
        row.steps.push('new');
        if (decision.action === 'fetch') row.steps.push('passed');
        if (formalUrls.has(url)) {
          const found = leadsByNotice.get(url)?.leads?.length || 0;
          Object.assign(row, { final:`转入通知追溯（找到 ${found} 个待核验页面）`, stage:3 });
        } else if (combinedUrls.has(url)) {
          const result = extractByUrl.get(url) || {};
          const outcome = readOutcome(url);
          Object.assign(row, { final:outcome.final, stage:4 });
          row.steps.push('read');
          if (outcome.extracted) row.steps.push('extracted');
          if (outcome.added) row.steps.push('added');
          // 读详情时 AI 的思考过程（2026-09-30 起打开并记录，见 aiReasoning.js）
          if (result.reasoning?.text) row.thinking = String(result.reasoning.text);
        } else if (decision.action === 'fetch') Object.assign(row, { final:'放行但未读正文（未进入本轮读取名额）', stage:2 });
        else if (decision.action === 'reject') Object.assign(row, { final:'前置筛选拦截', stage:2 });
        else Object.assign(row, { final:'只留作线索，未入库', stage:2 });
      }
      rows.push(row);
    }
  }

  // 通知追溯找到的页面：原先不在表里，但“读了详情页”的数字算了它们，点进去对不上
  const followup = files['notice-followup-filter-report.json'] || {};
  const listedUrls = new Set(rows.map(row => row.url));
  for (const decision of followup.decisions || []) {
    if (!decision?.url || listedUrls.has(decision.url)) continue;
    listedUrls.add(decision.url);
    const row = { source:'通知追溯', query:'', route:'通知追溯', title:clip(decision.title || decision.proposedName, 150), url:decision.url,
      intro:clip(decision.proposedName ? `追溯的上级赛事：${decision.proposedName}` : '', 160), dup:'', filter:ACTION[decision.action] || decision.action || '',
      kind:KIND[decision.kind] || decision.kind || '', reason:decision.reason || '', confidence:Number.isFinite(decision.confidence) ? decision.confidence : null,
      final:'', stage:3, steps:[] };
    if (combinedUrls.has(decision.url)) {
      const result = extractByUrl.get(decision.url) || {};
      const outcome = readOutcome(decision.url);
      Object.assign(row, { final:outcome.final, stage:4 });
      row.steps.push('read');
      if (outcome.extracted) row.steps.push('extracted');
      if (outcome.added) row.steps.push('added');
      if (result.reasoning?.text) row.thinking = String(result.reasoning.text);
    } else {
      row.final = decision.action === 'fetch' ? '追溯页面：放行但判重未通过或标题含通知，未读' : `追溯页面：${ACTION[decision.action] || decision.action}，未读`;
    }
    rows.push(row);
  }

  const count = map => Object.fromEntries(Object.entries(map));
  const stepCount = key => rows.filter(row => (row.steps || []).includes(key)).length;
  const actions = {};
  for (const item of jev.decisions || []) actions[item.action] = (actions[item.action] || 0) + 1;
  return {
    id:runId,
    // 漏斗每一步的条数，按表里每条实际走到的步数算，点漏斗筛出来的条数和这里一致
    steps:{ search:stepCount('search'), candidate:stepCount('candidate'), new:stepCount('new'), passed:stepCount('passed'),
      read:stepCount('read'), extracted:stepCount('extracted'), added:stepCount('added') },
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
