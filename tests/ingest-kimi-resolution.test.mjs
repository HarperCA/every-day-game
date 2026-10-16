import fs from 'node:fs';
import { expect, it, vi } from 'vitest';

// Exercise the actual intake entry point with deterministic AI/network dependencies.
const source = fs.readFileSync(new URL('../scripts/server/ingest-candidates.mjs', import.meta.url), 'utf8');
const functionSource = source.slice(source.indexOf('async function applyIntakeDecision('), source.indexOf('\nfunction parseArgs('));
function harness(resolution, decision = 'kimi_review', aiConfigured = true) {
  const resolve = vi.fn(async () => {
    if (resolution instanceof Error) throw resolution;
    return resolution;
  });
  const build = new Function('classifyIntake', 'aiConfigured', 'runFieldVerification', 'PROFESSION_TAXONOMY',
    'applyFieldVerification', 'resolveFailedCompetition', 'logReasoning', 'thinkingEnabled', 'sleep', 'KIMI_CALL_DELAY_MS',
    `return ${functionSource}`);
  const verify = vi.fn(async () => ({all_correct:false, professions:[], evidence_status:[]}));
  return {
    resolve,
    verify,
    run:build(() => ({decision,reason:'报名日期需要核实'}), aiConfigured,
      verify, [],
      record => ({...record, dataStatus:'draft'}), resolve, () => () => {}, () => false, async () => {}, 0),
  };
}
const record = {id:'contest', name:'大学生编程竞赛', dataStatus:'draft', qualityIssues:[], schedule:{}};
const now = new Date('2026-10-09T00:00:00Z');

for (const [outcome,label] of [['published','auto-publish'],['archived','archive'],['delete','delete']]) {
  it(`routes failed intake verification to agent disposition: ${outcome}`, async () => {
    const disposition = {outcome, record:outcome === 'delete' ? null : {...record, dataStatus:outcome}, reason:'已核实原因'};
    const test = harness(disposition);
    const result = await test.run(record, [record], now);
    expect(result).toEqual({...disposition,label});
    expect(test.resolve).toHaveBeenCalledWith(record, expect.objectContaining({all_correct:false}),
      expect.objectContaining({records:[record],now}));
  });
}
it('retains a complete draft with retry metadata when infrastructure fails', async () => {
  const test = harness(new Error('network timeout'));
  const result = await test.run(record, [], now);
  expect(result.record.id).toBe(record.id);
  expect(result.record.dataStatus).toBe('draft');
  expect(result.record.aiResolutionFailure).toMatchObject({error:'network timeout', retryAfter:'2026-10-09T00:30:00.000Z'});
  expect(result.label).toBe('review');
});
for (const decision of ['hold','manual_review']) {
  it(`sends ${decision} candidates to the agent instead of leaving indefinite drafts`, async () => {
    const test = harness({outcome:'published', record:{...record,dataStatus:'published'},reason:'已补证'}, decision);
    const result = await test.run(record, [], now);
    expect(result.label).toBe('auto-publish');
    expect(test.resolve).toHaveBeenCalledOnce();
    expect(test.verify).not.toHaveBeenCalled();
  });
}
it('does not invoke paid APIs in dry-run', async () => {
  const test = harness(null, 'manual_review');
  const result = await test.run(record, [], now, {dryRun:true});
  expect(result.record.id).toBe(record.id);
  expect(test.resolve).not.toHaveBeenCalled();
  expect(test.verify).not.toHaveBeenCalled();
});
it('retains retry metadata when Kimi is not configured', async () => {
  const test = harness(null, 'hold', false);
  const result = await test.run(record, [], now);
  expect(result.record.stalenessExempt).toBe(false);
  expect(result.record.aiResolutionFailure.retryAfter).toBe('2026-10-09T00:30:00.000Z');
  expect(test.resolve).not.toHaveBeenCalled();
});
for (const decision of ['kimi_review','archive']) {
  it(`routes admission review to the agent even when the date classifier says ${decision}`, async () => {
    const disposition = {outcome:'delete',record:null,reason:'未找到可靠官方证据'};
    const test = harness(disposition, decision);
    const result = await test.run({...record,admissionVerdict:'review'}, [], now);
    expect(result).toEqual({...disposition,label:'delete'});
    expect(test.resolve).toHaveBeenCalledOnce();
    expect(test.verify).not.toHaveBeenCalled();
  });
}
