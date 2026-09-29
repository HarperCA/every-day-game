import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  DUPLICATE_THRESHOLD, classifyCandidates, detectTier, hostOf, matchCandidate, nameSimilarity, normalizeName,
} from '../scripts/crawler/lib/dedupe.mjs';

const require = createRequire(import.meta.url);
const seed = require('../data/seed/competitions.json');
const masters = seed.event_masters.map(master => ({
  id:master.id, standard_name:master.standard_name, aliases:master.aliases || [],
  website_url:master.website_url || '', sourceHosts:[],
}));

describe('name normalization', () => {
  it('drops the things that identify an edition, not a contest', () => {
    // 届次、年份、引号、括号区分的是「哪一届」，不是「哪个赛事」。
    expect(normalizeName('第十九届“挑战杯”全国大学生课外学术科技作品竞赛'))
      .toBe(normalizeName('“挑战杯”全国大学生课外学术科技作品竞赛'));
    expect(normalizeName('2026年全国大学生数学建模竞赛')).toBe(normalizeName('全国大学生数学建模竞赛'));
    expect(normalizeName('中国大学生计算机设计大赛（2026）')).toBe(normalizeName('中国大学生计算机设计大赛'));
  });

  it('keeps the part that actually names the contest', () => {
    expect(normalizeName('第十九届挑战杯')).toBe('挑战杯');
    expect(normalizeName('')).toBe('');
  });
});

describe('tier detection', () => {
  it('does not mistake 大学生 for a school name', () => {
    // 「全国大学生数学建模竞赛」里的「大学」曾被当成校名，本体名被切成「生数学建模竞赛」。
    const national = detectTier('全国大学生数学建模竞赛');
    expect(national.tier).toBe('全国');
    expect(national.region).toBe('');
    expect(national.core).toBe('大学生数学建模竞赛');
  });

  it('strips the tier qualifier so two tiers share one core name', () => {
    expect(detectTier('四川省大学生物理实验竞赛').core)
      .toBe(detectTier('全国大学生物理实验竞赛').core);
  });

  it('leaves a plain contest name untouched', () => {
    const plain = detectTier('蚂蚁灵波具身大模型挑战赛');
    expect(plain.tier).toBe('');
    expect(plain.region).toBe('');
  });
});

describe('similarity', () => {
  it('separates two contests that merely share a brand', () => {
    // 两个「挑战杯」是不同赛事，误合并会直接污染数据。
    const score = nameSimilarity('“挑战杯”全国大学生课外学术科技作品竞赛', '“挑战杯”中国大学生创业计划竞赛');
    expect(score).toBeLessThan(DUPLICATE_THRESHOLD);
  });

  it('returns zero when either side is empty', () => {
    expect(nameSimilarity('', '全国大学生数学建模竞赛')).toBe(0);
  });
});

