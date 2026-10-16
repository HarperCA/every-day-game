// 通知追溯前查库（2026-10-12，用户定）：派 Kimi 代理去追溯之前，先认出通知背后是哪场比赛，库里已有当届的就不派代理。
//
// 为什么：判重拿去比的是网页标题，而通知标题夹着学校、学院、“关于举办……院级选拔赛的通知”，比赛名被稀释，
// 相似度到不了阈值（“巢湖学院第十二届‘挑战杯’……院级选拔赛的通知”和库里的“挑战杯”只有 0.49），
// 有的标题根本没写比赛名（“教科成果”）。结果是代理花几万到十几万 token 找出来，才发现库里早有：
// 10/11、10/12 两晚代理找到的 55 个官方来源里 19 个库里已有（“挑战杯”追了 3 次），用掉 72 万 token。
//
// 做法：
//   1. 认名字：每 20 篇一批交给 DeepSeek-Flash，认出通知背后的比赛（校内选拔、赛区通知认上级比赛）。
//      它要同时给出通知原文里写这个比赛的片段（evidence），代码逐字核对标题和摘要，对不上的不算。
//   2. 查库：用判重规则（matchCandidate）比；判为重复（名称规范化后一致、或包含库里的标准名）的跳过，不管库里那条是当届还是已归档。
//      和代理之后原有的两道判重一致：代理找到的官网按网址比、入库时按同名比，库里已有的（含已归档）都会被挡掉，派代理也是白找。
//      很可能重复（相似度 ≥ 0.82）、同一赛事的其他层级（省赛对国赛）、拿不准的，照常追溯。
//   3. 同一晚同名的只追一次。
//   认不出、核对不上、调用失败的一律照常交给代理，不会因为这一步漏掉。
const MODEL = 'deepseek-flash';
const BATCH = 10;

