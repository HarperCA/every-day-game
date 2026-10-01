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

// 同一个比赛常常同时存在校赛、省赛、国赛：名字几乎一样，
// 但报名时间、评分标准、进入难度、含金量都不同。
// 这三种既不能合并成一条（用户报的是他那一层），也不是三个不同的赛事。
const SCOPE_PREFIX = /^(全国|中国|国际|世界|亚洲)/;
const TIER_MARKERS = [
  { pattern:/(省赛|省级选拔赛|省级复赛|省赛区)/, tier:'省级' },
  { pattern:/(校赛|校内选拔赛|校级选拔)/, tier:'校级' },
  { pattern:/(赛区|分区赛|区域赛|大区赛)/, tier:'区域级' },
  { pattern:/(全国总决赛|全国决赛|国赛)/, tier:'全国' },
];
// 顺序即优先级。学校那条必须排除「大学生」——
// 否则「全国大学生数学建模竞赛」里的「大学」会被当成校名。
const REGION_PREFIXES = [
  { pattern:/^(.{2,7}?(?:省|自治区|特别行政区))/, tier:'省级' },
  { pattern:/^(.{2,6}?市)/, tier:'省级' },
  { pattern:/^(.{2,6}?赛区)/, tier:'区域级' },
  { pattern:/^(.{2,12}?(?:大学|学院|学校))(?!生)/, tier:'校级' },
];

// 返回层级与地域，并给出剥掉层级限定后的「赛事本体名」。
// 本体名用来判断两条记录是不是同一个比赛的不同层级。
export function detectTier(name) {
  let core = normalizeName(name);
  let tier = '';
  let region = '';

  // 先剥「全国/中国」这类范围限定，否则它会干扰后面的地域识别
  const scope = SCOPE_PREFIX.exec(core);
  if (scope) {
    core = core.slice(scope[1].length);
    tier = '全国';
  }

  for (const marker of TIER_MARKERS) {
    if (marker.pattern.test(core)) { tier = marker.tier; break; }
  }

  for (const prefix of REGION_PREFIXES) {
    const hit = prefix.pattern.exec(core);
    if (hit) {
      region = hit[1];
      core = core.slice(hit[1].length);
      if (!tier || tier === '全国') tier = prefix.tier;
      break;
    }
  }

  for (const marker of TIER_MARKERS) core = core.replace(marker.pattern, '');
  return { core, tier, region };
}

export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

