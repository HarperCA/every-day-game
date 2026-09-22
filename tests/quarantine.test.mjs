import { createRequire } from 'node:module';
import { it, expect } from 'vitest';
const require=createRequire(import.meta.url);
const {isolateMisimport}=require('../apps/miniprogram/cloudfunctions/adminData/quarantine.js');
const {requireScopeForNewRecords}=require('../apps/miniprogram/cloudfunctions/adminData/competitionScope.js');
it('isolates news without losing sources or deleting identities',()=>{
  const a={id:'a',name:'广西财经学院获2026年全国大学生测绘学科创新创业智能大赛一等奖',dataStatus:'published',sources:[{url:'https://example.edu/news'}]};
  const q=isolateMisimport(a);
  expect(q.dataStatus).toBe('quarantined'); expect(q.sources).toEqual(a.sources);
  expect(q.quarantine.previousStatus).toBe('published');
  expect(isolateMisimport(q)).toBe(q);
  expect(()=>requireScopeForNewRecords([q],[{...q,dataStatus:'draft'}])).toThrow();
});
it('insufficient evidence alone never means non-event',()=>{
  const a={name:'全国大学生程序设计竞赛',dataStatus:'draft',aiReview:{decision:'insufficient_evidence',risk_level:'high'}};
  expect(isolateMisimport(a)).toBe(a);
  const b={...a,aiReview:{decision:'needs_changes',risk_level:'high',issues:[{field:'event_identity',finding:'非赛事条目'}]}};
  expect(isolateMisimport(b).dataStatus).toBe('quarantined');
});
it('does not quarantine specialized tasks just because the title lacks contest keywords',()=>{
  const a={name:'CHIP2026-面向生物医学全文的特定患者表型概念识别任务',dataStatus:'draft'};
  expect(isolateMisimport(a)).toBe(a);
});
