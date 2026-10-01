const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
export const JEV_MODEL = 'typesafe/jev-1.13';
export const DEFAULT_CONFIDENCE = 0.8;

export const JEV_CRITERIA = Object.freeze({
  competition_site:'当届大学生专业赛事官网或正式赛事详情页，不是新闻、通知、目录、校赛或兴趣活动',
  organizer_notice:'主办方或承办方发布的当届正式赛事通知，包含具体比赛信息，可作为核验证据但通知标题不可直接入赛事库',
  registration_entry:'当届赛事的官方报名平台或报名入口页面',
  directory_lead:'教育厅、学会或其他权威机构的省级赛事目录、项目清单或汇总页面，只作为进一步挖掘线索',
  repost_or_school_selection:'普通转载、学校组织报名通知、校级选拔或校内赛，不是上级赛事自身的官方入口',
  news_or_result:'获奖新闻、结果公示、决赛举行、启动开幕或赛后报道',
  unrelated:'中小学生赛事、兴趣娱乐、群众体育、网站栏目、培训或其他与大学生专业竞赛无关内容',
});

const DIRECTORY = /(?:竞赛|赛事|项目)(?:目录|清单)|有哪些(?:学科)?竞赛|竞赛项目的公示|竞赛项目目录/;
const SCHOOL_SELECTION = /校级选拔|校内选拔|校赛|院级选拔|院内选拔/;
const RESULT_NEWS = /(?:获|荣获).{0,35}(?:奖|金牌|银牌|铜牌)|(?:一等奖|二等奖|三等奖)|决赛.{0,18}(?:举行|落幕|闭幕|收官)|(?:启动|开幕)仪式|正式启动|正式开启|正式开赛|正式拉开帷幕|火热开启|隆重开幕/;
const COLUMN = /^(?:大赛动态|国赛公告|通知公告|竞赛分类[:：]?)$|学术资讯速递/;
const ORGANIZATION_ONLY = /^(?:中国|全国|[\u4e00-\u9fa5]{2,8}省|[\u4e00-\u9fa5]{2,8}市)?[\u4e00-\u9fa5]{2,25}(?:学会|协会|学院|研究院|教育厅|教育局)$/;

// 2026-09-29 起：只有“与赛事无关”的才丢弃。
// 校内选拔、学校转发、赛事新闻里都写着上级赛事的名字，往往还有官网网址，是找新赛事最好的线索，
// 改为 trace（追溯上级赛事的官网和当届官方通知），不再拦下丢掉；原先按标题含感叹号拦截的规则去掉。
export function deterministicCandidateDecision(candidate = {}) {
  const title = String(candidate.name || candidate.title || '').normalize('NFKC').trim();
  if (!title) return { action:'reject', kind:'column_other', confidence:1, source:'rule', reason:'标题为空' };
  if (SCHOOL_SELECTION.test(title)) return { action:'trace', kind:'repost_or_school_selection', confidence:1, source:'rule', reason:'校级或校内选拔：不入库，追溯上级赛事的官网和官方通知' };
  if (DIRECTORY.test(title)) return { action:'lead', kind:'directory_lead', confidence:1, source:'rule', reason:'目录或清单仅保留为发现线索' };
  if (RESULT_NEWS.test(title)) return { action:'trace', kind:'news_or_result', confidence:1, source:'rule', reason:'赛事报道：不入库，追溯赛事的官网和当届官方通知' };
  if (COLUMN.test(title)) return { action:'lead', kind:'column_lead', confidence:1, source:'rule', reason:'栏目页：不是具体赛事，留作信源线索' };
  if (ORGANIZATION_ONLY.test(title) && !/大赛|竞赛|比赛|挑战赛/.test(title)) return { action:'lead', kind:'organization_lead', confidence:1, source:'rule', reason:'机构名称：不是具体赛事，留作信源线索' };
  return null;
}

// 把握不到阈值的（原先一律 review：只进报告，之后没人看），但最倾向“赛事官网”或“报名入口”的放行去读：
// 读详情后还有范围检查和三项核验把关，读错的代价只是多花一次抽取；漏掉的却是真比赛
// （2026-09-30 那轮：生物制造大赛官网 66%、大学生英语翻译能力竞赛官网 40% 都因此没人读）。
// 其他类别（通知、转载、新闻……）把握不够的仍然搁置。2026-10-01 用户确认，方案 B。
export const LOW_CONFIDENCE_FETCH_KINDS = Object.freeze(['competition_site', 'registration_entry']);
function lowConfidenceOutcome(kind, confidence, threshold) {
  const fetchAnyway = LOW_CONFIDENCE_FETCH_KINDS.includes(kind);
  return {
    action:fetchAnyway ? 'fetch' : 'review',
    reason:fetchAnyway
      ? `Jev 置信度 ${confidence.toFixed(2)} 低于阈值 ${threshold.toFixed(2)}，但最像${kind === 'registration_entry' ? '报名入口' : '赛事官网'}，放行读详情，由后面的范围检查和核验把关`
      : `Jev 置信度 ${confidence.toFixed(2)} 低于阈值 ${threshold.toFixed(2)}，仅进人工线索报告`,
    lowConfidence:true,
  };
}