describe('matching against the existing library', () => {
  it('recognizes every stored contest by its own standard name', () => {
    // 判重逻辑如果连库里自己的名字都认不出来，后面的判断全不可信。
    for (const master of masters) {
      const match = matchCandidate({ name:master.standard_name }, masters);
      expect(match.verdict).toBe('duplicate');
      expect(match.matchedId).toBe(master.id);
    }
  });

  it('still recognizes a contest written with its edition number', () => {
    const match = matchCandidate({ name:'第十九届“挑战杯”全国大学生课外学术科技作品竞赛' }, masters);
    expect(match.verdict).toBe('duplicate');
  });

  it('catches a rename only because the old name was recorded as an alias', () => {
    // 规则本身识别不了改名；它命中靠的是 aliases 里存了旧名。
    // 没被记进别名的改名依然会漏 —— 那种情况只能靠人工或 AI。
    const match = matchCandidate({ name:'中国国际“互联网+”大学生创新创业大赛' }, masters);
    expect(['duplicate', 'likely_duplicate']).toContain(match.verdict);
    expect(match.reason).toContain('互联网+');
  });

  it('recognizes a contest whose name is buried inside a news headline', () => {
    // 新闻和获奖公示的标题里嵌着完整赛事名，但前后文本会把相似度稀释到阈值以下。
    // 实测就是这样把库里已有的机械创新设计大赛误判成「未收录」的。
    const headline = matchCandidate({ name:'“博实杯”第十二届全国大学生机械创新设计大赛常规赛全国决赛在哈尔滨工业大学成功举办' }, masters);
    expect(headline.verdict).toBe('duplicate');
    expect(headline.reason).toContain('完整包含');

    const notice = matchCandidate({ name:'关于公布第十一届全国大学生机械创新设计大赛决赛评审结果的通知' }, masters);
    expect(notice.verdict).toBe('duplicate');
  });

  it('links a provincial contest to its national parent without merging them', () => {
    // 同一个比赛常有校赛、省赛、国赛：报名时间、评分标准、进入难度都不同，
    // 所以不能合并成一条；但它也不是新赛事，要挂在同一个赛事下。
    const provincial = matchCandidate({ name:'四川省大学生物理实验竞赛' }, masters);
    expect(provincial.verdict).toBe('same_event_other_tier');
    expect(provincial.tier).toBe('省级');
    expect(provincial.region).toBe('四川省');
    const parent = masters.find(master => master.id === provincial.matchedId);
    expect(parent.standard_name).toContain('物理实验竞赛');
  });

  it('recognizes school and regional tiers too', () => {
    const regional = matchCandidate({ name:'华东赛区大学生物理实验竞赛' }, masters);
    expect(regional.verdict).toBe('same_event_other_tier');
    expect(regional.tier).toBe('区域级');

    const municipal = matchCandidate({ name:'北京市大学生数学建模竞赛' }, masters);
    expect(municipal.verdict).toBe('same_event_other_tier');
    expect(municipal.region).toBe('北京市');
  });

  it('keeps two contests sharing a brand apart under containment matching', () => {
    const startup = matchCandidate({ name:'“挑战杯”中国大学生创业计划竞赛' }, masters);
    const academic = masters.find(master => master.standard_name.includes('课外学术科技作品'));
    expect(startup.matchedId).not.toBe(academic.id);
  });

  it('treats an unrelated contest as new', () => {
    const match = matchCandidate({ name:'蚂蚁灵波具身大模型挑战赛' }, masters);
    expect(match.verdict).toBe('new');
    expect(match.matchedId).toBeNull();
  });

  it('same website is not enough: platform contests with different names are new', () => {
    // 天池、DataFountain 这类平台挂着几百场比赛，同一个网站说明不了是同一场（2026-09-29 起）。
    const local = [{ id:'m1', standard_name:'蚂蚁灵波具身大模型挑战赛', aliases:[], website_url:'https://tianchi.aliyun.com/competition/entrance/1', sourceHosts:['tianchi.aliyun.com'] }];
    const match = matchCandidate({ name:'CSIG图像图形技术挑战赛', detailUrl:'https://tianchi.aliyun.com/competition/entrance/2' }, local);
    expect(match.verdict).toBe('new');
  });

  it('an identical url is a duplicate even when the name differs', () => {
    const local = [{ id:'m1', standard_name:'甲赛事', aliases:[], website_url:'https://example.org/a', sourceUrls:['https://www.example.org/race?id=7'] }];
    const match = matchCandidate({ name:'换了个写法的名称', detailUrl:'http://example.org/race?id=7#top' }, local);
    expect(match).toMatchObject({ verdict:'duplicate', matchedId:'m1' });
    expect(matchCandidate({ name:'换了个写法的名称', detailUrl:'https://example.org/race?id=8' }, local).verdict).toBe('new');
  });

  it('rejects a candidate with no usable name', () => {
    expect(matchCandidate({ name:'   ' }, masters).verdict).toBe('invalid');
  });
});

describe('host parsing', () => {
  it('ignores the www prefix and bad input', () => {
    expect(hostOf('https://www.Example.com/x')).toBe('example.com');
    expect(hostOf('not a url')).toBe('');
  });
});

describe('classification buckets', () => {
  it('sorts candidates into reviewable groups', () => {
    const buckets = classifyCandidates([
      { name:masters[0].standard_name },
      { name:'蚂蚁灵波具身大模型挑战赛' },
      { name:'' },
    ], masters);
    expect(buckets.duplicate).toHaveLength(1);
    expect(buckets.new).toHaveLength(1);
    expect(buckets.invalid).toHaveLength(1);
  });
});
