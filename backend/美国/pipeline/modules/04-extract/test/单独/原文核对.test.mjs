// 原文核对：从旧代码 adminData/competitionExtract.js 原样搬来的规则，测试也是旧测试原样搬来的
// （tests/competition-extract.test.mjs、tests/verified-competition-name.test.mjs）。
// 没搬的：旧云函数自己读网页、60 秒时限、换接口供应商、思考模式、提示词拼接——新代码里这些由读网页、AI 总管、prompt.md 管，各有自己的测试。
import { describe, expect, it } from 'vitest';
import * as 核对 from '../../steps/原文核对.mjs';
import * as 取值 from '../../schema.mjs';

const { MAX_QUOTE_LENGTH, MIN_QUOTE_LENGTH, quoteAppearsInSource, verifyAgainstSource } = 核对;

// 用接近真实通知页的长度：太短的正文会被 looksLikeContestPage 当成骨架挡掉。
const SOURCE = '本次大赛由中国图象图形学学会主办，中国科学技术大学承办。优胜队伍可获得直通终面资格，并颁发获奖证书。报名由各高校统一组织，请联系所在学校教务处。'
  + '参赛对象为全日制在校本科生与研究生，每队不超过三人，可跨校组队，须由一名指导教师推荐。'
  + '初赛为线上提交，复赛与决赛在承办单位现场进行，具体时间以官方后续通知为准。'
  + '参赛不收取任何报名费用，往返交通与住宿由参赛单位自理。'
  + '作品须为原创，严禁抄袭，一经发现取消参赛资格并通报所在学校。';

describe('quotes are checked against the page word for word', () => {
  it('accepts a quote that really appears in the text', () => {
    expect(quoteAppearsInSource('中国图象图形学学会主办', SOURCE)).toBe(true);
    expect(quoteAppearsInSource('优胜队伍可获得直通终面资格', SOURCE)).toBe(true);
  });

  it('rejects a quote the model invented', () => {
    // 这是防编造最硬的一道闸：模型可以答错，但答不出一句页面上没有的话。
    expect(quoteAppearsInSource('优胜者可获得保研加分', SOURCE)).toBe(false);
    expect(quoteAppearsInSource('由教育部主办', SOURCE)).toBe(false);
  });

  it('rejects quotes too short to be evidence', () => {
    // 「大赛」几乎出现在任何赛事页面上，当证据毫无意义。
    expect(quoteAppearsInSource('大赛', SOURCE)).toBe(false);
    expect(quoteAppearsInSource('x'.repeat(MAX_QUOTE_LENGTH + 1), SOURCE)).toBe(false);
    expect('中国图象图形学学会主办'.length).toBeGreaterThanOrEqual(MIN_QUOTE_LENGTH);
  });

  it('tolerates whitespace and full-width punctuation drift', () => {
    // 模型复现原文时常改动这些，但它们不影响「这句话是否真的在页面上」。
    expect(quoteAppearsInSource('中国图象图形学学会主办， 中国科学技术大学承办', SOURCE)).toBe(true);
    expect(quoteAppearsInSource('中国图象图形学学会主办,中国科学技术大学承办', SOURCE)).toBe(true);
  });
});

