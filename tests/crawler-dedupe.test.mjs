import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  DUPLICATE_THRESHOLD, classifyCandidates, hostOf, matchCandidate, nameSimilarity, normalizeName,
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

  it('treats an unrelated contest as new', () => {
    const match = matchCandidate({ name:'蚂蚁灵波具身大模型挑战赛' }, masters);
    expect(match.verdict).toBe('new');
    expect(match.matchedId).toBeNull();
  });

  it('flags a same-domain contest as uncertain instead of merging it', () => {
    // 一个主办方站点下可能办多个赛事，域名相同不足以定案。
    const local = [{ id:'m1', standard_name:'甲赛事', aliases:[], website_url:'https://example.org/a', sourceHosts:[] }];
    const match = matchCandidate({ name:'完全无关的乙赛事', detailUrl:'https://example.org/b' }, local);
    expect(match.verdict).toBe('uncertain');
    expect(match.matchedId).toBe('m1');
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
