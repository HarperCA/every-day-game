// 范围判断先于价值评分。未证实为大学生专业赛事的线索不得写入赛事库。
const { blockedTitleReason, isNoticeTitle, isNonEventTitle } = require('./noticeResolution');
const { normalizeEditionTitle, titleHasEditionTokens } = require('./editionTitle');

// 【已冻结，不要再往里加词】
//
// 这条正则是 2026-09 那段时间"每发现一条垃圾就补一个词"攒出来的，飞盘、帕克球、
// 单板滑雪、柔术、魔方、无线电测向……按这个路子走，列表永远补不完，而且补得越长
// 越容易误伤（"锦标赛"三个字本身并不说明什么，航空航天模型锦标赛就是正经赛事）。
//
// 新出现的"不是大学生赛事"不再靠往这里加词解决，改由 assessAudienceEvidence
// 看参赛对象字段的实际内容判断：写"面向全国飞盘爱好者"的自然过不了，
// 不需要系统认识"飞盘"这个词。这里只保留两类仍然可靠的标题信号：
//   1. 中小学/青少年——标题里出现就是确定的受众错配，不存在例外
//   2. 历史遗留的具体赛事名——留着是为了让既有测试和历史清洗脚本继续可用
const OUT_OF_SCOPE = /中小学|小学生|初中生|高中生|青少年|少年儿童|全国少年|奔跑吧[·•]少年|全民健身|男子飞盘|帕克球|数独公开赛|单板滑雪|健身气功|柔术U系列|魔方运动|车辆模型（攀爬|仿真模型（静态|无线电测向|研究生男子篮球联赛|音乐节大学生歌手大赛|咖啡师职业技能大赛/;

// 参赛对象里能确认"大学生可以参加"的表述。只在证据字段上匹配，不看标题——
// 标题里有"大学生"三个字不等于这场比赛真的面向大学生（"音乐节大学生歌手大赛"
// 就是反例），而参赛对象字段是主办方对资格的正式表述。
//
// 匹配词根而不是完整词：官方通知里"本科生""本科学生""本科在读"三种写法都常见，
// 按完整词写就会漏。开发时实测被漏掉的真实原文：
//   「辽宁省普通高等学校在读全日制本科学生」——"本科生"匹配不上"本科学生"，
//   "高校"也匹配不上"高等学校"。
const COLLEGE_AUDIENCE = /大学生|本科|专科|研究生|硕士|博士|高职|高专|高校|高等(?:学校|院校|教育)|在校(?:生|学生|大学生)|在读(?:生|学生)|学籍|MBA|MPA/i;