describe('verifying a model response', () => {
  const response = {
    organizer:{ value:'中国图象图形学学会', quote:'中国图象图形学学会主办' },
    reward_highlights:[
      { value:'实习或直通面试', quote:'优胜队伍可获得直通终面资格' },
      { value:'保研考研加分', quote:'获奖可获得保研加分' },       // 编造
      { value:'不在枚举里的奖励', quote:'优胜队伍可获得直通终面资格' },
    ],
    authority_signals:[{ signal:'由全国性学会主办', quote:'中国图象图形学学会主办' }],
    recognition_hints:[
      { path:'求职就业', level:'高', quote:'优胜队伍可获得直通终面资格', scope:['算法工程师'] },
      { path:'保研考研', level:'高', quote:'各高校普遍承认本赛事' },  // 编造
      { path:'不存在的路径', level:'高', quote:'中国图象图形学学会主办' },
    ],
    registration_organization:{ value:'学校统一报名', quote:'报名由各高校统一组织' },
    missing:['报名截止时间', '奖金金额'],
  };

  it('keeps only what the page actually says', () => {
    const verified = verifyAgainstSource(response, SOURCE);
    expect(verified.reward_highlights.map(item => item.value)).toEqual(['实习或直通面试']);
    expect(verified.recognition_hints.map(item => item.path)).toEqual(['求职就业']);
    expect(verified.organizer.value).toBe('中国图象图形学学会');
    expect(verified.registration_organization.value).toBe('学校统一报名');
  });

  it('reports what it threw away instead of silently dropping it', () => {
    // 被丢弃的项要能被人看到：它们说明模型在哪里开始编了。
    const verified = verifyAgainstSource(response, SOURCE);
    expect(verified.dropped.map(item => item.value)).toContain('保研考研加分');
    expect(verified.dropped.length).toBeGreaterThan(0);
  });

  it('drops values outside the allowed enums before checking quotes', () => {
    const verified = verifyAgainstSource(response, SOURCE);
    expect(verified.reward_highlights.map(item => item.value)).not.toContain('不在枚举里的奖励');
    expect(verified.recognition_hints.map(item => item.path)).not.toContain('不存在的路径');
  });

  it('survives a malformed response without throwing', () => {
    expect(() => verifyAgainstSource({}, SOURCE)).not.toThrow();
    const empty = verifyAgainstSource({ reward_highlights:'不是数组', organizer:'不是对象' }, SOURCE);
    expect(empty.reward_highlights).toEqual([]);
    expect(empty.organizer).toBeNull();
  });

  it('retains sourced core fields and rejects an invented qualification', () => {
    const verified = verifyAgainstSource({
      participants:{ value:'全日制在校本科生与研究生', quote:'参赛对象为全日制在校本科生与研究生' },
      eligibility:{ value:'仅限博士生', quote:'仅限博士生报名参赛' },
      format_and_rules:{ value:'初赛线上提交', quote:'初赛为线上提交，复赛与决赛在承办单位现场进行' },
      team_size:{ value:'每队不超过三人', quote:'每队不超过三人，可跨校组队' },
      fees:{ value:'不收取报名费', quote:'参赛不收取任何报名费用' },
    }, SOURCE);
    expect(verified.participants.value).toBe('全日制在校本科生与研究生');
    expect(verified.eligibility).toBeNull();
    expect(verified.format_and_rules.value).toBe('初赛线上提交');
    expect(verified.team_size.value).toBe('每队不超过三人');
    expect(verified.fees.value).toBe('不收取报名费');
    expect(verified.dropped.some(item => item.value === '仅限博士生')).toBe(true);
  });
});

describe('refusing a page that only rendered its navigation', () => {
  const { BOILERPLATE_MIN_CHARS, looksLikeContestPage } = 核对;

  // 实测从服务器抓天池详情页的结果：两个不同赛事抓出来一字不差，全是导航。
  const TIANCHI_SHELL = '算法大赛-天池大赛-阿里云的赛制 天池 首页 天池大赛 天池学习 数据集 技术圈 更多 探索发现 '
    + 'IEEE AICAS 2025 小白入门系列 历届大赛答辩PPT及视频 个人 登录后您可以获得 报名大赛 学习课程 参与活动 '
    + '评论/积分/反馈 中国站登录 International 关于天池 天池协议 常见问题 联系我们 加入我们 友情链接';

  it('rejects the shell of a client-rendered site', () => {
    // 这段有 665 字，长度关过得去 —— 拦住它的是「正文里没有这场赛事的名字」。
    const shell = TIANCHI_SHELL.repeat(3);
    expect(shell.length).toBeGreaterThan(BOILERPLATE_MIN_CHARS);
    expect(looksLikeContestPage(shell, '蚂蚁灵波具身大模型挑战赛')).toBe(false);
  });

  it('accepts a page that actually names the contest', () => {
    const real = '蚂蚁灵波具身大模型挑战赛由蚂蚁灵波科技、魔搭社区、阿里云天池共同发起，面向全球开发者开放。'.repeat(6);
    expect(looksLikeContestPage(real, '蚂蚁灵波具身大模型挑战赛')).toBe(true);
  });

});