// 2026-10-01 起：不再看“第一名的概率够不够 80%”，改看“是不是赛事相关页面”和“哪一组更像”。
// 为什么：分类里的“主办方通知 / 学校转载 / 官网 / 报名入口”本来就互相重叠，一个页面常常同时符合几类，概率被分摊，
// 第一名只有 0.4～0.6，却被一律搁置（近 5 晚 802 条里 61% 低于 0.8，其中 76% 的“与赛事无关”概率不到 0.2——其实都是赛事相关页面）。
//   与赛事无关的概率 > 0.5：丢弃（招聘、招生、考博）；0.2～0.5：只留线索；< 0.2：当作赛事相关页面往下走：
//     官网 + 报名入口 + 主办方通知的概率合计 ≥ 学校转载 + 新闻的合计：读详情；否则追溯上级赛事。
//     目录清单的概率比这两组都高：只留线索。
// 回测（近 5 晚）：没有一条原来被放行的降级成搁置；只留线索从每晚约 89 条降到 19 条。
export const UNRELATED_REJECT = 0.5;
export const UNRELATED_LEAD = 0.2;
export function decideByProbabilities(probabilities = {}) {
  const pct = value => `${Math.round(value * 100)}%`;
  const unrelated = Number(probabilities.unrelated) || 0;
  if (unrelated > UNRELATED_REJECT) return { action:'reject', reason:`Jev 认为与赛事无关的概率 ${pct(unrelated)}，丢弃` };
  if (unrelated >= UNRELATED_LEAD) return { action:'lead', lowConfidence:true, reason:`Jev 认为与赛事无关的概率 ${pct(unrelated)}，拿不准，只留线索` };
  const official = (Number(probabilities.competition_site) || 0) + (Number(probabilities.registration_entry) || 0) + (Number(probabilities.organizer_notice) || 0);
  const repost = (Number(probabilities.repost_or_school_selection) || 0) + (Number(probabilities.news_or_result) || 0);
  const directory = Number(probabilities.directory_lead) || 0;
  const detail = `与赛事无关仅 ${pct(unrelated)}；官网/报名入口/主办方通知合计 ${pct(official)}，转载/新闻合计 ${pct(repost)}`;
  if (directory > official && directory > repost) return { action:'lead', reason:`Jev：目录清单概率最高（${pct(directory)}），只留线索` };
  return official >= repost
    ? { action:'fetch', reason:`Jev：${detail}，读详情` }
    : { action:'trace', reason:`Jev：${detail}，追溯上级赛事` };
}

function actionForKind(kind) {
  if (['competition_site','organizer_notice','registration_entry'].includes(kind)) return 'fetch';
  if (kind === 'directory_lead') return 'lead';
  // 转发、校内选拔、赛事新闻：能顺着找到上级赛事的官网和报名入口，留作追溯线索
  if (['repost_or_school_selection','news_or_result'].includes(kind)) return 'trace';
  if (kind === 'unrelated') return 'reject';
  return 'review';
}

function compactState(candidate = {}) {
  return {
    title:String(candidate.name || candidate.title || '').slice(0, 300),
    snippet:String(candidate.description || candidate.summary || candidate.content || candidate.introduction || '').slice(0, 1600),
    url:String(candidate.detailUrl || candidate.url || '').slice(0, 600),
    source:String(candidate.source || candidate.sourceName || '').slice(0, 120),
  };
}

export async function classifyCandidateWithJev(candidate, options = {}) {
  const rule = deterministicCandidateDecision(candidate);
  if (rule) return { candidate, ...rule, probabilities:null, cost:0 };

  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) {
    return { candidate, action:'fetch', kind:'jev_unavailable', confidence:0, source:'fallback', reason:'未配置 OpenRouter API Key，保持旧流程继续核验', probabilities:null, cost:0 };
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const response = await fetchImpl(options.endpoint || DECISIONS_URL, {
    method:'POST',
    headers:{ authorization:`Bearer ${apiKey}`, 'content-type':'application/json', 'x-title':'Competition Radar Crawler' },
    body:JSON.stringify({
      model:options.model || JEV_MODEL,
      state:compactState(candidate),
      questions:{ kind:{ type:'choice', instructions:'判断这个搜索结果页面的类型。只根据标题、摘要、网址和来源判断；不能把学校转载当成承办方正式通知。', criteria:JEV_CRITERIA } },
    }),
    signal:AbortSignal.timeout(options.timeoutMs || 20000),
  });
  if (!response.ok) throw new Error(`jev_http_${response.status}:${(await response.text()).slice(0, 200)}`);
  const payload = await response.json();
  const answer = payload?.answers?.kind;
  if (!answer?.choice || typeof answer.confidence !== 'number') throw new Error('jev_invalid_response');
  const confidence = Number(answer.confidence);
  const threshold = options.minConfidence ?? DEFAULT_CONFIDENCE;
  if (answer.probabilities && typeof answer.probabilities === 'object') {
    const decided = decideByProbabilities(answer.probabilities);
    return { candidate, action:decided.action, kind:answer.choice, confidence, source:'jev', reason:decided.reason, ...(decided.lowConfidence ? { lowConfidence:true } : {}), probabilities:answer.probabilities, cost:Number(payload?.usage?.cost || 0) };
  }
  if (confidence < threshold) {
    const low = lowConfidenceOutcome(answer.choice, confidence, threshold);
    return { candidate, action:low.action, kind:answer.choice, confidence, source:'jev', reason:low.reason, lowConfidence:true, probabilities:answer.probabilities || null, cost:Number(payload?.usage?.cost || 0) };
  }
  return { candidate, action:actionForKind(answer.choice), kind:answer.choice, confidence, source:'jev', reason:`Jev 分类为 ${answer.choice}`, probabilities:answer.probabilities || null, cost:Number(payload?.usage?.cost || 0) };
}

