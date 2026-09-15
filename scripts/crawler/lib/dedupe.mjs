// 候选赛事与库中已有赛事的比对。
//
// 发现新赛事不难，难的是判断「这条是不是已经有了」。三种情况必须分开：
//   1. 已有赛事的新一届  —— 「第十九届挑战杯」对应库里的「挑战杯」
//   2. 已有赛事改了名     —— 「中国国际大学生创新大赛」就是原「互联网+」
//   3. 真·新赛事
//
// 字符串匹配对第 2 种完全无效（改名前后一个字都不一样），所以这里只做
// 规则能确定的部分，把拿不准的标成 uncertain 交给人工或 AI —— 不是硬猜。
//
// 阈值刻意保守：误判为「新赛事」只是多一条待审记录，
// 误判为「重复」会把两个不同的赛事合并，污染数据且很难发现。

// 届次、年份、引号、括号都不参与判重：它们区分的是「哪一届」，不是「哪个赛事」。
const ORDINAL = /第\s*[0-9一二三四五六七八九十百千零两]+\s*[届期]/g;
const YEAR = /(19|20)\d{2}\s*(年度|年)?/g;
const QUOTES = /[“”"'‘’《》「」【】\[\]]/g;
const BRACKETED = /[（(][^）)]*[）)]/g;
const SPACES = /[\s　]+/g;

export function normalizeName(name) {
  return String(name || '')
    .replace(BRACKETED, '')
    .replace(ORDINAL, '')
    .replace(YEAR, '')
    .replace(QUOTES, '')
    .replace(SPACES, '')
    .toLowerCase()
    .trim();
}

// 中文没有空格分词，用字符二元组比按词切更稳。
export function bigrams(text) {
  const value = normalizeName(text);
  if (value.length < 2) return value ? new Set([value]) : new Set();
  const out = new Set();
  for (let i = 0; i < value.length - 1; i += 1) out.add(value.slice(i, i + 2));
  return out;
}

// Dice 系数：0 完全不同，1 完全一致。
export function nameSimilarity(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

// 判定阈值。调高 = 更多条目落到人工，调低 = 更容易错误合并。
export const DUPLICATE_THRESHOLD = 0.82;
export const UNCERTAIN_THRESHOLD = 0.55;

// masters: [{ id, standard_name, aliases: [], website_url, sourceHosts: [] }]
export function matchCandidate(candidate, masters = []) {
  const candidateName = String(candidate?.name || '');
  const candidateHost = hostOf(candidate?.detailUrl);
  if (!normalizeName(candidateName)) {
    return { verdict:'invalid', matchedId:null, confidence:0, reason:'候选没有可用名称' };
  }

  let best = { master:null, score:0, reason:'' };
  for (const master of masters) {
    const names = [master.standard_name, ...(master.aliases || [])].filter(Boolean);
    for (const name of names) {
      // 规范化后完全相同：同一赛事的不同届次或不同写法
      if (normalizeName(name) === normalizeName(candidateName)) {
        return {
          verdict:'duplicate',
          matchedId:master.id,
          confidence:1,
          reason:`名称规范化后与「${name}」完全一致`,
        };
      }
      const score = nameSimilarity(name, candidateName);
      if (score > best.score) best = { master, score, reason:`与「${name}」相似度 ${score.toFixed(2)}` };
    }
  }

  // 域名相同是很强的信号，但不能单独定案：一个主办方站点下可能办多个赛事。
  const hosts = new Set();
  for (const master of masters) {
    for (const url of [master.website_url, ...(master.sourceHosts || [])]) {
      const host = hostOf(url) || String(url || '').toLowerCase();
      if (host) hosts.add(`${master.id}::${host}`);
    }
  }
  const hostMatch = candidateHost
    ? [...hosts].find(entry => entry.endsWith(`::${candidateHost}`))
    : null;

  if (best.score >= DUPLICATE_THRESHOLD) {
    return { verdict:'likely_duplicate', matchedId:best.master.id, confidence:best.score, reason:best.reason };
  }
  if (hostMatch) {
    const masterId = hostMatch.split('::')[0];
    return {
      verdict:'uncertain',
      matchedId:masterId,
      confidence:Math.max(best.score, 0.5),
      reason:`同域名 ${candidateHost}，但名称不匹配（${best.reason || '无相近名称'}）`,
    };
  }
  if (best.score >= UNCERTAIN_THRESHOLD) {
    return { verdict:'uncertain', matchedId:best.master.id, confidence:best.score, reason:best.reason };
  }
  return {
    verdict:'new',
    matchedId:null,
    confidence:1 - best.score,
    reason:best.master ? `最接近的是${best.reason}，低于判重阈值` : '库中没有相近名称',
  };
}

export function classifyCandidates(candidates = [], masters = []) {
  const buckets = { duplicate:[], likely_duplicate:[], uncertain:[], new:[], invalid:[] };
  for (const candidate of candidates) {
    const match = matchCandidate(candidate, masters);
    buckets[match.verdict].push({ candidate, match });
  }
  return buckets;
}