describe('registration organization must land on the schema enum', () => {
  const { REGISTRATION_ORGANIZATIONS } = 取值;

  it('rejects prose even when the quote is genuine', () => {
    // 试跑时模型返回了「参赛团队自行通过全国大学生创业服务网报名」——
    // 引文是真的，但这个值不在枚举里，直接填会违反 event_edition schema。
    const verified = verifyAgainstSource({
      registration_organization:{ value:'参赛团队自行通过平台报名', quote:'报名由各高校统一组织' },
    }, SOURCE);
    expect(verified.registration_organization).toBeNull();
  });

  it('accepts a value that is on the enum', () => {
    const verified = verifyAgainstSource({
      registration_organization:{ value:'学校统一报名', quote:'报名由各高校统一组织' },
    }, SOURCE);
    expect(verified.registration_organization.value).toBe('学校统一报名');
  });

});

describe('registration dates must be real ISO dates with a genuine quote', () => {
  const DATE_SOURCE = SOURCE + '报名时间为2026年10月15日至2026年11月20日，逾期不予受理。';

  it('accepts a well-formed date backed by a real quote', () => {
    const verified = verifyAgainstSource({
      registration_start:{ value:'2026-10-15', quote:'报名时间为2026年10月15日至2026年11月20日' },
      registration_end:{ value:'2026-11-20', quote:'报名时间为2026年10月15日至2026年11月20日' },
    }, DATE_SOURCE);
    expect(verified.registration_start.value).toBe('2026-10-15');
    expect(verified.registration_end.value).toBe('2026-11-20');
  });

  it('rejects a value that is not a real ISO date, even with a genuine quote', () => {
    // 模型有时会给"待定""10月"这类半截日期——格式不对就整条丢弃，不能塞进 schedule。
    const verified = verifyAgainstSource({
      registration_start:{ value:'10月', quote:'报名时间为2026年10月15日至2026年11月20日' },
      registration_end:{ value:'2026-13-40', quote:'报名时间为2026年10月15日至2026年11月20日' },
    }, DATE_SOURCE);
    expect(verified.registration_start).toBeNull();
    expect(verified.registration_end).toBeNull();
  });

  it('rejects a date whose quote does not actually appear in the source', () => {
    const verified = verifyAgainstSource({
      registration_start:{ value:'2026-01-01', quote:'报名时间为2026年1月1日起' }, // 编造
    }, DATE_SOURCE);
    expect(verified.registration_start).toBeNull();
  });

});

describe('anchors instead of full quotes', () => {
  const {
    ANCHOR_MIN_LENGTH, ANCHOR_MAX_LENGTH, MAX_ANCHOR_OCCURRENCES, expandAnchor,
  } = 核对;

  const TEXT = '大赛由教育部、共青团中央和江苏省人民政府联合主办，南京大学承办。'
    + '参赛团队通过登录全国大学生创业服务网进行报名。获奖团队可获得创业扶持资金。';

  it('expands a short anchor into the whole sentence around it', () => {
    // 让模型逐字重打整句是最主要的耗时来源 —— 它在重新生成我们本来就有的文本。
    expect(expandAnchor('共青团中央', TEXT)).toBe('大赛由教育部、共青团中央和江苏省人民政府联合主办，南京大学承办。');
    expect(expandAnchor('创业扶持资金', TEXT)).toBe('获奖团队可获得创业扶持资金。');
  });

  it('returns evidence taken from the source, not from the model', () => {
    // 扩展出来的句子直接来自原文，所以证据比模型转写的更可靠。
    const expanded = expandAnchor('全国大学生创业服务网', TEXT);
    expect(TEXT).toContain(expanded);
  });

  it('refuses an anchor it cannot find', () => {
    expect(expandAnchor('并不存在的一段文字', TEXT)).toBeNull();
  });

  it('refuses an anchor too short to locate anything specific', () => {
    expect(expandAnchor('大赛', TEXT)).toBeNull();
    expect(expandAnchor('x'.repeat(ANCHOR_MAX_LENGTH + 1), TEXT)).toBeNull();
    expect('共青团中央'.length).toBeGreaterThanOrEqual(ANCHOR_MIN_LENGTH);
  });

  it('refuses an anchor that appears all over the page', () => {
    // 判断锚点够不够具体，靠的是出现次数而不是长度。
    const repetitive = '参赛团队须知。'.repeat(MAX_ANCHOR_OCCURRENCES + 5);
    expect(expandAnchor('参赛团队须知', repetitive)).toBeNull();
  });

  it('tolerates whitespace and punctuation drift in the anchor', () => {
    expect(expandAnchor('共青团中央和江苏省', TEXT)).not.toBeNull();
    expect(expandAnchor('共青团中央 和江苏省', TEXT)).not.toBeNull();
  });

  it('still accepts a full quote for callers that supply one', () => {
    const verified = verifyAgainstSource({
      organizer:{ value:'中国图象图形学学会', quote:'中国图象图形学学会主办' },
    }, SOURCE);
    expect(verified.organizer.value).toBe('中国图象图形学学会');
  });

  it('prefers the anchor when both are present', () => {
    const verified = verifyAgainstSource({
      organizer:{ value:'教育部', anchor:'共青团中央', quote:'这句原文里没有' },
    }, TEXT);
    expect(verified.organizer.quote).toContain('共青团中央');
  });

});


