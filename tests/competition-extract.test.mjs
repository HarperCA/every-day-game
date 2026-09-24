import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MAX_QUOTE_LENGTH, MIN_QUOTE_LENGTH, buildExtractPrompt, extractFromDetailPage,
  fetchDetailPage, quoteAppearsInSource, toFieldSuggestions, verifyAgainstSource,
} = require('../apps/miniprogram/cloudfunctions/adminData/competitionExtract.js');

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

describe('turning verified facts into suggestions', () => {
  it('marks a recognition level as needing human confirmation', () => {
    // 等级是判断，不是事实：正文能证明「有直通面试」，
    // 证明不了「求职认可度高」。
    const verified = verifyAgainstSource({
      recognition_hints:[{ path:'求职就业', level:'高', quote:'优胜队伍可获得直通终面资格', scope:[] }],
    }, SOURCE);
    const [suggestion] = toFieldSuggestions(verified, 'https://example.com/notice');
    expect(suggestion.field).toBe('recognition');
    expect(suggestion.needsHumanConfirmation).toBe(true);
    expect(suggestion.value.evidence).toBe('优胜队伍可获得直通终面资格');
  });

  it('carries the source url on every suggestion', () => {
    const verified = verifyAgainstSource({
      organizer:{ value:'中国图象图形学学会', quote:'中国图象图形学学会主办' },
    }, SOURCE);
    const suggestions = toFieldSuggestions(verified, 'https://example.com/notice');
    expect(suggestions.every(item => item.source === 'https://example.com/notice')).toBe(true);
  });
});

describe('the prompt', () => {
  it('forbids inference and states that invented quotes are discarded', () => {
    const prompt = buildExtractPrompt('正文', '某赛事');
    expect(prompt).toContain('不得改写');
    expect(prompt).toContain('不要根据常识');
    expect(prompt).toContain('定位不到的整条作废');
  });

  it('tells the model the contest name is not evidence', () => {
    // 否则模型会拿赛事名里的「全国」「教育部」当成主办方证据。
    expect(buildExtractPrompt('正文', '某赛事')).toContain('不可作为证据');
  });
});

