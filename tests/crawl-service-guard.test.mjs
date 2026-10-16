import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beijingDate, planIsUsable, preflight, recordFailure } from '../scripts/server/crawl-service-guard.mjs';

const dirs = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawl-guard-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive:true, force:true }); });

describe('crawl service preflight', () => {
  it('uses Beijing date and accepts a generated plan', async () => {
    const here = tmp();
    const now = new Date('2026-10-03T17:00:00Z');
    const status = await preflight({ here, now, log:() => {}, spawn:(_node, args) => {
      fs.writeFileSync(path.join(here, 'plans', 'search-plan-2026-10-04.json'), JSON.stringify({ search:[], trace:{} }));
      expect(args).toContain('2026-10-04');
      return { status:0 };
    } });
    expect(beijingDate(now)).toBe('2026-10-04');
    expect(planIsUsable({ search:[], trace:{} })).toBe(true);
    expect(status).toMatchObject({ usable:true, attempted:true });
  });

  it('records plan failure but still permits the crawl', async () => {
    const here = tmp();
    const status = await preflight({ here, now:new Date('2026-10-03T17:00:00Z'), log:() => {},
      spawn:() => ({ status:1 }) });
    expect(status).toMatchObject({ usable:false, attempted:true, error:'搜索计划退出码 1' });
    expect(JSON.parse(fs.readFileSync(path.join(here, 'plans', 'crawl-plan-preflight.json'))).usable).toBe(false);
  });
});

describe('aborted crawl accounting', () => {
  it('records a systemd timeout against the current run', async () => {
    const here = tmp();
    const now = new Date();
    const startedAt = new Date(now.getTime() - 30000).toISOString();
    const runId = new Date(now.getTime() - 29000).toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(path.join(here, 'plans'));
    fs.mkdirSync(path.join(here, 'runs', runId), { recursive:true });
    fs.writeFileSync(path.join(here, 'plans', 'crawl-service-start.json'), JSON.stringify({ startedAt }));
    const posted = [];
    const result = await recordFailure({ here, now, result:'timeout', exitCode:'killed', exitStatus:'TERM',
      post:async ledger => posted.push(ledger), log:() => {} });
    expect(result.runId).toBe(runId);
    expect(result.ledger.status).toBe('failed');
    expect(result.ledger.failures[0].reason).toContain('timeout');
    expect(posted).toHaveLength(1);
    expect(fs.existsSync(path.join(here, 'runs', runId, 'result-ledger.json'))).toBe(true);
    const repeat = await recordFailure({ here, now, result:'timeout', post:async () => { throw Error('should not post'); } });
    expect(repeat.skipped).toBe('pipeline_already_recorded');
  });
});