describe('evidence is taken by block, never cut mid-line', () => {
  const {
    MAX_QUOTE_LENGTH: QUOTE_CAP, expandAnchor: expandBlock, toStructuredText,
  } = 核对;

  // 赛事页的关键信息是 Markdown 列表和表格，整块里一个句号都没有。
  const MARKDOWN = [
    '# 蚂蚁灵波具身大模型挑战赛',
    '',
    '## 5. 奖金设置',
    '- **一等奖（1 名）**：现金 ¥80,000 + 官方荣誉证书',
    '- **二等奖（2 名）**：现金 ¥50,000 + 官方荣誉证书',
    '- **三等奖（3 名）**：现金 ¥20,000 + 官方荣誉证书',
    '',
    '## 6. 组织单位',
    '**主办单位**：中国中检',
    '**承办单位**：中检智测科技',
  ].join('\n');

  it('returns a whole line, never a fragment cut at a character count', () => {
    // 之前按句号扩展再 slice(0,120)，实测 33 条引文结尾是「+ 由」「北京北奥集」这种半个词。
    const quote = expandBlock('80,000', MARKDOWN);
    expect(quote).toBe('- **一等奖（1 名）**：现金 ¥80,000 + 官方荣誉证书');
    expect(MARKDOWN).toContain(quote); // 逐字来自原文
  });

  it('stops at the block boundary instead of bleeding into the next section', () => {
    const quote = expandBlock('80,000', MARKDOWN);
    expect(quote).not.toContain('主办单位');
    expect(quote).not.toContain('奖金设置'); // 标题是块边界
  });

  it('gives the organizer line on its own', () => {
    // 整块取会让五条信号共用同一段证据，看某一条时核对不了是哪句支持的。
    expect(expandBlock('主办单位**：中国中检', MARKDOWN)).toBe('**主办单位**：中国中检');
  });

  it('never ends mid-word when a block is too long', () => {
    const long = ['## 支持单位', ...Array.from({ length: 12 }, (_, i) => `- 第${i}家支持单位名称写得很长很长很长很长很长很长`)].join('\n');
    const quote = expandBlock('第3家支持单位', long);
    expect(quote.length).toBeLessThanOrEqual(QUOTE_CAP);
    // 取到的每一段都必须是原文里完整的一行
    for (const piece of quote.split(' ').filter(Boolean)) {
      expect(long).toContain(piece);
    }
  });

  it('preserves line structure when normalizing html', () => {
    // htmlToText 把 \s+ 压成空格，块边界全丢 —— 这才是引文被硬切的根因。
    const html = '<h2>奖金设置</h2><ul><li>一等奖：8万</li><li>二等奖：5万</li></ul>';
    const text = toStructuredText(html, 1000);
    expect(text.split('\n').length).toBeGreaterThan(1);
    expect(text).toContain('一等奖');
    expect(text).toContain('二等奖');
  });

  it('fits a prize block within the schema evidence limit', () => {
    // recognition[].evidence 在 event_edition schema 里是 maxLength 300。
    expect(QUOTE_CAP).toBeLessThanOrEqual(300);
  });
});