export async function filterCandidatesWithJev(candidates = [], options = {}) {
  const decisions = new Array(candidates.length);
  const pending = [];
  for (const [index, candidate] of candidates.entries()) {
    const rule = deterministicCandidateDecision(candidate);
    if (rule) decisions[index] = { candidate, ...rule, probabilities:null, cost:0 };
    else pending.push({ index, candidate });
  }
  const apiKey = String(options.apiKey || '').trim();
  const batchSize = Math.max(1, Math.min(8, options.batchSize || 8));
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    if (!apiKey) {
      for (const { index, candidate } of batch) decisions[index] = { candidate, action:'fetch', kind:'jev_unavailable', confidence:0, source:'fallback', reason:'未配置 OpenRouter API Key，保持旧流程继续核验', probabilities:null, cost:0 };
      continue;
    }
    try {
      const questions = Object.fromEntries(batch.map((_, i) => [
        `item_${i}`,
        { type:'choice', instructions:`判断 items[${i}] 的页面类型。只根据标题、摘要、网址、来源判断。学校转载不能当作主办方或承办方正式通知。`, criteria:JEV_CRITERIA },
      ]));
      const fetchImpl = options.fetchImpl || globalThis.fetch;
      const response = await fetchImpl(options.endpoint || DECISIONS_URL, {
        method:'POST', headers:{ authorization:`Bearer ${apiKey}`, 'content-type':'application/json', 'x-title':'Competition Radar Crawler' },
        body:JSON.stringify({ model:options.model || JEV_MODEL, state:{ items:batch.map(item => compactState(item.candidate)) }, questions }),
        signal:AbortSignal.timeout(options.timeoutMs || 20000),
      });
      if (!response.ok) throw new Error(`jev_http_${response.status}`);
      const payload = await response.json();
      for (const [i, { index, candidate }] of batch.entries()) {
        const answer = payload?.answers?.[`item_${i}`];
        if (!answer?.choice || typeof answer.confidence !== 'number') throw new Error('jev_invalid_response');
        const confidence = Number(answer.confidence);
        const threshold = options.minConfidence ?? DEFAULT_CONFIDENCE;
        const cost = Number(payload?.usage?.cost || 0) / batch.length;
        if (answer.probabilities && typeof answer.probabilities === 'object') {
          const decided = decideByProbabilities(answer.probabilities);
          decisions[index] = { candidate, action:decided.action, kind:answer.choice, confidence, source:'jev', reason:decided.reason, ...(decided.lowConfidence ? { lowConfidence:true } : {}), probabilities:answer.probabilities, cost };
          continue;
        }
        // 没有概率分布时（接口没给）退回按第一名把握判断
        const low = confidence < threshold ? lowConfidenceOutcome(answer.choice, confidence, threshold) : null;
        const action = low ? low.action : actionForKind(answer.choice);
        decisions[index] = { candidate, action, kind:answer.choice, confidence, source:'jev', reason:low ? low.reason : `Jev 分类为 ${answer.choice}`, ...(low ? { lowConfidence:true } : {}), probabilities:null, cost };
      }
    } catch (error) {
      for (const { index, candidate } of batch) decisions[index] = { candidate, action:'fetch', kind:'jev_error', confidence:0, source:'fallback', reason:`Jev 批量调用失败，保持旧流程继续核验：${String(error?.message || error).slice(0, 180)}`, probabilities:null, cost:0 };
    }
  }
  return {
    decisions,
    fetch:decisions.filter(item => item.action === 'fetch').map(item => item.candidate),
    leads:decisions.filter(item => item.action === 'lead' || item.action === 'review').map(item => item.candidate),
    trace:decisions.filter(item => item.action === 'trace').map(item => item.candidate),
    rejected:decisions.filter(item => item.action === 'reject').map(item => item.candidate),
    cost:decisions.reduce((sum, item) => sum + Number(item.cost || 0), 0),
  };
}
