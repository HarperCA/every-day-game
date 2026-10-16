// 抓取流水线的数据流图（2026-10-01 起，后台“抓取结果账 → 查看明细”顶部的流程图）。
//
// 流程图里每个方框是一个环节，标明是“系统规则”还是“AI”；点方框能看到流进这个环节的比赛，
// 以及这个环节处理之后各去了哪。图上所有数字都由每条比赛自己的“经过路径”（trail）算出来，
// 所以点开的清单条数一定和图上的数字一致，不会各算各的。
//
// trail 的格式：[{ n:环节, o:这个环节的处理结果, note:说明, virtual?:true }, ...]
//   - virtual 只用来画连线（通知追溯找到的页面，从“通知追溯”环节出来），不算这个环节处理了它。
//   - 结果落到“结束”环节（end_*）的，由 finalizeTrail 在末尾补一条结束记录。

// kind：system 系统规则；ai 用了 AI；end 结束（不再往下走）。tone 只给结束环节用，决定颜色。
const NODES = {
  search:{ label:'搜索', kind:'ai', who:'百度 AI 搜索（第三方搜索引擎）',
    desc:'按当晚的搜索计划搜出候选；搜索脚本自己会先丢掉不在收录范围、与竞赛无关、同轮重复的。',
    outcomes:{ ok:{ label:'成为候选', to:'dedupe' }, dropped:{ label:'搜索时丢弃', to:'end_dropped' } } },
  platforms:{ label:'平台抓取', kind:'system', who:'天池、辽宁平台（读平台接口）',
    desc:'平台上登记的赛事本身就是结构化条目，直接读接口，不用 AI 判断“这是什么网页”。固定来源（天池、辽宁平台）每 7 天才抓一次，其余晚上不抓；百度搜索每晚都跑。',
    outcomes:{ ok:{ label:'成为候选', to:'dedupe' } } },
  dedupe:{ label:'判重\n近期被拒记忆', kind:'system', who:'系统规则',
    desc:'和库里全部赛事比对（网址完全一致、名字规范化后一致或相似）；名字里地区、层级不同的判为不同比赛；30 天内被拒过的网址也在这里跳过。平台条目只按网址判重。'
      + '规则拿不准的（名字像但说不清，或库里只有往届旧记录、页面可能是新一届）转交下一环节的 AI 裁决。',
    outcomes:{ new:{ label:'是新的，进前置筛选', to:'rule' }, ambiguous:{ label:'规则拿不准，交 AI 裁决', to:'arbitrate' },
      platform:{ label:'平台条目，直接读详情', to:'read' }, platform_unread:{ label:'平台条目，本轮没读', to:'end_lead' },
      skip:{ label:'已在库或近期被拒，跳过', to:'end_dup' } } },
  arbitrate:{ label:'判重裁决', kind:'ai', who:'DeepSeek（读标题、摘要和库里相关记录的届次、状态，判断是不是同一场）',
    desc:'把情况讲清楚给 AI：库里那几条是往届还是当前这一届，页面是官网、通知还是学校转发。结论五选一，把握不到 0.6 按“看不出”处理。'
      + '不是同一场、或是同一场的新一届，继续往下走；新一届入库后替代库里已归档的往届记录。同一届重复、下级通知、看不出的跳过。',
    outcomes:{ new:{ label:'不是同一场或是新一届，进前置筛选', to:'rule' }, skip:{ label:'同一届重复、下级通知或看不出，跳过', to:'end_ai_dup' } } },
  rule:{ label:'前置筛选\n标题规则', kind:'system', who:'系统规则（看标题）',
    desc:'标题特征明显的先处理：目录清单、校赛校选、赛事新闻、栏目页、只有机构名；标题只有日期、时间、地名的（没有信息量）不读详情，只当追溯线索。没命中的交给下一环节的 AI。',
    outcomes:{ pass:{ label:'没命中，交给 AI', to:'jev' }, trace:{ label:'追溯上级赛事', to:'trace' },
      notice:{ label:'标题是通知，转去追溯', to:'trace' }, lead:{ label:'目录/栏目，只留线索', to:'end_lead' }, reject:{ label:'丢弃', to:'end_rejected' } } },
  jev:{ label:'前置筛选\nJev 分类', kind:'ai', who:'Jev（OpenRouter 上的小分类模型），只看标题、摘要、网址，不读网页',
    desc:'Jev 给出每一类的概率。先看“与赛事无关”：> 50% 丢弃，20%～50% 只留线索；其余当作赛事相关页面：官网、报名入口、主办方通知合计更高的读详情，学校转载、新闻合计更高的追溯上级赛事，目录清单最高的只留线索。',
    outcomes:{ fetch:{ label:'放行读详情', to:'read' }, notice:{ label:'放行，但标题是通知，转去追溯', to:'trace' },
      unreadable:{ label:'放行，但网站读不了（微信等），转去追溯', to:'trace' },
      fetch_unread:{ label:'放行但本轮没读', to:'end_lead' }, trace:{ label:'转载/新闻，追溯上级赛事', to:'trace' },
      lead:{ label:'拿不准或目录，只留线索', to:'end_lead' }, reject:{ label:'与赛事无关，丢弃', to:'end_rejected' } } },
  // 2026-10-10 用户定：原“通知追溯”“追溯页面筛选”两个环节合成一个 AI 代理（Kimi API），代理自己判断找到的是不是官方来源
  // 2026-10-12 起分三段：追溯前查库 → 固定步骤 → 代理兜底（只处理固定步骤没核到的）。为不改动流程图版面，仍是一个环节，各段的结果分开列
  trace:{ label:'通知追溯\n固定步骤+代理', kind:'ai', who:'DeepSeek 认比赛名查库；固定步骤（Kimi 搜索 + 读网页 + DeepSeek 核对原文）；没核到的交给 Codex 代理（GPT-6.1-Sol，推理 xhigh）',
    desc:'① 追溯前查库：用 DeepSeek 认出每篇通知背后的比赛，库里已有的、同一晚已在追的不再追。'
      + '② 固定步骤：官网记忆里有的直接读；否则按“比赛名 年份 通知”“比赛名 官网”两个搜索词搜，按网站类型和标题打分挑前两个，读正文（PDF、空壳页都能读），'
      + '交给 DeepSeek 一次核对是不是官方来源并摘出主办、参赛对象、届次、报名时间，代码逐字核对原文；主办方和参赛对象或报名截止核到、而且是当届的，算找到官方来源。'
      + '③ 代理兜底：没核到的连同试过什么交给 Kimi 代理，读网页同样只给核对过的要点；核到就让它收尾；结论里的来源由代码复核，没读到正文、转载站、摘录对不上原文的去掉。'
      + '每晚代理 token 上限 150 万，每篇最多 6 轮、6 万 token；没轮上的第二天再来。每篇的结论、理由、搜索和读网页都记在明细里。',
    outcomes:{ found:{ label:'代理找到官方来源，读详情', to:'read' }, found_fixed:{ label:'固定步骤核到官方来源，读详情', to:'read' },
      skip_dup:{ label:'找到了，但库里已有或同批重复，不读', to:'end_trace_skip' },
      known:{ label:'追溯前查库：库里已有或同一晚已在追，不再追', to:'end_trace_skip' },
      notcomp_fixed:{ label:'固定步骤：两次都判为不是比赛', to:'end_trace_none' },
      none:{ label:'代理有结论：不是比赛、只是赛区/校赛、找不到或读不出（含来源没通过代码复核）', to:'end_trace_none' },
      noquota:{ label:'没轮上（token 或 Kimi 额度用完）或代理出错', to:'end_trace_none' },
      noname:{ label:'提不出合法赛事名，没搜（旧版追溯）', to:'end_trace_none' },
      skip_low:{ label:'旧版：Jev 把握低，只留线索', to:'end_trace_skip' }, skip_notice:{ label:'旧版：通知类页面，不读', to:'end_trace_skip' },
      skip_news:{ label:'旧版：转载、新闻或无关，不读', to:'end_trace_skip' } } },
  read:{ label:'读详情页', kind:'system', who:'下载网页，检查是不是空壳、是不是允许抓取；空壳页用 Kimi 读网页接口重读；缺关键信息时补读正式通知、识别页面图片',
    desc:'遵守 robots.txt。抓到的是导航骨架（空壳页，前后端分离的官网常见）时，用 Kimi 会员通道的读网页接口在服务端执行脚本后重读一次（每轮最多 20 条，robots 不允许的站不读）；重读还是骨架就不往下走。PDF、Word 附件会读出文字。'
      + '读完参赛对象或报名时间还缺的：先按页面里的公告标题搜官网自己的正式通知，读了合在一起重抽（文字，可逐字核对）；仍缺的再把页面大图交给 DeepSeek 识别文字，靠图片补出的项整条转人工审核。',
    outcomes:{ ok:{ label:'读到正文', to:'extract' }, fail:{ label:'读取失败', to:'end_readfail' } } },
  extract:{ label:'抽取字段', kind:'ai', who:'DeepSeek（读正文，摘出比赛全称、主办方、日期等，每项带原文依据）',
    desc:'只摘正文里写了的，没写的留空；每项回原文逐字核对，对不上的整条丢弃。',
    outcomes:{ ok:{ label:'抽取成功', to:'same_name' }, fail:{ label:'抽取失败', to:'end_readfail' } } },
  same_name:{ label:'按真名\n查库', kind:'system', who:'系统规则',
    desc:'用抽出的真实比赛全称和库里比：规范化后完全一致的不再新增，给已有那条补来源。',
    outcomes:{ new:{ label:'库里没有同名', to:'scope' }, supplement:{ label:'同名：补来源，不新增', to:'end_written' },
      exists:{ label:'同名已有（来源已存在或已隔离），不新增', to:'end_scope' } } },
  scope:{ label:'入库\n范围检查', kind:'system', who:'系统规则',
    desc:'是不是一场具体的比赛、参赛对象是不是大学生、和专业有没有关系；通知、目录、赛后报道、中小学赛事在这里拦下。',
    outcomes:{ pass:{ label:'通过', to:'gate' }, reject:{ label:'不符合，不入库', to:'end_scope' } } },
  gate:{ label:'入库\n收录门槛与核验', kind:'ai', who:'规则打分；拿不准的由 DeepSeek 再判；Kimi 做三项核验和专业分类',
    desc:'按报名时间分档：已截止直接归档、半年内送核验、半年外先放草稿；三项都对且专业有把握的自动发布，其余留待人工。',
    outcomes:{ written:{ label:'写入后台', to:'end_written' }, skip:{ label:'没写入（门槛、已截止等）', to:'end_scope' },
      dry:{ label:'试运行，没写库', to:'end_scope' } } },
  end_dropped:{ label:'搜索时\n丢弃', kind:'end', tone:'drop', desc:'搜索脚本自己丢掉的：不在收录范围、与竞赛无关、同轮重复。' },
  end_dup:{ label:'判重跳过', kind:'end', tone:'drop', desc:'库里已有，或 30 天内被拒过的网址。' },
  end_ai_dup:{ label:'AI 判重\n跳过', kind:'end', tone:'drop', desc:'AI 裁决为同一届重复、学校学院的下级通知，或看不出是不是同一场（保守跳过）。' },
  end_rejected:{ label:'前置筛选\n丢弃', kind:'end', tone:'bad', desc:'标题规则或 AI 判为与赛事无关。' },
  end_lead:{ label:'线索待核查', kind:'end', tone:'warn', desc:'本轮未进入赛事库。目录、信源和拿不准的线索写入持久核查任务；详情读取失败会按次数安排重试。' },
  end_trace_none:{ label:'追溯\n没找到', kind:'end', tone:'warn', desc:'通知追溯没有找到官方来源：代理判为不是比赛、只是赛区或校赛、找不到或读不出，或者没轮上（额度用完、代理出错）。' },
  end_trace_skip:{ label:'找到后\n筛选不读', kind:'end', tone:'warn', desc:'代理找到了官方网址，但库里已有或同批重复，不再读；2026-10-12 起还包括追溯前查库就认出库里已有、或同一晚已有通知在追的，不派代理（旧版还包括把握低、通知类页面、转载新闻）。' },
  end_readfail:{ label:'读取或\n抽取失败', kind:'end', tone:'bad', desc:'robots 禁止、空壳页、抓取出错、AI 没给出答案。' },
  end_scope:{ label:'未入库', kind:'end', tone:'bad', desc:'范围检查没通过、同名已有、或入库门槛没过。' },
  end_written:{ label:'写入后台', kind:'end', tone:'good', desc:'新增草稿、自动发布、归档，或给已有同名赛事补来源。' },
};