describe('prose gets a sentence, lists get the block', () => {
  const { expandAnchor: expandBlock } = 核对;

  it('takes only the sentence around the anchor in a prose paragraph', () => {
    // 单行块是一段散文，整段取太糙 —— 证据应当是那一句。
    const prose = '大赛由教育部和共青团中央联合主办，南京大学承办。参赛团队通过官网报名。获奖团队可获得创业扶持。';
    expect(expandBlock('共青团中央', prose)).toBe('大赛由教育部和共青团中央联合主办，南京大学承办。');
    expect(expandBlock('创业扶持', prose)).toBe('获奖团队可获得创业扶持。');
  });

  it('takes neighbouring lines only when one line cannot stand alone', () => {
    // 有冒号的行自己就说清了一件事，不必拉上邻居；
    // 「- 8万」这种才需要补到够长。
    const selfContained = '## 奖金设置\n- 一等奖：8万元\n- 二等奖：5万元';
    expect(expandBlock('一等奖：8万元', selfContained)).toBe('- 一等奖：8万元');

    const fragments = '## 奖金\n- 8万\n- 5万\n- 2万';
    expect(expandBlock('- 8万', fragments)).toContain('5万');
  });
});

describe('markdown markers are formatting, not content', () => {
  const { expandAnchor: expandBlock } = 核对;
  const MD = '## 组织单位\n**主办单位**：中国中检\n**承办单位**：中检智测科技';

  it('matches an anchor the model reproduced without the asterisks', () => {
    // 模型复现「**主办单位**：中国中检」时会写成「主办单位：中国中检」。
    // 实测保留换行后，十条被丢弃的锚点里有七条是这个原因。
    expect(expandBlock('主办单位：中国中检', MD)).toContain('中国中检');
    expect(expandBlock('承办单位：中检智测科技', MD)).toContain('中检智测科技');
  });

  it('still refuses text that is genuinely absent', () => {
    // 抹掉的只是标记符号，文字本身仍须一字不差。
    expect(expandBlock('主办单位：某个不存在的机构', MD)).toBeNull();
  });

  it('keeps the two normalizers in step so offsets stay aligned', () => {
    // 归一化串和位置映射必须跳过完全相同的字符，
    // 实测两边不一致时所有锚点都会失配。
    const withMarks = '**一等奖**：8万元 **二等奖**：5万元';
    expect(expandBlock('一等奖：8万元', withMarks)).toContain('一等奖');
    expect(expandBlock('二等奖：5万元', withMarks)).toContain('二等奖');
  });
});

describe('one signal, one line of evidence', () => {
  const {
    expandAnchor: expandBlock, isSelfContained,
  } = 核对;

  const ORG_BLOCK = '## 组织单位\n**主办单位**：中国中检\n**承办单位**：中检智测科技\n'
    + '**协办单位**：首钢基金\n**支持单位**：学习强国学习平台、中国互联网协会人工智能工作委员会\n**技术平台**：阿里云天池';

  it('gives each fact its own line instead of one shared blob', () => {
    // 实测整块取的结果是五条不同的信号共用同一段 295 字证据 ——
    // 看「技术平台为阿里云天池」时拿到的是一大段单位罗列，根本核对不了是哪句。
    expect(expandBlock('主办单位**：中国中检', ORG_BLOCK)).toBe('**主办单位**：中国中检');
    expect(expandBlock('技术平台**：阿里云天池', ORG_BLOCK)).toBe('**技术平台**：阿里云天池');
    expect(expandBlock('承办单位**：中检智测科技', ORG_BLOCK)).toBe('**承办单位**：中检智测科技');
  });

  it('judges a line by whether it stands alone, not by how long it is', () => {
    // 「**主办单位**：中国中检」只有十四个字却已经说完整了；
    // 「- 8万」再怎么数也不成证据。
    expect(isSelfContained('**主办单位**：中国中检')).toBe(true);
    expect(isSelfContained('- **一等奖（1 名）**：现金 ¥80,000')).toBe(true);
    expect(isSelfContained('- 8万')).toBe(false);
    expect(isSelfContained('支持单位：')).toBe(false); // 冒号后没内容
    expect(isSelfContained('**技术平台**： 阿里云天池')).toBe(true); // 冒号后有空格
  });

  it('grows to neighbours only when a line cannot stand alone', () => {
    const tiny = '## 奖金\n- 8万\n- 5万\n- 2万';
    const quote = expandBlock('- 8万', tiny);
    expect(quote).toContain('5万');
  });

  it('keeps a prize line whole rather than merging every tier', () => {
    const prize = '## 奖金设置\n- **一等奖（1 名）**：现金 ¥80,000 + 官方荣誉证书\n- **二等奖（2 名）**：现金 ¥50,000';
    expect(expandBlock('一等奖（1 名）**：现金', prize)).toBe('- **一等奖（1 名）**：现金 ¥80,000 + 官方荣誉证书');
  });
});