const compact = text => String(text || '').normalize('NFKC').replace(/[\s"“”'‘’「」『』《》〈〉()（）【】\[\]·•・,，.。:：;；!！?？、\-—_]/g, '');

function prompt(batch) {
  return [
    '下面是一批大学生竞赛相关的网页（多半是学校转发的通知、校内选拔、赛果新闻），每条有编号、标题和摘要。',
    '请逐条认出这条网页主要讲的是哪一场比赛（标题里写了比赛的，以标题为准；摘要里顺带提到的其他比赛不算）：',
    '- 校内选拔、院赛、赛区通知、学校转发的，写它对应的上级比赛（全国赛或省赛）的通用名称，不写学校名。',
    '- 名称去掉年份、届次（“2026年”“第十二届”）和“通知”等字样，例如“‘挑战杯’全国大学生课外学术科技作品竞赛”“全国大学生数学竞赛”。',
    '- evidence 必须是从这条的标题或摘要里原样复制的一段文字（8～40 字），里面写着这个比赛的名字，用来核对；复制不出来就不要填 name。',
    '- 不是比赛（奖学金、招生、讲座、教师赛、职工技能竞赛等）或看不出是哪场比赛的，name 留空字符串。',
    '- kind：是面向大学生的比赛填 competition；明显不是比赛（奖学金、招生、讲座、教师赛、职工技能竞赛、中小学比赛等）填 not_competition；看不出填 unclear。',
    '- edition_year：原文写明的届次年份（如 2026），没写留空。',
    '只输出一个 JSON 对象：{"items":[{"i":编号,"name":"比赛名或空","evidence":"原文片段或空","kind":"competition|not_competition|unclear","edition_year":""}]}，每条都要有。',
    '',
    ...batch.map(({ i, notice }) => `${i}. 标题：${String(notice.name || '').slice(0, 120)}\n   摘要：${String(notice.introduction || '').replace(/\s+/g, ' ').slice(0, 300)}`),
  ].join('\n');
}

// 认名字：返回 Map(下标 → { name, evidence })；整批失败的那一批不返回（照常追溯）
export async function extractContestNames(notices, { key, fetchImpl = globalThis.fetch, model = MODEL, batchSize = BATCH, log = () => {} } = {}) {
  const names = new Map();
  if (!key) { log('追溯前查库：没有 DeepSeek 密钥，跳过这一步'); return names; }
  for (let start = 0; start < notices.length; start += batchSize) {
    const batch = notices.slice(start, start + batchSize).map((notice, offset) => ({ i:start + offset, notice }));
    // 失败（含返回的 JSON 不完整）重试一次
    for (let attempt = 0; attempt < 2; attempt += 1) try {
      // 关掉思考：认名字很简单；开着思考时思考过程会占掉输出上限，实测 8 批里 4 批返回的 JSON 被截断（2026-10-12）
      const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
        method:'POST', headers:{ authorization:`Bearer ${key}`, 'content-type':'application/json' },
        body:JSON.stringify({ model, max_tokens:4000, thinking:{ type:'disabled' }, response_format:{ type:'json_object' },
          messages:[{ role:'system', content:'你是严谨的竞赛信息核对员，只依据给出的文字判断，看不出就留空，不编造。只输出 JSON。' }, { role:'user', content:prompt(batch) }] }),
        signal:AbortSignal.timeout(120000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`http_${response.status} ${JSON.stringify(data).slice(0, 160)}`);
      const content = String(data.choices?.[0]?.message?.content || '');
      const parsed = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
      for (const item of parsed.items || []) {
        const i = Number(item?.i);
        if (Number.isInteger(i) && i >= start && i < start + batch.length) names.set(i, { name:String(item.name || '').trim(), evidence:String(item.evidence || '').trim(),
          kind:['competition', 'not_competition', 'unclear'].includes(item.kind) ? item.kind : 'unclear', editionYear:String(item.edition_year || '').match(/20\d{2}/)?.[0] || '' });
      }
      break;
    } catch (error) {
      if (attempt) log(`追溯前查库：第 ${start + 1}～${start + batch.length} 篇认名字失败，这批照常追溯（${String(error?.message || error).slice(0, 160)}）`);
    }
  }
  return names;
}

// 认出的名字要有原文依据：
//   1. 片段要真在标题或摘要里（忽略空格和标点）。
//   2. 名字的主体词大部分要出现在原文里：去掉“全国、大学生、竞赛”这类泛称后，主体的相邻两字组合至少六成能找到
//      （“‘挑战杯’全国大学生课外学术科技作品竞赛”对“巢湖学院第十二届‘挑战杯’大学生课外学术科技作品竞赛”：10 组里 9 组在）。
//      标题里本身写了比赛的，拿标题来比，不管片段出自哪里：摘要里常顺带提到别的比赛（“北京市大学生生物学竞赛”的摘要里
//      提到“全国大学生生命科学竞赛”，实测被认成后者、按库里已有跳过）；标题没写比赛的（“教科成果”“学院新闻”）拿片段来比。
const GENERIC = /(全国|中国|国际|全球|大学生|研究生|高校|竞赛|大赛|比赛|挑战赛|赛道|年度)/g;
const TITLE_NAMES_CONTEST = /竞赛|大赛|比赛|挑战赛|锦标赛/;
function coverage(name, text) {
  const core = compact(name).replace(GENERIC, '');
  if (core.length < 2) return 0;
  const pairs = Array.from({ length:core.length - 1 }, (_, i) => core.slice(i, i + 2));
  return pairs.filter(pair => text.includes(pair)).length / pairs.length;
}
export function evidenceHolds(notice, item) {
  const evidence = compact(item?.evidence);
  if (evidence.length < 4 || !compact(`${notice.name || ''}${notice.introduction || ''}`).includes(evidence)) return false;
  return coverage(item.name, TITLE_NAMES_CONTEST.test(String(notice.name || '')) ? compact(notice.name) : evidence) >= 0.6;
}

// 地区、层级对不上（regions 是 dedupe.mjs 的 regionsOf）：名字里的省市在原文片段里没有；或名字是全国/国际级、片段却只写了某个省市。
// 只比地区和层级，不比整段文字（片段常是整个标题，带着“校内选拔赛”“拟获奖名单公示”，比整段会全部对不上）
const NATIONAL = /全国|中国|国际|全球|世界/;
export function levelConflict(evidence, name, regions) {
  const inName = regions(name), inEvidence = regions(evidence);
  for (const region of inName) if (!inEvidence.has(region)) return `名字里的地区「${region}」原文里没有`;
  if (NATIONAL.test(name) && !inName.size && inEvidence.size && !NATIONAL.test(evidence)) return `原文写的是${[...inEvidence].join('、')}的比赛，认成了全国/国际级`;
  return '';
}

// 纯函数：决定哪些通知派代理、哪些跳过。match 是 dedupe.mjs 的 matchCandidate；masters 是库里赛事主条目（带 recordIds）
// regions 是 dedupe.mjs 的 regionsOf：原文片段和认出的名字地区或层级对不上的（片段写“北京市××竞赛”、认成“全国××竞赛”）不算，照常追溯
export function precheckNotices(notices, names, { masters = [], recordsById = new Map(), match, regions = () => new Set(), normalize = compact } = {}) {
  const toTrace = [];
  const skipped = [];
  const checked = [];
  const named = []; // 继续追溯、而且认出了名字的，连同名字交给固定步骤（notice-resolver.mjs）
  const unnamed = []; // 继续追溯、但认不出或核对不上的，直接交给代理
  const seen = new Map();
  notices.forEach((notice, i) => {
    const item = names.get(i);
    const mismatch = item?.name ? (!evidenceHolds(notice, item) ? 'evidence_mismatch' : levelConflict(item.evidence, item.name, regions) ? 'level_conflict' : '') : 'no_name';
    if (mismatch) {
      checked.push({ url:notice.detailUrl, title:notice.name, name:item?.name || '', result:mismatch });
      toTrace.push(notice);
      unnamed.push({ notice, kind:item?.kind || 'unclear' });
      return;
    }
    const key = normalize(item.name);
    const result = match({ name:item.name, detailUrl:notice.detailUrl }, masters);
    const master = result.verdict === 'duplicate' ? masters.find(entry => entry.id === result.matchedId) : null;
    if (master) {
      const records = (master.recordIds || []).map(id => recordsById.get(id)).filter(Boolean);
      const entry = { url:notice.detailUrl, title:notice.name, name:item.name, evidence:item.evidence, kind:'in_library',
        matched:{ id:master.id, name:master.standard_name, records:records.map(record => ({ id:record.id, dataStatus:record.dataStatus, editionName:record.editionName || '' })) },
        reason:`库里已有「${master.standard_name}」（${records.map(record => record.dataStatus).join('、') || '记录'}）：${result.reason}` };
      skipped.push(entry); checked.push({ ...entry, result:'in_library' });
      return;
    }
    if (seen.has(key)) {
      const entry = { url:notice.detailUrl, title:notice.name, name:item.name, evidence:item.evidence, kind:'same_night',
        reason:`同一晚已有通知在追溯「${item.name}」：${String(seen.get(key)).slice(0, 60)}` };
      skipped.push(entry); checked.push({ ...entry, result:'same_night' });
      return;
    }
    seen.set(key, notice.name);
    checked.push({ url:notice.detailUrl, title:notice.name, name:item.name, result:result.verdict });
    toTrace.push(notice);
    named.push({ notice, name:item.name, evidence:item.evidence, kind:item.kind || 'unclear', editionYear:item.editionYear || '' });
  });
  return { toTrace, skipped, checked, named, unnamed };
}
