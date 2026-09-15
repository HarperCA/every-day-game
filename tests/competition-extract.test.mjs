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
    expect(prompt).toContain('编造的 quote 会被系统丢弃');
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
