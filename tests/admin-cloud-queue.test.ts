import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const audit = { id:'audit', action:'create', recordId:'one', recordName:'赛事', changedFields:[], createdAt:'2026-10-13', actor:'admin' };
const response = (data:unknown) => ({ ok:true, json:async () => ({ok:true,data}) });
const bootstrap = { records:[], audits:[], feedbacks:[], aiJobs:[], stateVersions:{records:0,feedbacks:0,aiJobs:0} };

describe('admin write queue', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('serializes simultaneous manual saves using each committed version', async () => {
    let release: (() => void) | undefined;
    const versions:number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.action === 'login') return response({sessionToken:'session'});
      if (body.action === 'bootstrap') return response(bootstrap);
      versions.push(body.expectedVersion);
      if (versions.length === 1) await new Promise<void>(resolve => { release=resolve; });
      return response({version:versions.length});
    }));
    const api = await import('../apps/admin/src/adminCloud');
    await api.connectAdminCloud('token');
    const first = api.saveManualRecords([{id:'one'}], audit);
    const second = api.saveManualRecords([{id:'two'}], audit);
    await vi.waitFor(() => expect(versions).toEqual([0]));
    release!();
    await Promise.all([first,second]);
    expect(versions).toEqual([0,1]);
  });

  it('allows retry after a transient manual save failure', async () => {
    let saves=0;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body=JSON.parse(init.body);
      if (body.action==='login') return response({sessionToken:'session'});
      if (body.action==='bootstrap') return response(bootstrap);
      if (++saves===1) throw new Error('network unavailable');
      return response({version:1});
    }));
    const api=await import('../apps/admin/src/adminCloud');
    await api.connectAdminCloud('token');
    await expect(api.saveManualRecords([],audit)).rejects.toThrow('network unavailable');
    await expect(api.saveManualRecords([],audit)).resolves.toMatchObject({version:1});
    expect(saves).toBe(2);
  });

  it('never sends pending writes under a replacement session', async () => {
    const saves:string[]=[];
    let release:(() => void) | undefined;
    let logins=0;
    vi.spyOn(console,'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch',vi.fn(async (_url,init) => {
      const body=JSON.parse(init.body);
      if (body.action==='login') return response({sessionToken:`session-${++logins}`});
      if (body.action==='bootstrap') return response(bootstrap);
      saves.push(body.sessionToken);
      await new Promise<void>(resolve => {release=resolve;});
      return response({version:1});
    }));
    const api=await import('../apps/admin/src/adminCloud');
    await api.connectAdminCloud('token');
    const first=api.saveManualRecords([],audit);
    // Attach the rejection handler before releasing the in-flight write.
    const settled=first.catch(error=>error);
    api.queueCloudRecords([{id:'pending'}]);
    await vi.waitFor(()=>expect(saves).toEqual(['session-1']));
    await api.connectAdminCloud('replacement');
    release!();
    expect((await settled).message).toContain('会话已变更');
    await new Promise(resolve=>setTimeout(resolve,10));
    expect(saves).toEqual(['session-1']);
    vi.restoreAllMocks();
  });
});
