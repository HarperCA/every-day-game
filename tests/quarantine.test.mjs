import { createRequire } from 'node:module';
import { it, expect } from 'vitest';
const require=createRequire(import.meta.url);
const {isolateMisimport}=require('../apps/miniprogram/cloudfunctions/adminData/quarantine.js');
const {requireScopeForNewRecords}=require('../apps/miniprogram/cloudfunctions/adminData/competitionScope.js');
// 2026-10-09 起：身份有问题不再隔离，补上身份问题交给 Kimi 处置代理（已隔离的旧记录保持原样）
it('news title is handed to the resolution agent, not quarantined',()=>{
  const a={id:'a',name:'广西财经学院获2026年全国大学生测绘学科创新创业智能大赛一等奖',dataStatus:'published',sources:[{url:'https://example.edu/news'}]};
  const q=isolateMisimport(a);
  expect(q.dataStatus).toBe('published'); expect(q.sources).toEqual(a.sources);
  expect(q.aiReview.decision).toBe('needs_changes');
  expect(q.aiReview.issues.some(issue=>issue.field==='event_identity')).toBe(true);
  expect(q.needsManualReview).toBe(true);
  const old={...a,dataStatus:'quarantined'};
  expect(isolateMisimport(old)).toBe(old);
  expect(()=>requireScopeForNewRecords([old],[{...old,dataStatus:'draft'}])).toThrow();
});
it('insufficient evidence alone never means non-event',()=>{
  const a={name:'全国大学生程序设计竞赛',dataStatus:'draft',aiReview:{decision:'insufficient_evidence',risk_level:'high'}};
  expect(isolateMisimport(a)).toBe(a);
  const b={...a,aiReview:{decision:'needs_changes',risk_level:'high',issues:[{field:'event_identity',finding:'非赛事条目'}]}};
  expect(isolateMisimport(b).dataStatus).toBe('draft');
  expect(isolateMisimport(b).aiReview.decision).toBe('needs_changes');
});
it('does not quarantine specialized tasks just because the title lacks contest keywords',()=>{
  const a={name:'CHIP2026-面向生物医学全文的特定患者表型概念识别任务',dataStatus:'draft'};
  expect(isolateMisimport(a)).toBe(a);
});
it('a published school selection is handed to the resolution agent, not quarantined',()=>{
  const a={name:'第二十届“挑战杯”全国大学生课外学术科技作品竞赛某大学校级选拔赛',dataStatus:'published'};
  const q=isolateMisimport(a);
  expect(q.dataStatus).toBe('published');
  expect(q.aiReview.issues.find(issue=>issue.field==='event_identity').finding).toContain('下级选拔');
});
