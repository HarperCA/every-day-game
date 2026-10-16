import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOCK_CHILD_FLAG, runWithPipelineLock } from '../scripts/server/pipeline-lock.mjs';
const directories = [];
const directory = () => { const value = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-lock-test-')); directories.push(value); return value; };
afterEach(() => directories.splice(0).forEach(value => fs.rmSync(value, { recursive:true, force:true })));
describe('pipeline lifetime lock', () => {
  it('locks before invoking the pipeline and preserves dry-run arguments', () => {
    const dir = directory();
    const spawn = vi.fn(() => ({ status:0 }));
    expect(runWithPipelineLock({ directory:dir, script:'/tmp/pipeline.mjs', args:['--dry-run', '--sources', 'baidu'], env:{ CUSTOM:'retained' }, spawn, platform:'linux' })).toBe(0);
    expect(spawn).toHaveBeenCalledWith('flock', ['-n', '-E', '75', path.join(dir, 'crawl-pipeline.flock'), process.execPath, '/tmp/pipeline.mjs', '--dry-run', '--sources', 'baidu'], { stdio:'inherit', env:{ CUSTOM:'retained', [LOCK_CHILD_FLAG]:'1' } });
  });
  it('refuses a busy lock without attempting an unlocked fallback', () => {
    const spawn = vi.fn(() => ({ status:75 }));
    expect(() => runWithPipelineLock({ directory:directory(), script:'/tmp/pipeline.mjs', spawn, platform:'linux' })).toThrow('拒绝并行');
    expect(spawn).toHaveBeenCalledTimes(1);
  });
  it('fails closed if flock is missing or terminated', () => {
    expect(() => runWithPipelineLock({ directory:directory(), script:'/tmp/pipeline.mjs', spawn:() => ({ error:new Error('ENOENT') }), platform:'linux' })).toThrow('ENOENT');
    expect(() => runWithPipelineLock({ directory:directory(), script:'/tmp/pipeline.mjs', spawn:() => ({ signal:'SIGTERM' }), platform:'linux' })).toThrow('SIGTERM');
  });
  it('propagates the child failure and requires the production platform', () => {
    expect(runWithPipelineLock({ directory:directory(), script:'/tmp/pipeline.mjs', spawn:() => ({ status:2 }), platform:'linux' })).toBe(2);
    expect(() => runWithPipelineLock({ directory:directory(), script:'/tmp/pipeline.mjs', platform:'win32' })).toThrow('Linux');
  });
});
