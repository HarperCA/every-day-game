// 搜索标题常是栏目名或网站口号（“学会动态”“激发学习英语的兴趣…”）：读完正文后改用正文里原样出现的比赛全称。
// 2026-09-29 那一轮，英语词汇竞赛、湖南化工设计竞赛就是因为拿搜索标题过范围闸被拒的。
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { verifyAgainstSource, toFieldSuggestions } = require('../apps/miniprogram/cloudfunctions/adminData/competitionExtract.js');
const { withVerifiedName, candidateToRecord } = require('../apps/miniprogram/cloudfunctions/adminData/candidateToRecord.js');
const { classifyCompetitionScope, assessIntakeRecord } = require('../apps/miniprogram/cloudfunctions/adminData/competitionScope.js');

const SOURCE = '学会动态\n各理事单位、各高校：学会将于2026年继续开展湖南省大学生化工设计竞赛活动。初赛由湖南省化学化工学会主办。'
  + '一、参赛对象 在读化学、化工及相关专业的本科生，以团队形式参赛。';

describe('抽取比赛全称', () => {
  it('名称在正文里逐字出现才保留，并带回原文引文', () => {
    const verified = verifyAgainstSource({ competition_name:{ value:'湖南省大学生化工设计竞赛', anchor:'湖南省大学生化工设计竞赛活动' } }, SOURCE);
    expect(verified.competition_name.value).toBe('湖南省大学生化工设计竞赛');
    expect(verified.competition_name.quote).toContain('继续开展湖南省大学生化工设计竞赛活动');
    expect(toFieldSuggestions(verified, 'http://x')[0]).toMatchObject({ field:'competition_name', value:'湖南省大学生化工设计竞赛' });
  });
  it('模型拼出来、正文里没有的名字丢弃', () => {
    const verified = verifyAgainstSource({ competition_name:{ value:'第十二届湖南省大学生化工设计大赛', anchor:'湖南省大学生化工设计竞赛活动' } }, SOURCE);
    expect(verified.competition_name).toBeNull();
    expect(verified.dropped.map(item => item.field)).toContain('competition_name');
  });
});

describe('入库时换用正文里的名称', () => {
  const extraction = { ok:true, extracted:{ competition_name:{ value:'湖南省大学生化工设计竞赛', quote:'学会将于2026年继续开展湖南省大学生化工设计竞赛活动。' } } };
  const searchHit = { externalId:'search-a401', name:'学会动态', detailUrl:'http://www.hncci.com/news/notice/a401.html', discovery:{ source:'百度AI搜索' } };

  it('搜索来的网页：用正文名称，并记下原搜索标题和依据', () => {
    const named = withVerifiedName(searchHit, extraction);
    expect(named).toMatchObject({ name:'湖南省大学生化工设计竞赛', searchTitle:'学会动态' });
    expect(classifyCompetitionScope({ name:searchHit.name }).reason).toBe('标题不是一场具体比赛');
    expect(classifyCompetitionScope({ ...named, participants:'在读化学、化工及相关专业的本科生', formatAndRules:'化工设计' }).decision).toBe('eligible');
    const record = candidateToRecord(named, extraction);
    expect(record.name).toBe('湖南省大学生化工设计竞赛');
    expect(record.qualityIssues[0]).toContain('搜索标题为「学会动态」');
  });
  it('平台登记的赛事照旧用平台名；抽不到名称的保留原标题', () => {
    const platform = { ...searchHit, name:'领域事件多因果关联挖掘', discovery:{ source:'datafountain' } };
    expect(withVerifiedName(platform, extraction).name).toBe('领域事件多因果关联挖掘');
    expect(withVerifiedName(searchHit, { ok:true, extracted:{ competition_name:null } }).name).toBe('学会动态');
    expect(withVerifiedName(searchHit, { ok:false }).name).toBe('学会动态');
  });
});

describe('参赛对象明确写了大学生，就算有资格依据', () => {
  const base = { name:'大学生英语翻译能力竞赛', organizer:'中国外文局亚太传播中心', formatAndRules:'英译汉组和汉译英组', sources:[{ url:'http://www.ncetac.com/' }], dataStatus:'draft' };
  it('参赛对象“在校大学生”、资格栏空：通过', () => {
    expect(assessIntakeRecord({ ...base, participants:'在校大学生', eligibility:'' }).decision).toBe('eligible');
  });
  it('参赛对象没写大学生、资格栏也空：仍要求资格依据', () => {
    const result = assessIntakeRecord({ ...base, name:'英语翻译能力竞赛', participants:'英语爱好者', eligibility:'' });
    expect(result.decision).toBe('pending');
  });
});