describe('fetching the page', () => {
  const robotsResponse = body => ({ ok:true, status:200, headers:{ get:() => 'text/plain' }, text:async () => body });
  const htmlResponse = body => ({ ok:true, status:200, headers:{ get:() => 'text/html' }, text:async () => body });

  it('refuses a url robots.txt disallows', async () => {
    const request = url => Promise.resolve(url.endsWith('/robots.txt')
      ? robotsResponse('User-agent: *\nDisallow: /notice')
      : htmlResponse('<p>正文</p>'));
    const page = await fetchDetailPage('https://example.com/notice/1', request);
    expect(page.status).toBe('blocked_by_robots');
    expect(page.text).toBe('');
  });

  it('strips markup down to text', async () => {
    const request = url => Promise.resolve(url.endsWith('/robots.txt')
      ? robotsResponse('')
      : htmlResponse('<style>x{}</style><h1>报名通知</h1><script>bad()</script><p>正文内容</p>'));
    const page = await fetchDetailPage('https://example.com/notice/1', request);
    expect(page.status).toBe('ok');
    expect(page.text).toContain('报名通知');
    expect(page.text).not.toContain('bad()');
  });

  it('rejects a url that is not http', async () => {
    expect((await fetchDetailPage('ftp://example.com/x', () => {})).status).toBe('unsupported_protocol');
    expect((await fetchDetailPage('not a url', () => {})).status).toBe('invalid_url');
  });

  it('does not call the model when the page could not be read', async () => {
    // 没有正文，任何抽取都只能是编造 —— 这时候调模型是在烧配额买假数据。
    let modelCalled = false;
    const request = url => {
      if (url.includes('chat/completions')) { modelCalled = true; return Promise.resolve(htmlResponse('{}')); }
      if (url.endsWith('/robots.txt')) return Promise.resolve(robotsResponse(''));
      return Promise.resolve({ ok:false, status:404, headers:{ get:() => 'text/html' }, text:async () => '' });
    };
    const original = process.env.AI_API_KEY;
    process.env.AI_API_KEY = 'test-key';
    try {
      const result = await extractFromDetailPage('https://example.com/gone', request);
      expect(result.ok).toBe(false);
      expect(result.status).toBe('http_404');
      expect(modelCalled).toBe(false);
    } finally {
      if (original === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = original;
    }
  });

  it('refuses to run without an api key', async () => {
    const original = process.env.AI_API_KEY;
    delete process.env.AI_API_KEY;
    try {
      await expect(extractFromDetailPage('https://example.com/x', () => {})).rejects.toThrow('ai_api_key_not_configured');
    } finally {
      if (original !== undefined) process.env.AI_API_KEY = original;
    }
  });
});

describe('never writes to the database', () => {
  it('reports applied:false so callers cannot mistake it for a write', async () => {
    const request = url => {
      if (url.endsWith('/robots.txt')) return Promise.resolve({ ok:true, status:200, headers:{ get:() => 'text/plain' }, text:async () => '' });
      if (url.includes('chat/completions')) {
        return Promise.resolve({
          ok:true, status:200, headers:{ get:() => 'application/json' },
          text:async () => JSON.stringify({ choices:[{ message:{ content:JSON.stringify({
            organizer:{ value:'中国图象图形学学会', quote:'中国图象图形学学会主办' },
            reward_highlights:[], authority_signals:[], recognition_hints:[], missing:[],
          }) } }] }),
        });
      }
      return Promise.resolve({ ok:true, status:200, headers:{ get:() => 'text/html' }, text:async () => `<p>${SOURCE}</p>` });
    };
    const original = process.env.AI_API_KEY;
    process.env.AI_API_KEY = 'test-key';
    try {
      const result = await extractFromDetailPage('https://example.com/notice', request);
      expect(result.ok).toBe(true);
      expect(result.applied).toBe(false);
      expect(result.suggestions[0].field).toBe('organizer');
    } finally {
      if (original === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = original;
    }
  });
});

describe('refusing a page that only rendered its navigation', () => {
  const { BOILERPLATE_MIN_CHARS, looksLikeContestPage } = require('../apps/miniprogram/cloudfunctions/adminData/competitionExtract.js');

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

  it('does not call the model for a shell page', async () => {
    // 把导航骨架送进模型只会烧配额换垃圾。
    let modelCalled = false;
    const request = url => {
      if (url.includes('chat/completions')) { modelCalled = true; return Promise.resolve({ ok:true, status:200, headers:{ get:() => 'application/json' }, text:async () => '{}' }); }
      if (url.endsWith('/robots.txt')) return Promise.resolve({ ok:true, status:200, headers:{ get:() => 'text/plain' }, text:async () => '' });
      return Promise.resolve({ ok:true, status:200, headers:{ get:() => 'text/html' }, text:async () => `<p>${TIANCHI_SHELL.repeat(3)}</p>` });
    };
    const original = process.env.AI_API_KEY;
    process.env.AI_API_KEY = 'test-key';
    try {
      const result = await extractFromDetailPage('https://tianchi.aliyun.com/competition/entrance/532514', request, { contestName:'蚂蚁灵波具身大模型挑战赛' });
      expect(result.ok).toBe(false);
      expect(result.status).toBe('page_is_boilerplate');
      expect(modelCalled).toBe(false);
    } finally {
      if (original === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = original;
    }
  });

  it('accepts text the caller fetched through the site own api', async () => {
    // 前后端分离的站点要走各自的接口取正文，那件事在服务器侧爬虫里做。
    let modelCalled = false;
    const request = url => {
      if (url.includes('chat/completions')) {
        modelCalled = true;
        return Promise.resolve({ ok:true, status:200, headers:{ get:() => 'application/json' },
          text:async () => JSON.stringify({ choices:[{ message:{ content:JSON.stringify({ organizer:null, reward_highlights:[], authority_signals:[], recognition_hints:[], missing:[] }) } }] }) });
      }
      return Promise.resolve({ ok:false, status:404, headers:{ get:() => 'text/html' }, text:async () => '' });
    };
    const original = process.env.AI_API_KEY;
    process.env.AI_API_KEY = 'test-key';
    try {
      const result = await extractFromDetailPage('https://tianchi.aliyun.com/competition/entrance/532514', request, {
        contestName:'蚂蚁灵波具身大模型挑战赛',
        text:'蚂蚁灵波具身大模型挑战赛由蚂蚁灵波科技、魔搭社区、阿里云天池共同发起。奖金设置：一等奖1名，现金80000元。'.repeat(4),
      });
      expect(result.ok).toBe(true);
      expect(modelCalled).toBe(true);
    } finally {
      if (original === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = original;
    }
  });
});

describe('registration organization must land on the schema enum', () => {
  const { REGISTRATION_ORGANIZATIONS } = require('../apps/miniprogram/cloudfunctions/adminData/competitionValue.js');

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

  it('spells the enum out in the prompt', () => {
    const prompt = buildExtractPrompt('正文', '某赛事');
    for (const value of REGISTRATION_ORGANIZATIONS) expect(prompt).toContain(value);
    expect(prompt).toContain('不要自己造措辞');
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

  it('turns verified dates into field suggestions', () => {
    const verified = verifyAgainstSource({
      registration_end:{ value:'2026-11-20', quote:'报名时间为2026年10月15日至2026年11月20日' },
    }, DATE_SOURCE);
    const suggestions = toFieldSuggestions(verified, 'https://example.com');
    expect(suggestions).toContainEqual(expect.objectContaining({ field:'registration_end', value:'2026-11-20' }));
  });

  it('documents the required date format in the prompt', () => {
    const prompt = buildExtractPrompt('正文', '某赛事');
    expect(prompt).toContain('registration_start');
    expect(prompt).toContain('registration_end');
    expect(prompt).toContain('YYYY-MM-DD');
  });
});

describe('anchors instead of full quotes', () => {
  const {
    ANCHOR_MIN_LENGTH, ANCHOR_MAX_LENGTH, MAX_ANCHOR_OCCURRENCES, expandAnchor,
  } = require('../apps/miniprogram/cloudfunctions/adminData/competitionExtract.js');

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

  it('asks the model for anchors, not whole sentences', () => {
    const prompt = buildExtractPrompt('正文', '某赛事');
    expect(prompt).toContain('anchor');
    expect(prompt).toContain('不要抄整句');
    expect(prompt).toContain('每个数组最多 4 项');
  });
});

describe('staying inside the 60 second cloud function limit', () => {
  const {
    MIN_CHAT_TIMEOUT_MS, TOTAL_BUDGET_MS, remainingChatBudget,
  } = require('../apps/miniprogram/cloudfunctions/adminData/competitionExtract.js');

  it('gives the model whatever is left after fetching the page', () => {
    // 被平台掐死时什么都拿不到，连失败原因都没有，所以自己先收口。
    const start = 1_000_000;
    expect(remainingChatBudget(start, undefined, start + 20_000))
      .toBeLessThan(remainingChatBudget(start, undefined, start + 5_000));
    expect(remainingChatBudget(start, undefined, start)).toBeLessThanOrEqual(TOTAL_BUDGET_MS);
  });

  it('never lets fetch plus chat exceed the budget', () => {
    const start = 1_000_000;
    for (const spent of [0, 3_000, 10_000, 25_000, 40_000]) {
      const budget = remainingChatBudget(start, 60_000, start + spent);
      expect(spent + Math.max(budget, 0)).toBeLessThan(TOTAL_BUDGET_MS);
    }
  });

  it('reports budget_exhausted instead of firing a doomed request', async () => {
    let modelCalled = false;
    const request = url => {
      if (url.includes('chat/completions')) { modelCalled = true; return Promise.resolve({ ok:true, status:200, headers:{ get:() => 'application/json' }, text:async () => '{}' }); }
      if (url.endsWith('/robots.txt')) return Promise.resolve({ ok:true, status:200, headers:{ get:() => 'text/plain' }, text:async () => '' });
      return Promise.resolve({ ok:true, status:200, headers:{ get:() => 'text/html' }, text:async () => `<p>${SOURCE}</p>` });
    };
    const original = process.env.AI_API_KEY;
    process.env.AI_API_KEY = 'test-key';
    try {
      // 假装这次调用已经开始了 50 秒 —— 剩下的时间不够再发一次模型请求。
      const result = await extractFromDetailPage('https://example.com/notice', request, {
        contestName:'', startedAt:Date.now() - (TOTAL_BUDGET_MS - MIN_CHAT_TIMEOUT_MS + 1000),
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe('budget_exhausted');
      expect(modelCalled).toBe(false);
    } finally {
      if (original === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = original;
    }
  });
});

describe('max_tokens is a ceiling, not a target', () => {
  const { DEFAULT_MAX_TOKENS } = require('../apps/miniprogram/cloudfunctions/adminData/competitionExtract.js');

  it('leaves enough room that the model does not return empty content', () => {
    // 收紧到 900 会让 kimi-for-coding 返回空内容 —— 它先消耗 token 做内部推理。
    // 本轮早先在 AI 审核上踩过同一个坑，抽取这里又踩了一次。
    // 降低耗时要靠减少实际生成量（锚点），不是靠压上限。
    expect(DEFAULT_MAX_TOKENS).toBeGreaterThanOrEqual(1600);
  });
});

describe('batch extraction can point at a different provider', () => {
  const { readAiConfig, aiReviewConfigStatus } = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');
  const kimi = { AI_API_KEY:'k'.repeat(72), AI_MODEL:'kimi-for-coding', AI_BASE_URL:'https://api.kimi.com/coding/v1' };

  it('falls back to the review provider when nothing extra is configured', () => {
    // 不配 EXTRACT_* 就是维持原状，不该有任何行为变化。
    const extract = readAiConfig({ ...kimi }, 'EXTRACT_');
    expect(extract.apiKey).toBe(kimi.AI_API_KEY);
    expect(extract.baseUrl).toBe(kimi.AI_BASE_URL);
    expect(aiReviewConfigStatus({ ...kimi }, () => {}).extract.sharesReviewProvider).toBe(true);
  });

  it('uses its own provider when fully configured', () => {
    // 抽取是突发型负载：几百场集中跑会撞上会员制的窗口配额。
    const extract = readAiConfig({
      ...kimi, EXTRACT_AI_BASE_URL:'https://api.deepseek.com',
      EXTRACT_AI_API_KEY:'d'.repeat(35), EXTRACT_AI_MODEL:'deepseek-flash',
    }, 'EXTRACT_');
    expect(extract.baseUrl).toBe('https://api.deepseek.com');
    expect(extract.model).toBe('deepseek-flash');
    expect(extract.apiKey).toHaveLength(35);
  });

  it('refuses to send one provider key to another provider url', () => {
    // 只配地址、漏配密钥时，逐项回退会把 Kimi 的密钥发到 DeepSeek 去 ——
    // 那等于把密钥泄露给第三方。这种配置一律当成未配置。
    const broken = readAiConfig({ ...kimi, EXTRACT_AI_BASE_URL:'https://api.deepseek.com' }, 'EXTRACT_');
    expect(broken.apiKey).toBe('');
    expect(broken.keyMissingForOwnBaseUrl).toBe(true);
  });

  it('surfaces the misconfiguration without leaking either key', () => {
    const status = aiReviewConfigStatus({ ...kimi, EXTRACT_AI_BASE_URL:'https://api.deepseek.com' }, () => {});
    expect(status.extract.keyMissingForOwnBaseUrl).toBe(true);
    expect(status.extract.apiKeyConfigured).toBe(false);
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain('kkkk');
    expect(serialized).not.toContain('dddd');
  });

  it('records which model actually produced a result', async () => {
    const request = url => {
      if (url.endsWith('/robots.txt')) return Promise.resolve({ ok:true, status:200, headers:{ get:() => 'text/plain' }, text:async () => '' });
      if (url.includes('chat/completions')) {
        return Promise.resolve({ ok:true, status:200, headers:{ get:() => 'application/json' },
          text:async () => JSON.stringify({ choices:[{ message:{ content:JSON.stringify({ organizer:null, reward_highlights:[], authority_signals:[], recognition_hints:[], missing:[] }) } }] }) });
      }
      return Promise.resolve({ ok:true, status:200, headers:{ get:() => 'text/html' }, text:async () => `<p>${SOURCE}</p>` });
    };
    const saved = { key:process.env.AI_API_KEY, model:process.env.EXTRACT_AI_MODEL };
    process.env.AI_API_KEY = 'test-key';
    process.env.EXTRACT_AI_MODEL = 'deepseek-flash';
    try {
      const result = await extractFromDetailPage('https://example.com/notice', request);
      expect(result.model).toBe('deepseek-flash');
    } finally {
      if (saved.key === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = saved.key;
      if (saved.model === undefined) delete process.env.EXTRACT_AI_MODEL; else process.env.EXTRACT_AI_MODEL = saved.model;
    }
  });
});

describe('surviving what a second provider actually returns', () => {
  const {
    MAX_ANCHOR_OCCURRENCES, expandAnchor,
  } = require('../apps/miniprogram/cloudfunctions/adminData/competitionExtract.js');
  const {
    extractFirstJsonObject, parseModelJson,
  } = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');

  it('reads the first json object even when prose follows it', () => {
    // deepseek-flash 实测这样返回过，报 Unexpected non-whitespace character after JSON。
    expect(parseModelJson('{"a":1} 以上是我的分析。')).toEqual({ a:1 });
    expect(parseModelJson('{"a":1}\n{"b":2}')).toEqual({ a:1 });
  });

  it('does not miscount braces inside strings', () => {
    // 用 lastIndexOf 找结尾时，值里的大括号会把范围切错。
    expect(parseModelJson('{"note":"含{大括号}的值"} 说明')).toEqual({ note:'含{大括号}的值' });
    expect(extractFirstJsonObject('前言 {"a":{"b":1}} 后记')).toBe('{"a":{"b":1}}');
  });

  it('still fails loudly when there is no object at all', () => {
    expect(() => parseModelJson('我无法完成这个任务')).toThrow('ai_review_unparsable_response');
    expect(() => parseModelJson('')).toThrow('ai_review_empty_response');
  });

  it('keeps an anchor that repeats once per prize tier', () => {
    // 「官方荣誉证书」会在一等奖、二等奖、三等奖各出现一次，
    // 那是合理重复而不是措辞空泛。阈值定成 3 时实测把它误杀了。
    const tiers = '一等奖：现金80000元 + 官方荣誉证书。二等奖：现金30000元 + 官方荣誉证书。'
      + '三等奖：现金10000元 + 官方荣誉证书。优胜奖：官方荣誉证书。';
    expect(expandAnchor('官方荣誉证书', tiers)).not.toBeNull();
    expect(MAX_ANCHOR_OCCURRENCES).toBeGreaterThan(4);
  });

  it('keeps only one entry per reward value', () => {
    // 模型会为不同奖项档位重复列出同一个 value，实测返回过两条「实物奖品」。
    const tiers = '一等奖：现金80000元。二等奖：现金30000元。三等奖：官方荣誉证书。';
    const verified = verifyAgainstSource({
      reward_highlights:[
        { value:'实物奖品', anchor:'现金80000元' },
        { value:'实物奖品', anchor:'现金30000元' },
        { value:'证书荣誉', anchor:'官方荣誉证书' },
      ],
    }, tiers);
    expect(verified.reward_highlights.map(item => item.value)).toEqual(['实物奖品', '证书荣誉']);
  });
});

describe('deepseek thinking mode', () => {
  const {
    adjustRequestOptions, buildRequestBody, supportsThinkingToggle,
  } = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');

  it('turns thinking off for deepseek, and only for deepseek', () => {
    // 思考模式默认打开、effort 默认 high，思维链会先吃掉 max_tokens ——
    // 实测 5 条里有 2 条因此返回空 content。抽取是机械任务，思考不提高准确性。
    const deepseek = buildRequestBody({ model:'deepseek-flash', baseUrl:'https://api.deepseek.com' }, [], {});
    expect(deepseek.thinking).toEqual({ type:'disabled' });

    // 这个参数别家不认识，带上去可能直接 400。
    const kimi = buildRequestBody({ model:'kimi-for-coding', baseUrl:'https://api.kimi.com/coding/v1' }, [], {});
    expect(kimi.thinking).toBeUndefined();
    expect(supportsThinkingToggle('https://api.deepseek.com')).toBe(true);
    expect(supportsThinkingToggle('https://api.kimi.com/coding/v1')).toBe(false);
  });

  it('drops the parameter if the provider rejects it', () => {
    const next = adjustRequestOptions(400, 'unknown field: thinking', { disableThinking:true, useJsonSchema:true, includeTemperature:true });
    expect(next.disableThinking).toBe(false);
    expect(buildRequestBody({ model:'m', baseUrl:'https://api.deepseek.com' }, [], next).thinking).toBeUndefined();
  });
});

describe('evidence is taken by block, never cut mid-line', () => {
  const {
    MAX_QUOTE_LENGTH: QUOTE_CAP, expandAnchor: expandBlock, toStructuredText,
  } = require('../apps/miniprogram/cloudfunctions/adminData/competitionExtract.js');

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
  const { expandAnchor: expandBlock } = require('../apps/miniprogram/cloudfunctions/adminData/competitionExtract.js');

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
  const { expandAnchor: expandBlock } = require('../apps/miniprogram/cloudfunctions/adminData/competitionExtract.js');
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
  } = require('../apps/miniprogram/cloudfunctions/adminData/competitionExtract.js');

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