function isClearlyOutOfScope(record = {}) {
  const title = String(record.name || record.title || '').normalize('NFKC').trim();
  if (/奔跑吧[\s,，·•、]*少年/.test(title)) return true;
  if (/车辆模型\(攀爬|仿真模型\(静态/.test(title)) return true;
  if (OUT_OF_SCOPE.test(title)) return true;
  const eligibility = `${record.participants || ''} ${record.eligibility || ''}`;
  return /中小学|小学生|初中生|高中生|少年儿童/.test(eligibility) && !/大学生|本科生|研究生|高校/.test(eligibility);
}

function classifyCompetitionScope(record = {}) {
  const title = String(record.name || record.title || '').normalize('NFKC').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex, dec) => String.fromCodePoint(parseInt(hex || dec, hex ? 16 : 10))).trim();
  const reject = reason => ({ decision:'reject', reason });
  const pending = reason => ({ decision:'pending', reason });
  if (!title) return reject('缺少赛事名称');
  const titleBlock = blockedTitleReason(title) || blockedTitleReason(record.editionName);
  if (titleBlock) return reject(titleBlock);
  if (isClearlyOutOfScope({ ...record, name:title })) return reject('非大学生专业赛事');
  // 校赛/院赛是上级赛事的报名或选拔环节，不是新的独立赛事。只有已经明确关联
  // parentEventId 时才允许作为内部子记录保存；不能进入独立比赛列表。
  if (/校级(?:选拔赛|初赛)|校内(?:选拔赛|初赛|赛)|院级(?:选拔赛|初赛)|学院选拔赛/.test(title) && !record.parentEventId) {
    return reject('校赛或院赛是上级赛事的下级选拔，必须关联父赛事，不得作为独立赛事');
  }
  // 名称带“（初赛）”这类括号标注的，是某场比赛的一个阶段，不单独收录（2026-09-30 用户确认）。
  // 起因：抽取从通知标题里取出“第十二届湖南省大学生化工设计竞赛（初赛）”，差点被当成独立赛事自动发布。
  // 复赛、预赛、半决赛、决赛同理。和上面的校赛规则一样，明确关联了父赛事的才允许作为子记录。
  if (/[（(]\s*(?:初赛|复赛|预赛|半决赛|决赛)(?:阶段)?\s*[）)]/.test(title) && !record.parentEventId) {
    return reject('名称标注了比赛阶段（如“（初赛）”），是某场比赛的一个阶段，不单独收录');
  }
  if (isNoticeTitle(title) || isNonEventTitle(title) || /通知(?:[-_｜|]|$)/.test(title)) return reject('通知、栏目或目录线索，需要追溯比赛本身');
  if (/目录|清单|汇总|全梳理|资讯速递|参赛指南|赛题分析|报名表|模拟考场|错题重练|群众文艺|文化艺术季|音乐节|作品评选/.test(title)) return reject('目录、资料或兴趣文化活动，不是专业赛事');
  if (/喜报|学子获|获奖名单|晋级.*名单|斩获|创佳绩|(?:学院|大学|学校|团队|学生).*获.*(?:等奖|金奖|银奖|铜奖)|决赛.*(?:举行|闭幕|落幕|收官)/.test(title)) return reject('赛后报道或结果公示，不是赛事条目');
  // 「赛[)）】]*$」是中文赛事命名的实际语言标志，比枚举赛制词可靠：官方目录里
  // 「鼓浪文学大奖赛」「模拟法庭辩论赛」都是正经立项赛事，但"大奖赛""辩论赛"
  // 不在任何枚举列表里——再往列表塞词只会重复同一个错误。
  // 排在它前面的通知/目录/栏目/获奖报道几条 reject 规则保证了「大赛动态」
  // 「…目录(84项)」「…竞赛规程」这类不会因为含"赛"字被放进来。
  // 来自权威榜单（教育部认可目录、竞赛指数覆盖项目表等，record.curationList 记着是哪份）的赛事，
  // 名称以“奖”“展”“展示”结尾也算具体赛事：“时报金犊奖”“中华设计奖”“米兰设计周—中国高校设计学科师生优秀作品展”
  // “全国大学生创新创业训练计划年会展示”“高教社杯……优秀短视频作品征集活动”都是榜单收录的正式项目
  // （2026-10-03 用户确认，只对榜单来源放宽）。
  const listedAward = Boolean(record.curationList) && /(?:奖|展|展示|活动)[\s)）\]】]*$/.test(title);
  if (!listedAward && !/竞赛|大赛|挑战赛|锦标赛|联赛|黑客松|奥林匹克|比赛|挑战|赛[\s)）\]】]*$|ICPC|CCSP|RoboMaster|ROBOCON/i.test(title)) return reject('标题不是一场具体比赛');

  // 以下两项：有证据就看证据，没证据才退回标题启发式。
  //
  // 原先两项都把 title 混进待匹配文本，等于让"标题里碰巧有个词"可以顶替真实证据，
  // 同时又会否决证据齐全但用词不在表内的真赛事。2026-09-22 实测的三个受害者：
  // 「跨文化能力大赛」「中华经典诵写讲大赛」「商科综合能力大赛」——全是省教育厅
  // 主办、参赛对象和专业分类都齐备，却因为正文没写"外语""语言""商务"这些词被拒。
  // 当时的绕过办法是往 formatAndRules 里补写这些词，那等于让过滤器反过来决定
  // 数据怎么写，是比漏收更坏的结果。

  // 参赛对象：证据字段（participants/eligibility）优先。
  const audienceEvidence = `${record.participants || ''} ${record.eligibility || ''}`.trim();
  if (audienceEvidence) {
    if (!COLLEGE_AUDIENCE.test(audienceEvidence)) return pending('参赛对象未表明大学生可以参加');
  } else if (!COLLEGE_AUDIENCE.test(title) && !/ICPC|CCSP/i.test(title)) {
    return pending('缺少大学生参赛资格依据');
  }

  // 专业关联：professions 是人工或 AI 带证据判定的结果，它本身就是专业关联的依据，
  // 比再拿词表猜一遍可靠。只有在没人判定过 professions 时，才退回标题/赛制词表粗筛。
  if (!record.professions?.length) {
    const subject = `${title} ${record.formatAndRules || ''} ${record.format_and_rules || ''}`;
    if (!/学科|专业|学术|科研|科技|技术|技能|设计|工程|创新|创业|数学|统计|物理|化学|化工|生物|医学|生命|计算机|程序|软件|算法|信息|数据|人工智能|AI|电子|集成电路|芯片|机械|自动化|机器人|智能汽车|建筑|结构|测绘|能源|环境|农业|食品|材料|交通|物流|供应链|商业|商务|经济|金融|财会|会计|审计|税务|管理|法律|法学|外语|英语|翻译|语言|汉语|汉字|普通话|写作|数字媒体|包装|广告|文献|检索|ICPC|CCSP/i.test(subject)) return pending('缺少专业学习或专业技能关联依据');
  }
  return { decision:'eligible', reason:'具备具体赛事、大学生范围与专业关联依据' };
}

