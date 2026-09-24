import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildReviewNotes, candidateToRecord, toSafeId } = require('../apps/miniprogram/cloudfunctions/adminData/candidateToRecord.js');
const { toPublicCache } = require('../apps/miniprogram/cloudfunctions/adminData/publicCache.js');
const { isNonEventTitle } = require('../apps/miniprogram/cloudfunctions/adminData/noticeResolution.js');

const candidate = {
  externalId:'tianchi-532503',
  name:'欧莱雅美妆科技黑客松 - 赛题1',
  seriesName:'欧莱雅美妆科技黑客松',
  detailUrl:'https://tianchi.aliyun.com/competition/entrance/532503',
  tags:['多模态', '智能体'],
  reward_amount:200000,
  participant_count:451,
  participant_unit:'队',
  registration_start:'2026-07-16T16:00:00.000Z',
  registration_end:'2026-10-20T15:59:59.000Z',
};

const extraction = {
  ok:true,
  extracted:{
    organizer:{ value:'欧莱雅中国', quote:'**主办单位**：欧莱雅中国' },
    reward_highlights:[
      { value:'现金奖金', quote:'**20 万总奖金池，激励创新成果落地**' },
      { value:'实习或直通面试', quote:'表现优异的参赛团队将有机会获得欧莱雅暑期实习直通面试机会' },
    ],
    authority_signals:[{ signal:'支持单位包括阿里云、机器之心', quote:'支持单位：美创静界、阿里云、机器之心' }],
    recognition_hints:[{ path:'求职就业', level:'中', quote:'表现优异的参赛团队将有机会获得欧莱雅暑期实习直通面试机会', scope:[] }],
    missing:['保研加分相关说明'],
  },
};

describe('a crawled candidate always lands as a draft', () => {
  it('recognizes list pages and a post-final report as non-events', () => {
    expect(['大赛动态','国赛公告','通知公告','竞赛分类:','前沿之声|5月学术资讯速递','2026年河南工程学院A、B、C类学科竞赛目录清单','2026年AI赋能千行百业超级联赛人工智能+广电视听创新应用大赛决赛在京举行'].every(isNonEventTitle)).toBe(true);
    expect(isNonEventTitle('2026年全国大学生数学建模竞赛')).toBe(false);
  });
  it('never converts a notice title into a competition record', () => {
    expect(() => candidateToRecord({ ...candidate, name:'关于某学院举办2026年全国大学生创新赛的通知', detailUrl:'https://school.example.edu/notice' }, { ok:false })).toThrow('blocked_competition_title');
  });
  it('recognizes a government notice even when the search title appends a website section', () => {
    expect(() => candidateToRecord({ ...candidate, name:'福建省教育厅关于公布竞赛项目的通知_ 重要文件_ 福建省教育厅' }, { ok:false })).toThrow('blocked_competition_title');
  });
  it('rejects a notice series label even when the candidate name is clean', () => {
    expect(() => candidateToRecord({ ...candidate, seriesName:'赛事通知｜大学生竞赛' }, { ok:false })).toThrow('blocked_competition_title');
  });
  it('rejects promotional exclamation and launch headlines before conversion', () => {
    expect(() => candidateToRecord({ ...candidate, name:'大学生创新大赛正式启动！' }, { ok:false })).toThrow('blocked_competition_title');
    expect(() => candidateToRecord({ ...candidate, name:'大学生创新大赛正式开启' }, { ok:false })).toThrow('blocked_competition_title');
  });
  it('never arrives already published', () => {
    const record = candidateToRecord(candidate, extraction);
    expect(record.dataStatus).toBe('draft');
    expect(record.systemValidation).toBe('not_run');
    expect(record.manualReview).toBe('pending');
  });
  it('separates candidate year and edition number from the display title', () => {
    const record = candidateToRecord({...candidate, name:'2026年第八届全国大学生设计大赛', seriesName:''}, extraction);
    expect(record.name).toBe('全国大学生设计大赛');
    expect(record.editionYear).toBe('2026');
    expect(record.editionOrdinal).toBe('第八届');
    expect(record.editionName).toBe('2026年第八届全国大学生设计大赛');
  });

  it('is refused by the publish gate', () => {
    // 抓来的东西绕不过人工：发布闸要求 published + 双审通过 + 有效官方来源。
    expect(() => toPublicCache(candidateToRecord(candidate, extraction))).toThrow('public_cache_requires_published_record');
  });

  it('does not claim the crawled source is official', () => {
    // 来源尚未核验就自称官方，等于替发布闸放水。
    const [source] = candidateToRecord(candidate, extraction).sources;
    expect(source.is_official).toBe(false);
    expect(source.validity_status).toBe('unchecked');
  });
  it('keeps the discovery notice separate from the proposed contest page', () => {
    const record = candidateToRecord({...candidate, discoveryNoticeUrl:'https://school.example.edu/notice'}, extraction);
    expect(record.discoveryNoticeUrl).toBe('https://school.example.edu/notice');
    expect(record.sources).toHaveLength(2);
    expect(record.sources[1]).toMatchObject({source_type:'discovery_notice',is_official:false,validity_status:'unchecked'});
  });
});