// 2026-10-01：空壳页检查的两个漏洞——名字太短、正文里引号和名字对不上
describe('looksLikeContestPage 不再误判真实页面', () => {
  const { looksLikeContestPage } = 核对;
  it('名字只有三个字也能在正文里找到', () => {
    const page = '首页 关于我们 园冶杯国际大学生风景园林竞赛是面向全球高校的……'.repeat(15);
    expect(looksLikeContestPage(page, '园冶杯')).toBe(true);
  });
  it('正文里的引号、全半角括号不影响比对', () => {
    const page = '关于组织参加“建行杯”浙江省国际大学生创新大赛（2026）的通知 各学院……'.repeat(10);
    expect(looksLikeContestPage(page, '关于组织参加“建行杯”浙江省国际大学生创新大赛(2026)的通知')).toBe(true);
  });
  it('导航骨架、过短的正文仍然判空壳', () => {
    const nav = '首页 天池大赛 数据集 排行榜 论坛 登录 注册 关于我们 联系我们 帮助中心 '.repeat(8);
    expect(looksLikeContestPage(nav, '园冶杯')).toBe(false);
    expect(looksLikeContestPage(nav, '欧莱雅美妆科技黑客松')).toBe(false);
    expect(looksLikeContestPage('园冶杯', '园冶杯')).toBe(false);
  });
});

describe('搜索标题是宣传语时，长正文不再误判空壳（2026-10-01 胶东网那条）', () => {
  const { looksLikeContestPage } = 核对;
  it('正文上千字、多处在讲比赛：不是骨架', () => {
    const page = '山东省第六届全民国家安全宣传教育创意作品大赛正式启动，面向高校学生征集作品，大赛设一二三等奖。本次比赛由……'.repeat(20);
    expect(page.length).toBeGreaterThan(1000);
    expect(looksLikeContestPage(page, '@所有人!万元奖金等你拿!山东省第六届全民国家安全宣传教育创')).toBe(true);
  });
  it('长的导航页（几乎不提比赛）仍然判空壳', () => {
    const nav = '首页 新闻中心 通知公告 学院概况 师资队伍 招生就业 联系我们 校园生活 图书馆 '.repeat(30);
    expect(nav.length).toBeGreaterThan(1000);
    expect(looksLikeContestPage(nav, '某某大赛')).toBe(false);
  });
});

const 化工 = '学会动态\n各理事单位、各高校：学会将于2026年继续开展湖南省大学生化工设计竞赛活动。初赛由湖南省化学化工学会主办。'
  + '一、参赛对象 在读化学、化工及相关专业的本科生，以团队形式参赛。';

describe('抽取比赛全称', () => {
  it('名称在正文里逐字出现才保留，并带回原文引文', () => {
    const verified = verifyAgainstSource({ competition_name:{ value:'湖南省大学生化工设计竞赛', anchor:'湖南省大学生化工设计竞赛活动' } }, 化工);
    expect(verified.competition_name.value).toBe('湖南省大学生化工设计竞赛');
    expect(verified.competition_name.quote).toContain('继续开展湖南省大学生化工设计竞赛活动');
  });
  it('模型拼出来、正文里没有的名字丢弃', () => {
    const verified = verifyAgainstSource({ competition_name:{ value:'第十二届湖南省大学生化工设计大赛', anchor:'湖南省大学生化工设计竞赛活动' } }, 化工);
    expect(verified.competition_name).toBeNull();
    expect(verified.dropped.map(item => item.field)).toContain('competition_name');
  });
});

describe('可选值和比赛库一致', () => {
  it('报名组织方式、非现金回报的可选值和届次表的一样', async () => {
    const { TABLES } = await import('../../../../../db/index.mjs');
    expect(取值.REGISTRATION_ORGANIZATIONS).toEqual(TABLES.edition.字段.registration_organization.可选值);
    expect(取值.REWARD_HIGHLIGHTS).toEqual(TABLES.edition.字段.reward_highlights.可选值);
  });
});