function requireScopeForNewRecords(previous, next) {
  const existing = new Set(previous.map(item => `${item.id}\n${item.name}`));
  for (const record of next) {
    const sameId = previous.filter(item => item.id === record.id);
    const original = sameId.find(item => item.name === record.name) || (sameId.length === 1 ? sameId[0] : null);
    const restoring = original?.dataStatus === 'quarantined' && record.dataStatus !== 'quarantined';
    if (restoring && !['draft','published','archived'].includes(record.dataStatus)) throw new Error('隔离记录仅可人工恢复草稿、发布或归档');
    if (existing.has(`${record.id}\n${record.name}`) && !restoring) continue;
    if (titleHasEditionTokens(record.name)) throw new Error(`赛事名称只保留正文，年份与届次须单独填写：${record.name}`);
    // 存量字段迁移只移动名称中的年份/届次，不更改赛事身份和状态。旧草稿、
    // 隔离条目可能本来就未达到当前准入门槛，不能因此阻断无损字段迁移。
    const normalizationOnly = sameId.some(item => {
      const expected = normalizeEditionTitle(item);
      return item.editionName === record.editionName
        && expected.name === record.name
        && expected.editionYear === String(record.editionYear || '')
        && expected.editionOrdinal === String(record.editionOrdinal || '')
        && JSON.stringify({...item, name:record.name, editionYear:record.editionYear, editionOrdinal:record.editionOrdinal}) === JSON.stringify(record);
    });
    if (normalizationOnly && !restoring) continue;
    const scope = classifyCompetitionScope(record);
    if (scope.decision !== 'eligible') throw new Error(`赛事范围未通过：${record.name}；${scope.reason}`);
    const intake = assessIntakeRecord(record);
    if (intake.decision !== 'eligible') throw new Error(`仅可保留为线索：${record.name}；${intake.reason}`);
  }
}

// This is a minimum evidence-completeness gate, not a claim of factual verification.
function assessIntakeRecord(record = {}) {
  const scope = classifyCompetitionScope(record);
  if (scope.decision !== 'eligible') return scope;
  const missing = [];
  // 参赛对象已明确写了大学生（本科、研究生、高校在校生……）时，它本身就是大学生资格依据，
  // 不再要求“参赛资格”一栏另有内容——很多官网只写一句“参赛对象：在校大学生”，没有单独的资格段落。
  // 2026-09-30 用户确认放宽。
  const participantsShowCollege = COLLEGE_AUDIENCE.test(String(record.participants || ''));
  for (const [key, label] of [['organizer','主办方'],['participants','参赛对象'],['eligibility','大学生资格依据'],['formatAndRules','专业任务与赛制']]) {
    if (key === 'eligibility' && participantsShowCollege) continue;
    if (!String(record[key] || '').trim()) missing.push(label);
  }
  // 新抓到的草稿允许专业分类待定，后续由 Kimi 根据正文判定；发布仍须有分类。
  // 发现时就已截止、直接归档的（2026-09-30 起收进库里）同样允许待定：它不上小程序，等人工补。
  const pendingProfessionsAllowed = record.dataStatus === 'draft'
    || (record.dataStatus === 'archived' && record.archivedReason === 'discovered_already_closed');
  if (!record.professions?.length && !pendingProfessionsAllowed) missing.push('专业分类');
  if (!(record.sources || []).some(source => /^https?:\/\//i.test(source.url || ''))) missing.push('来源网址');
  return missing.length ? {decision:'pending', reason:`缺少${missing.join('、')}，不得以标题关键词代替核验`, ruleVersion:'intake-v2'} : {...scope, ruleVersion:'intake-v2'};
}

module.exports = { isClearlyOutOfScope, classifyCompetitionScope, assessIntakeRecord, requireScopeForNewRecords };