describe('only facts that carry a quote get filled in', () => {
  it('copies the numbers the list api gave and derives their tiers', () => {
    const record = candidateToRecord(candidate, extraction);
    expect(record.rewardAmount).toBe(200000);
    expect(record.rewardTier).toBe('10万-50万');
    expect(record.participantCount).toBe(451);
    expect(record.scaleTier).toBe('千人以下');
  });

  it('keeps every recognition claim tied to its quote', () => {
    const record = candidateToRecord(candidate, extraction);
    expect(record.recognition).toHaveLength(1);
    expect(record.recognition[0].evidence).toContain('实习直通面试');
  });

  it('drops a recognition claim that lost its quote', () => {
    // normalizeRecognition 丢掉没有出处的条目 —— 和 AI 审核的取证要求一致。
    const noQuote = { ok:true, extracted:{ recognition_hints:[{ path:'保研考研', level:'高', quote:'' }], reward_highlights:[], authority_signals:[], missing:[] } };
    expect(candidateToRecord(candidate, noQuote).recognition).toEqual([]);
  });

  it('leaves the fields nobody verified empty', () => {
    const record = candidateToRecord(candidate, { ok:false });
    expect(record.organizer).toBe('');
    expect(record.recognition).toEqual([]);
    expect(record.rewardHighlights).toEqual([]);
    expect(record.lifecycle).toBe('暂未明确');
    expect(record.region).toBe('');
  });
});

describe('professions are a judgement, not a fact', () => {
  it('never guesses a profession from the source tags', () => {
    // 天池的「多模态」「智能体」和库里十三类专业分类不是一回事。
    const record = candidateToRecord(candidate, extraction);
    expect(record.professions).toEqual([]);
    expect(record.objectiveTags).toEqual(['多模态', '智能体']);
  });

  it('tells the reviewer which tags the source used', () => {
    const notes = buildReviewNotes(candidate, extraction.extracted);
    expect(notes.join()).toContain('专业分类待人工判定');
    expect(notes.join()).toContain('多模态');
  });
});

describe('registration dates from extraction win over the raw crawl fields', () => {
  // search-baidu.mjs 明确声明"报名时间一律留空待抽取"，所以 candidate 本身通常没有
  // 日期；这里用 tianchi 风格的 candidate（自带日期）来验证"抽取给了就优先用抽取的"。
  const withDates = {
    ok:true,
    extracted:{ ...extraction.extracted, registration_start:{ value:'2026-08-01', quote:'报名开始' }, registration_end:{ value:'2026-09-01', quote:'报名截止' } },
  };

  it('prefers the quote-verified extraction date over the raw crawl date', () => {
    const record = candidateToRecord(candidate, withDates);
    expect(record.schedule.registration_start).toBe('2026-08-01');
    expect(record.schedule.registration_end).toBe('2026-09-01');
  });

  it('falls back to the raw crawl date when extraction found none', () => {
    const record = candidateToRecord(candidate, extraction); // extraction 里没有日期
    expect(record.schedule.registration_start).toBe(candidate.registration_start);
    expect(record.schedule.registration_end).toBe(candidate.registration_end);
  });

  it('has no date at all when neither extraction nor the raw crawl provides one', () => {
    const noDates = { ...candidate, registration_start:undefined, registration_end:undefined };
    const record = candidateToRecord(noDates, { ok:false });
    expect(record.schedule.registration_start).toBeNull();
    expect(record.schedule.registration_end).toBeNull();
    expect(record.schedule.pending_announcement).toBe(false);
  });

  it('surfaces the extracted date to the reviewer with its quote', () => {
    const notes = buildReviewNotes(candidate, withDates.extracted);
    expect(notes.join()).toContain('报名开始时间待确认：2026-08-01');
    expect(notes.join()).toContain('报名截止时间待确认：2026-09-01');
  });
});

describe('what the reviewer sees', () => {
  it('puts every extracted fact next to the sentence that supports it', () => {
    const notes = buildReviewNotes(candidate, extraction.extracted);
    expect(notes.join()).toContain('主办方待确认：欧莱雅中国');
    expect(notes.join()).toContain('**主办单位**：欧莱雅中国');
    expect(notes.join()).toContain('原文未写明：保研加分相关说明');
  });

  it('marks a recognition level as needing confirmation', () => {
    // 正文能证明「有直通面试」，证明不了「求职认可度中」。
    expect(buildReviewNotes(candidate, extraction.extracted).join()).toContain('待人工确认');
  });
});

describe('ids', () => {
  it('builds stable ids so a re-run updates rather than duplicates', () => {
    const first = candidateToRecord(candidate, extraction).id;
    const second = candidateToRecord(candidate, extraction).id;
    expect(first).toBe(second);
    expect(first).toBe('edition-tianchi-532503');
  });

  it('strips characters an id cannot carry', () => {
    expect(toSafeId('edition', 'a/b c#d')).toBe('edition-a-b-c-d');
    expect(() => toSafeId('edition', '///')).toThrow('invalid_candidate_external_id');
  });
});
