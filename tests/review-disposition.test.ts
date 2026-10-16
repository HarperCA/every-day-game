import {it, expect} from 'vitest';
import {createRequire} from 'node:module';
import {applyReviewDisposition} from '../apps/admin/src/reviewDisposition';
const require=createRequire(import.meta.url);
const {isolateMisimport,requireReviewDisposition}=require('../apps/miniprogram/cloudfunctions/adminData/quarantine.js');
it('single, batch and scheduled review agree: identity problems go to the resolution agent, not quarantine',()=>{
  const record={id:'a',name:'全国大学生程序设计竞赛',dataStatus:'draft'};
  const review={decision:'needs_changes',risk_level:'high',issues:[{field:'event_identity',finding:'实际为获奖报道'}]};
  const client=applyReviewDisposition(record,review,'2026-09-22T00:00:00Z');
  const server=isolateMisimport({...record,aiReview:review},'2026-09-22T00:00:00Z');
  expect(client.dataStatus).toBe('draft');
  expect(server.dataStatus).toBe('draft');
  expect(client.quarantine).toBeUndefined();
  expect(()=>requireReviewDisposition([record],[client])).not.toThrow();
  expect(()=>requireReviewDisposition([record],[{...record,aiReview:review}])).not.toThrow();
});
it('a source access failure is not a non-event finding',()=>{
  expect(applyReviewDisposition({dataStatus:'draft'},{decision:'insufficient_evidence',risk_level:'high'}).dataStatus).toBe('draft');
});
