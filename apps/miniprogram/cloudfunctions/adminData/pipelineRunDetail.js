// 抓取流水线单轮明细：把服务器 runs/<运行编号>/ 下各阶段留下的文件拼成逐条去向，
// 给后台“抓取结果账”的“查看明细”用（原先是 scripts/run-report/build.py 手动生成的 HTML）。
//
// 每一条候选从哪来、判重结果、前置筛选结论和理由、最终去向；搜索脚本内部丢掉的也逐条列出。
// 2026-10-01 起每条还带 trail（它依次经过了哪些环节、在每个环节的结果），并由此算出数据流图（pipelineFlow.js）。
const fs = require('node:fs');
const path = require('node:path');
const { toSafeId } = require('./candidateToRecord');
const { buildFlow, finalizeTrail } = require('./pipelineFlow');

const RUNS_DIR = process.env.RUNS_DIR || path.resolve(__dirname, '..', '..', 'runs');
const RUN_ID = /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/;

const KIND = {
  repost_or_school_selection:'转载或校内选拔', news_or_result:'新闻或赛果', unrelated:'与赛事无关',
  organizer_notice:'主办方通知', competition_site:'赛事官网', registration_entry:'报名入口', directory_lead:'目录清单',
};
const ACTION = { fetch:'放行读正文', review:'低置信度，只留线索', lead:'只留线索', trace:'追溯上级赛事', reject:'丢弃（与赛事无关）' };
const SOURCE = { baidu:'百度搜索', tianchi:'天池', upln:'辽宁平台', datafountain:'DataFountain' };
// 读详情这一步（下载网页、检查是不是空壳）失败的状态；其余失败算 AI 抽取这一步
const READ_FAIL = /robots|boilerplate|fetch_failed|unsupported|^http_|invalid_url|network|timeout|too_large|budget|forbidden|not_found/i;
const WRITTEN_LABEL = { archive:'归档', 'auto-publish':'自动发布', review:'待人工审核', hold:'先放草稿（报名较晚）', admit:'进入草稿', draft:'进入草稿' };