// 判定阈值。调高 = 更多条目落到人工，调低 = 更容易错误合并。
// 包含匹配的最短长度：短名称（如「挑战杯」）会同时命中多个不同赛事。
export const MIN_CONTAINMENT_LENGTH = 6;
// 比对网址用的规范形式：不分 http/https、忽略 www、结尾斜杠和 # 锚点，保留路径和查询参数（平台靠参数区分比赛）。
export function urlKey(url) {
  try {
    const u = new URL(String(url || ''));
    if (!/^https?:$/.test(u.protocol)) return '';
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch { return ''; }
}

// 只比网址：候选的网址和库里（或本轮已排队的）某场赛事的来源网址完全相同才算重复，不看名字。
// 给“通知正文里写出的官网”用（2026-10-01）：名字相似度对它们不可靠——
// “中国大学生材料热处理创新创业大赛”和“中国大学生服务外包创新创业大赛”相似度 0.62，是两场不同的比赛，却被判成拿不准丢掉。
export function matchByUrlOnly(candidate, masters = []) {
  const key = urlKey(candidate?.detailUrl);
  if (!key) return null;
  for (const master of masters) {
    if ((master.sourceUrls || [master.website_url]).some(url => urlKey(url) === key)) return master;
  }
  return null;
}

export const DUPLICATE_THRESHOLD = 0.82;
export const UNCERTAIN_THRESHOLD = 0.55;

// masters: [{ id, standard_name, aliases: [], website_url, sourceHosts: [] }]
export function matchCandidate(candidate, masters = []) {
  const candidateName = String(candidate?.name || '');
  if (!normalizeName(candidateName)) {
    return { verdict:'invalid', matchedId:null, confidence:0, reason:'候选没有可用名称' };
  }

  // 网址完全相同才算重复（2026-09-29 起替代原来的“同域名 → 拿不准”）：
  // 天池、DataFountain 这类平台上挂着几百场比赛，同一个网站说明不了是同一场，
  // 原规则让平台上的新比赛每晚都被当成“拿不准”跳过。平台上每场比赛网址各不相同，网址一致才是可靠信号。
  const candidateUrl = urlKey(candidate?.detailUrl);
  if (candidateUrl) {
    for (const master of masters) {
      if ((master.sourceUrls || [master.website_url]).some(url => urlKey(url) === candidateUrl)) {
        return { verdict:'duplicate', matchedId:master.id, confidence:1, reason:`网址与「${master.standard_name}」的来源完全相同` };
      }
    }
  }

  const normalizedCandidate = normalizeName(candidateName);
  let best = { master:null, score:0, reason:'' };
  // 赛事名被长标题包住的情况：新闻标题「XX大赛决赛在YY大学成功举办」里嵌着完整赛事名，
  // 但前后文本会把相似度稀释到阈值以下。这类必须靠包含匹配，不能靠相似度。
  let contained = { master:null, name:'', length:0 };

  for (const master of masters) {
    const names = [master.standard_name, ...(master.aliases || [])].filter(Boolean);
    for (const name of names) {
      const normalizedName = normalizeName(name);
      // 规范化后完全相同：同一赛事的不同届次或不同写法
      if (normalizedName === normalizedCandidate) {
        return {
          verdict:'duplicate',
          matchedId:master.id,
          confidence:1,
          reason:`名称规范化后与「${name}」完全一致`,
        };
      }
      // 包含匹配只用标准名，不用别名：标准名带「全国」这类限定词，
      // 而别名是简称 ——「四川省大学生物理实验竞赛」会包含别名「物理实验竞赛」，
      // 那样就把省赛吞进国赛了。太短的标准名同样跳过。
      if (name === master.standard_name
        && normalizedName.length >= MIN_CONTAINMENT_LENGTH
        && normalizedCandidate.includes(normalizedName)
        && normalizedName.length > contained.length) {
        contained = { master, name, length:normalizedName.length };
      }
      const score = nameSimilarity(name, candidateName);
      if (score > best.score) best = { master, score, reason:`与「${name}」相似度 ${score.toFixed(2)}` };
    }
  }

  if (contained.master) {
    return {
      verdict:'duplicate',
      matchedId:contained.master.id,
      confidence:1,
      reason:`标题中完整包含「${contained.name}」`,
    };
  }

  // 剥掉层级和地域限定后再比一次：命中说明是同一个比赛的另一层级。
  // 这类必须单独成条（报名时间、评分标准、进入难度都不同），
  // 但要挂在同一个赛事下，而不是当成互不相干的新赛事。
  const candidateTier = detectTier(candidateName);
  if (candidateTier.tier && candidateTier.core.length >= MIN_CONTAINMENT_LENGTH) {
    for (const master of masters) {
      const masterCore = detectTier(master.standard_name).core;
      if (masterCore.length >= MIN_CONTAINMENT_LENGTH && masterCore === candidateTier.core) {
        return {
          verdict:'same_event_other_tier',
          matchedId:master.id,
          confidence:1,
          tier:candidateTier.tier,
          region:candidateTier.region,
          reason:`与「${master.standard_name}」是同一赛事的${candidateTier.tier}层级${candidateTier.region ? `（${candidateTier.region}）` : ''}`,
        };
      }
    }
  }

  if (best.score >= DUPLICATE_THRESHOLD) {
    return { verdict:'likely_duplicate', matchedId:best.master.id, confidence:best.score, reason:best.reason };
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
  const buckets = { duplicate:[], same_event_other_tier:[], likely_duplicate:[], uncertain:[], new:[], invalid:[] };
  for (const candidate of candidates) {
    const match = matchCandidate(candidate, masters);
    buckets[match.verdict].push({ candidate, match });
  }
  return buckets;
}
