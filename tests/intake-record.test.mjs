import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const {assessIntakeRecord, requireScopeForNewRecords} = require('../apps/miniprogram/cloudfunctions/adminData/competitionScope.js');
it('does not treat an unrelated historical ID collision as a restore',()=>{
  const old=[{id:'same',name:'目录',dataStatus:'quarantined'},{id:'same',name:'全国大学生程序设计竞赛',dataStatus:'draft'}];
  expect(()=>requireScopeForNewRecords(old,old)).not.toThrow();
});
it('title-only matches remain leads even with an admission score', () => {
  expect(assessIntakeRecord({name:'全国大学生程序设计竞赛',admissionVerdict:'admit'}).decision).toBe('pending');
  expect(() => requireScopeForNewRecords([], [{id:'new',name:'全国大学生程序设计竞赛'}])).toThrow('仅可保留为线索');
});
it('allows complete professional drafts without inventing approval', () => {
  const record={id:'new',name:'全国大学生程序设计竞赛',organizer:'主办高校',participants:'本科生',eligibility:'在校本科生',formatAndRules:'算法设计与编程',professions:['计算机'],sources:[{url:'https://example.edu/rules'}]};
  expect(assessIntakeRecord(record).decision).toBe('eligible');
  expect(() => requireScopeForNewRecords([], [record])).not.toThrow();
});
it('allows a complete draft to await Kimi profession classification, but not publication', () => {
  const record={id:'new',name:'全国大学生程序设计竞赛',organizer:'主办高校',participants:'本科生',eligibility:'在校本科生',formatAndRules:'算法设计与编程',professions:[],sources:[{url:'https://example.edu/rules'}],dataStatus:'draft'};
  expect(assessIntakeRecord(record).decision).toBe('eligible');
  expect(() => requireScopeForNewRecords([], [record])).not.toThrow();
  expect(assessIntakeRecord({...record,dataStatus:'published'}).decision).toBe('pending');
});
it.each(['广西财经学院获2026年全国大学生测绘学科创新创业智能大赛一等奖','2026年有哪些学科竞赛可以参加?送你一份全国大学生学科竞赛清单!让我们一起出发吧'])('rejects historical misimports: %s', name => {
  expect(assessIntakeRecord({name}).decision).toBe('reject');
});
