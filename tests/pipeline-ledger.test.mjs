import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPipelineLedger } from '../scripts/server/pipeline-ledger.mjs';

test('结果账区分已证实的零与没有记录的数值，并合计两次 Jev 费用', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-ledger-'));
  try {
    fs.writeFileSync(path.join(root,'combined-extracted.json'), JSON.stringify({total:3,succeeded:2,
      results:[{ok:true},{ok:true},{ok:false,status:'http_403'}]}));
    fs.writeFileSync(path.join(root,'ingest-report.json'), JSON.stringify({persisted:true,
      eligibleDiscovered:1,added:0,qualifiedNew:0,publishedNew:0,publishedExisting:0,updated:1,enriched:1,
      addedIds:[],publishedIds:[],updatedIds:['old-1'],enrichedIds:['old-1'],failureReasons:{'资格未核实':2}}));
    fs.writeFileSync(path.join(root,'jev-filter-report.json'), JSON.stringify({total:10,fetch:3,leads:4,rejected:3,costUsd:0.012}));
    fs.writeFileSync(path.join(root,'notice-followup-filter-report.json'), JSON.stringify({fetch:1,costUsd:0.003}));
    const report = buildPipelineLedger(root,{summary:[{source:'baidu',fetched:30,new:10,duplicate:20}],extracted:3});
    assert.equal(report.searchResults,30);
    assert.equal(report.qualifiedNew,0);
    assert.equal(report.publishedTotal,0);
    assert.equal(report.existingEnriched,1);
    assert.equal(report.extractionSucceeded,2);
    assert.equal(report.costsUsd.jev,0.015);
    assert.equal(report.costsUsd.extraction,null);
    assert.deepEqual(report.failures.map(item=>item.count),[2,1]);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('旧运行缺失入库报告时不伪造零新增', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-ledger-'));
  try {
    const report = buildPipelineLedger(root,{summary:[],extracted:0});
    assert.equal(report.qualifiedNew,null);
    assert.equal(report.publishedNew,null);
    assert.equal(report.existingEnriched,null);
    assert.equal(report.costsUsd.jev,null);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