const clip = (value, n) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, n);
const step = (n, o, note = '', extra = {}) => ({ n, o, note:clip(note, 160), ...extra });

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

  // 判重时规则拿不准、交给 AI 裁决的（dedupe-arbitration-<来源>.json，逐条带理由和思考过程）
  const arbitrationByUrl = new Map();
  for (const [name, file] of Object.entries(files)) {
    if (/^dedupe-arbitration-.+\.json$/.test(name) && !/-input\.json$/.test(name)) for (const [url, decision] of Object.entries(file?.decisions || {})) arbitrationByUrl.set(url, decision);
  }

  const decisionByUrl = new Map((jev.decisions || []).map(item => [item.url, item]));
  const formalUrls = new Set(formal.map(item => item.detailUrl));
  const combinedUrls = new Set(combined.map(item => item.detailUrl));
  const extractByUrl = new Map(extracted.map(item => [item.url, item]));
  // 同一场比赛的多篇通知归成一组、只搜一次：组里每一篇通知都要能对上这一组的结果（原先只认第一篇，其余的被误记成“没追溯”）
  const leadsByNotice = new Map(leads.flatMap(item => [[item.noticeUrl, item], ...(item.notices || []).map(notice => [notice.url, item])]));
  const heldReason = new Map(held.map(item => [item.candidate?.detailUrl, item.reason || item.scope?.reason || item.decision?.reason || item.assessment?.reason || '']));
  const candidateByUrl = new Map(combined.map(item => [item.detailUrl, item]));
  // 入库报告里实际写入的记录编号（新增或更新）；老的运行没有这个字段，退回原来的判断
  const writtenIds = Array.isArray(ingest.addedIds) ? new Set([...(ingest.addedIds || []), ...(ingest.updatedIds || [])]) : null;
  // 入库时跳过的（比如“库里已有同名”“门槛没过”）不在 scope-review 里，按名字对上入库报告的 skippedList（2026-10-01 起才有）
  const skippedReason = new Map((ingest.skippedList || []).map(item => [item.name, item.reason]));
  const supplemented = new Set((ingest.updatedList || []).filter(item => item.label === '补来源').map(item => item.name));
  const writtenLabel = new Map([...(ingest.addedList || []), ...(ingest.updatedList || [])].filter(item => item.id).map(item => [item.id, item.label]));

  // 读了详情页以后这一条依次经过：读详情 → 抽取 → 按真名查库 → 范围检查 → 入库门槛。返回最后的去向文字和这几步的路径。
  // （2026-10-01：原先没被拦下的一律显示“已写入后台”，实际上入库时因“已过报名截止”跳过的也会这样显示，现在对照入库报告里真正写入的编号）
  function analyzeRead(url) {
    const result = extractByUrl.get(url) || {};
    const trail = [];
    if (!extractByUrl.has(url)) {
      trail.push(step('read', 'fail', '没有读取记录'));
      return { final:'读详情页失败（未知）', trail };
    }
    if (!result.ok) {
      const status = result.status || result.error || '未知';
      if (READ_FAIL.test(String(status))) trail.push(step('read', 'fail', String(status)));
      else trail.push(step('read', 'ok'), step('extract', 'fail', String(status)));
      return { final:`读详情页失败（${status}）`, trail };
    }
    trail.push(step('read', 'ok'), step('extract', 'ok', result.extracted?.competition_name?.value ? `比赛名：${result.extracted.competition_name.value}` : ''));
    const candidate = candidateByUrl.get(url);
    const realName = result.extracted?.competition_name?.value;
    const names = [candidate?.name, realName].filter(Boolean);
    const sameNameReason = names.map(name => skippedReason.get(name)).find(reason => /^库里已有同名/.test(reason || ''));
    if (names.some(name => supplemented.has(name))) {
      trail.push(step('same_name', 'supplement', '库里已有同名赛事，给它补了来源'));
      return { final:'读了详情页：库里已有同名赛事，已补来源', trail };
    }
    if (sameNameReason) {
      trail.push(step('same_name', 'exists', sameNameReason));
      return { final:`读了详情页，未入库：${sameNameReason}`, trail };
    }
    trail.push(step('same_name', 'new'));
    const why = heldReason.get(url);
    if (why) {
      trail.push(step('scope', 'reject', why));
      return { final:`读了详情页，未入库：${why}`, trail };
    }
    trail.push(step('scope', 'pass'));
    let id = '';
    try { id = candidate?.externalId ? toSafeId('edition', candidate.externalId) : ''; } catch { id = ''; }
    if (!writtenIds) {
      trail.push(step('gate', 'written', '写入后台（老的运行记录，没有区分新增还是跳过）'));
      return { final:'读了详情页，已写入后台', trail };
    }
    if (id && writtenIds.has(id)) {
      trail.push(step('gate', 'written', writtenLabel.get(id) ? `写入后台：${WRITTEN_LABEL[writtenLabel.get(id)] || writtenLabel.get(id)}` : '写入后台'));
      return { final:'读了详情页，已写入后台', trail };
    }
    const skipped = names.map(name => skippedReason.get(name)).find(Boolean);
    if (skipped) {
      trail.push(step('gate', 'skip', skipped));
      return { final:`读了详情页，未入库：${skipped}`, trail };
    }
    if (ingest.persisted === false || ingest.dryRun) {
      trail.push(step('gate', 'dry', '试运行，未写库'));
      return { final:'读了详情页（试运行，未写库）', trail };
    }
    trail.push(step('gate', 'skip', '原因见入库报告汇总'));
    return { final:'读了详情页，未入库（原因见入库报告汇总）', trail };
  }

  // 前置筛选之后这条走向哪里：追溯 / 读详情 / 搁置
  function afterFilter(row, url, decision, trail) {
    const action = decision.action;
    if (formalUrls.has(url)) {
      const found = leadsByNotice.get(url);
      const pages = found?.leads?.length || 0;
      // 前置筛选本来没判“追溯”，但标题是通知，流水线把它转去追溯了：路径上标出来
      const last = trail[trail.length - 1];
      if (action !== 'trace' && last && (last.n === 'jev' || last.n === 'rule')) last.o = 'notice';
      // 没找到页面的三种情况：提不出合法赛事名（根本没分到组，没搜）/ 分到组了但没轮上额度 / 搜了没找到
      const outcomeTrace = pages ? 'found' : found?.followupQuery ? 'none' : found ? 'noquota' : 'noname';
      // 用了哪个搜索引擎、返回几条、保留几条（2026-10-01 起百度 → Kimi → DeepSeek 依次补位）
      const searched = found?.search;
      const searchNote = searched ? `用${searched.label}搜索，返回 ${searched.returned} 条，保留 ${searched.kept} 条` : found?.error ? `搜索失败：${found.error}` : '';
      const noteTrace = { found:pages ? `${searchNote ? `${searchNote}；` : ''}找到 ${pages} 个待核验页面${searched ? '' : '（通知正文里写出的网址）'}` : '', none:searchNote ? `${searchNote}，没有可用的页面` : (found?.error ? searchNote : '搜索后没找到'),
        noquota:'提得出赛事名，但本晚三个搜索引擎的额度都用完，没轮上', noname:'标题提不出合法赛事名（栏目、汇总、招聘、校级等），没搜' }[outcomeTrace];
      trail.push(step('trace', outcomeTrace, noteTrace));
      Object.assign(row, { final:`转入通知追溯（找到 ${pages} 个待核验页面）`, stage:3 });
    } else if (combinedUrls.has(url)) {
      const outcomeRead = analyzeRead(url);
      Object.assign(row, { final:outcomeRead.final, stage:4 });
      trail.push(...outcomeRead.trail);
      const result = extractByUrl.get(url) || {};
      // 读详情时 AI 的思考过程（2026-09-30 起打开并记录，见 aiReasoning.js）
      if (result.reasoning?.text) row.thinking = String(result.reasoning.text);
    } else if (action === 'fetch') {
      Object.assign(row, { final:'放行但未读正文（未进入本轮读取名额）', stage:2 });
      const last = trail[trail.length - 1];
      if (last) last.o = last.n === 'dedupe' ? 'platform_unread' : 'fetch_unread';
    } else if (action === 'reject') {
      Object.assign(row, { final:'前置筛选拦截', stage:2 });
    } else {
      Object.assign(row, { final:'只留作线索，未入库', stage:2 });
    }
  }

  const rows = [];
  // 搜索脚本内部就丢掉的（9 月 26 日起逐条记录）
  for (const item of baidu.dropped || []) {
    const reason = item.reasonText || item.reason || '';
    rows.push({ source:'百度搜索', query:item.query || '', route:item.route || '', title:clip(item.title, 150), url:item.url || '', intro:clip(item.snippet, 160),
      dup:'', filter:'', kind:'', reason, confidence:null, final:`搜索时丢弃：${reason}`, stage:0, trail:finalizeTrail([step('search', 'dropped', reason)]) });
  }
  const sourceFiles = Object.keys(files).filter(name => /-candidates\.json$/.test(name) && !name.startsWith('combined') && name !== 'formal-notices.json');
  for (const name of sourceFiles) {
    const key = name.replace(/-candidates\.json$/, '');
    for (const candidate of files[name]?.candidates || []) {
      const url = candidate.detailUrl;
      const decision = decisionByUrl.get(url);
      const row = { source:SOURCE[key] || key, query:candidate.matchedQuery || '', route:candidate.discovery?.route || '', title:clip(candidate.name, 150), url:url || '',
        intro:clip(candidate.introduction, 160), dup:'', filter:'', kind:'', reason:'', confidence:null, final:'', stage:1 };
      const trail = [step(key === 'baidu' ? 'search' : 'platforms', 'ok')];
      const arbitration = arbitrationByUrl.get(url);
      if (arbitration?.thinking) row.thinking = String(arbitration.thinking);
      if (!decision) {
        if (arbitration && !arbitration.promote) {
          // 规则拿不准、AI 裁决后仍然跳过（同一届重复、下级通知、看不出，或 AI 调用失败）
          const why = arbitration.error ? `AI 裁决失败（${arbitration.error}），保守跳过` : `AI 裁决：${arbitration.label || arbitration.relation}｜${arbitration.reason || ''}`;
          Object.assign(row, { dup:'已在库或疑似重复（AI 裁决）', reason:why, final:`判重跳过：${why}`, stage:1 });
          trail.push(step('dedupe', 'ambiguous', '规则拿不准，交 AI 裁决'), step('arbitrate', 'skip', why));
        } else {
          Object.assign(row, { dup:'已在库或疑似重复', reason:'判重时与库里已有赛事重名或疑似重名，本轮跳过', final:'判重跳过', stage:1 });
          trail.push(step('dedupe', 'skip', row.reason));
        }
      } else {
        Object.assign(row, { dup:'新', filter:ACTION[decision.action] || decision.action, kind:KIND[decision.kind] || decision.kind || '',
          reason:decision.reason || '', confidence:Number.isFinite(decision.confidence) ? decision.confidence : null });
        if (decision.source === 'platform') {
          // 平台登记的赛事跳过前置筛选，直接去读详情
          trail.push(step('dedupe', 'platform'));
          afterFilter(row, url, decision, trail);
          row.filter = '平台条目，直接读详情';
        } else {
          if (arbitration?.promote) trail.push(step('dedupe', 'ambiguous', '规则拿不准，交 AI 裁决'), step('arbitrate', 'new', `${arbitration.label || arbitration.relation}｜${arbitration.reason || ''}`));
          else trail.push(step('dedupe', 'new'));
          if (arbitration?.promote) row.dup = `新（AI 裁决：${arbitration.label || arbitration.relation}）`;
          const note = `${KIND[decision.kind] || decision.kind || ''}${Number.isFinite(decision.confidence) ? ` ${Math.round(decision.confidence * 100)}%` : ''}：${decision.reason || ''}`;
          const outcome = decision.action === 'review' ? 'lead' : decision.action;
          if (decision.source === 'rule') {
            trail.push(step('rule', outcome, note));
          } else {
            trail.push(step('rule', 'pass'), step('jev', outcome, note));
          }
          afterFilter(row, url, decision, trail);
        }
      }
      row.trail = finalizeTrail(trail);
      rows.push(row);
    }
  }

  // 编号（2026-10-01，用户要求）：最开始的每一条信息源（含搜索时就丢弃的）依次编一级编号 1、2、3……；
  // 通知追溯搜到的页面挂在发起追溯的那条通知下面：12 → 12.1、12.2；再往下追溯的，以此类推：12.1 → 12.1.1。
  // 同一场比赛的多篇通知只搜一次，追溯结果挂在这一组里排第一的那篇下面，同组其他通知的路径里指向它。
  rows.forEach((row, index) => { row.no = String(index + 1); });
  const noOfUrl = new Map(rows.filter(row => row.url).map(row => [row.url, row.no]));
  const leadNo = new Map();            // 追溯到的页面网址 → 编号
  const groupNo = new Map();           // 通知网址 → { parent:一级编号, leads:[{url, no}] }
  for (const result of leads) {
    const parent = noOfUrl.get(result.noticeUrl);
    if (!parent) continue;
    const numbered = (result.leads || []).map((lead, i) => ({ url:lead.url, no:`${parent}.${i + 1}` }));
    for (const item of numbered) if (!leadNo.has(item.url)) leadNo.set(item.url, item.no);
    for (const notice of [{ url:result.noticeUrl }, ...(result.notices || [])]) if (!groupNo.has(notice.url)) groupNo.set(notice.url, { parent, leads:numbered });
  }
  // 通知这条在“通知追溯”环节的说明里写上追溯结果的编号
  for (const row of rows) {
    const traceStep = (row.trail || []).find(item => item.n === 'trace' && !item.virtual);
    const group = traceStep && groupNo.get(row.url);
    if (!group) continue;
    if (row.no === group.parent) { if (group.leads.length) traceStep.note = clip(`${traceStep.note}；追溯结果编号：${group.leads.map(item => item.no).join('、')}`, 400); }
    else traceStep.note = clip(`${traceStep.note}；同一场比赛的追溯结果挂在 #${group.parent} 下`, 400);
  }

  // 通知追溯找到的页面：原先不在表里，但“读了详情页”的数字算了它们，点进去对不上
  const followup = files['notice-followup-filter-report.json'] || {};
  const listedUrls = new Set(rows.map(row => row.url));
  for (const decision of followup.decisions || []) {
    if (!decision?.url || listedUrls.has(decision.url)) continue;
    listedUrls.add(decision.url);
    const row = { no:leadNo.get(decision.url) || '', source:'通知追溯', query:'', route:'通知追溯', title:clip(decision.title || decision.proposedName, 150), url:decision.url,
      intro:clip(decision.proposedName ? `追溯的上级赛事：${decision.proposedName}` : '', 160), dup:'', filter:ACTION[decision.action] || decision.action || '',
      kind:KIND[decision.kind] || decision.kind || '', reason:decision.reason || '', confidence:Number.isFinite(decision.confidence) ? decision.confidence : null,
      final:'', stage:3 };
    // 从“通知追溯”环节出来的页面：先补一条只用来画连线的路径（不算追溯环节处理了它）
    const trail = [step('trace', 'found', '', { virtual:true })];
    if (combinedUrls.has(decision.url)) {
      const outcomeRead = analyzeRead(decision.url);
      Object.assign(row, { final:outcomeRead.final, stage:4 });
      trail.push(step('followup', 'read', decision.source === 'notice_text' ? '通知正文里写出的网址，直接放行' : decision.reason || ''), ...outcomeRead.trail);
      const result = extractByUrl.get(decision.url) || {};
      if (result.reasoning?.text) row.thinking = String(result.reasoning.text);
    } else {
      // 没读的四种原因：把握低 / 通知类页面（标题含通知、选拔、喜报，或 Jev 判为通知）/ 转载新闻无关 / 判重已在库
      const noticeLike = decision.action === 'fetch' && (!['competition_site', 'registration_entry'].includes(decision.kind) || /通知|公告|通告|校级|校内|选拔|获奖|喜报/.test(decision.title || ''));
      const skip = decision.action === 'fetch' ? (noticeLike ? 'skip_notice' : 'skip_dup') : (decision.lowConfidence || decision.action === 'review') ? 'skip_low' : 'skip_news';
      const skipText = { skip_notice:'追溯页面：通知类页面或标题含通知/选拔/喜报，不读', skip_dup:'追溯页面：放行但库里已有或同批重复，不读', skip_low:'追溯页面：Jev 把握低，只留线索，未读', skip_news:'追溯页面：转载、新闻或无关，不再往下追，未读' }[skip];
      row.final = skipText;
      trail.push(step('followup', skip, `${skipText}｜${decision.reason || ''}`));
    }
    row.trail = finalizeTrail(trail);
    rows.push(row);
  }

  // 按编号排序（1、2、2.1、2.2、3……），追溯结果紧跟在发起追溯的那条后面；没有编号的排最后
  const noKey = no => String(no || '').split('.').map(part => part.padStart(6, '0')).join('.');
  rows.sort((a, b) => (a.no ? 0 : 1) - (b.no ? 0 : 1) || noKey(a.no).localeCompare(noKey(b.no)));
  const count = map => Object.fromEntries(Object.entries(map));
  const actions = {};
  for (const item of jev.decisions || []) actions[item.action] = (actions[item.action] || 0) + 1;
  return {
    id:runId,
    // 数据流图：环节、连线、各环节的流入数和处理结果数，都由每条比赛的 trail 算出
    flow:buildFlow(rows),
    summary:{
      searchResults:baidu.stats?.referencesTotal ?? null, queries:baidu.stats?.queries ?? (baidu.queries || []).length,
      dropped:baidu.droppedCount ?? (baidu.dropped || []).length,
      candidates:rows.filter(row => row.stage > 0).length,
      newCandidates:(jev.decisions || []).length, filter:count(actions),
      formalNotices:formal.length, detailRead:combined.length, extractOk:extracted.filter(item => item.ok).length,
      added:ingest.added ?? null, failureReasons:ingest.failureReasons || {},
    },
    rows,
    notices:leads.map(item => ({ no:noOfUrl.get(item.noticeUrl) || '', title:clip(item.noticeTitle, 150), url:item.noticeUrl, name:item.proposedName || '', query:item.followupQuery || '',
      leads:(item.leads || []).map(lead => ({ no:leadNo.get(lead.url) || '', title:clip(lead.title, 120), url:lead.url })),
      // 这一组搜了没有：用的哪个引擎、返回了什么、保留了哪几条；换过引擎或失败的，带上每次尝试
      search:item.search ? { engine:item.search.engine, label:item.search.label, returned:item.search.returned, kept:item.search.kept,
        results:(item.search.results || []).map(result => ({ no:result.kept ? (leadNo.get(result.url) || '') : '', title:clip(result.title, 120), url:result.url, kept:Boolean(result.kept) })),
        attempts:(item.searchAttempts || item.search.attempts || []).map(attempt => ({ label:attempt.label, ok:attempt.ok, returned:attempt.returned ?? null, error:attempt.error || '', usage:attempt.usage || null })) } : null,
      error:item.error || '' })),
    // 本轮各搜索引擎用了多少次、有没有被停用
    searchEngines:Array.isArray(files['notice-resolution-leads.json']?.engines) ? files['notice-resolution-leads.json'].engines : [],
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