// 一条比赛的路径补上结尾：最后一个环节的结果如果通向“结束”，就在末尾加一条结束记录。
function finalizeTrail(trail = []) {
  const real = trail.filter(entry => !entry.virtual);
  const last = real[real.length - 1];
  const to = last ? NODES[last.n]?.outcomes?.[last.o]?.to : '';
  if (to && NODES[to]?.kind === 'end' && last.n !== to) trail.push({ n:to, o:'', note:'' });
  return trail;
}

// 由全部比赛的 trail 算出每个环节的流入数、各处理结果的数量，以及环节之间的连线数。
function buildFlow(rows = []) {
  const nodes = Object.entries(NODES).map(([id, def]) => ({
    id, label:def.label, kind:def.kind, tone:def.tone || '', who:def.who || '', desc:def.desc || '', in:0,
    outcomes:Object.entries(def.outcomes || {}).map(([outcomeId, outcome]) => ({ id:outcomeId, label:outcome.label, to:outcome.to, count:0 })),
  }));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edgeCount = new Map();
  for (const row of rows) {
    const trail = row.trail || [];
    trail.forEach((entry, index) => {
      const node = byId.get(entry.n);
      if (!node) return;
      if (!entry.virtual) {
        node.in += 1;
        const outcome = node.outcomes.find(item => item.id === entry.o);
        if (outcome) outcome.count += 1;
      }
      const next = trail[index + 1];
      if (next && byId.has(next.n)) {
        const key = `${entry.n}>${next.n}`;
        edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
      }
    });
  }
  const edges = [...edgeCount.entries()].map(([key, count]) => { const [from, to] = key.split('>'); return { id:key, from, to, count }; });
  return { nodes, edges };
}

module.exports = { NODES, buildFlow, finalizeTrail };
