import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { expect, it } from 'vitest';
import { openDatabase, putDoc } from '../apps/server/src/db.mjs';

const require = createRequire(import.meta.url);
const { createEnvelope } = require('../apps/miniprogram/cloudfunctions/login/cloudBridge.js');
const secret = 'isolated-http-bridge-test-secret-at-least-32';
const wxContext = { OPENID:'existing-user', APPID:'test-app' };

it('legacy signed cloud calls and signed direct calls share the preserved account and isolate other users', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-http-'));
  const dbFile = path.join(directory, 'test.db');
  const db = openDatabase(dbFile);
  putDoc(db, 'user_account', 'shanghai-account-id', { openid:wxContext.OPENID, appid:wxContext.APPID, status:'active', created_at:'2026-10-01T00:00:00.000Z' });
  putDoc(db, 'user_account', 'other-account-id', { openid:'other-user', appid:wxContext.APPID, status:'active' });
  putDoc(db, 'favorite', 'existing-favorite', { user_id:'shanghai-account-id', edition_id:'existing-edition', created_at:'2026-10-01T00:00:00.000Z' });
  putDoc(db, 'favorite', 'other-favorite', { user_id:'other-account-id', edition_id:'other-edition', created_at:'2026-10-01T00:00:00.000Z' });
  putDoc(db, 'event_edition_public_cache', 'public-edition', { id:'public-edition', competition_name:'测试公开比赛', data_status:'published', system_validation:'passed', manual_review:'passed' });
  db.close();
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const environment = { ...process.env, PORT:String(port), HOST:'127.0.0.1', DB_FILE:dbFile, WECHAT_APPID:wxContext.APPID, USER_SERVICE_BRIDGE_SECRET:secret, SYNC_SECRET:secret, FUNCTIONS_DIR:path.resolve('apps/miniprogram/cloudfunctions') };
  delete environment.CLOUD_USER_BRIDGE_URL;
  delete environment.CLOUD_USER_BRIDGE_SECRET;
  delete environment.CLOUD_USER_SERVICE_MODE;
  const child = spawn(process.execPath, ['src/index.mjs'], { cwd:path.resolve('apps/server'), env:environment, stdio:['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  const post = async (route, body) => {
    const response = await fetch(baseUrl + route, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body), signal:AbortSignal.timeout(5000) });
    return { status:response.status, body:await response.json() };
  };
  const bridge = (functionName, event, context = wxContext) => post('/api/cloudBridge', createEnvelope(functionName, event, context, secret));
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error(output);
      try { const health = await fetch(baseUrl + '/api/health', { signal:AbortSignal.timeout(500) }); if (health.ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error(`Local server did not start: ${output}`);
    const login = await bridge('login', {});
    expect(login.body.data.userId).toBe('shanghai-account-id');
    expect(login.body.data.isNewUser).toBe(false);
    const favorites = await bridge('userData', { action:'listFavorites', __openid:'other-user' });
    expect(favorites.body.data.map(item => item.editionId)).toEqual(['existing-edition']);
    const token = login.body.data.userSessionToken;
    const directFavorites = await post('/api/userData', { action:'listFavorites', userSessionToken:token, __openid:'other-user' });
    expect(directFavorites.body.data).toEqual(favorites.body.data);
    const save = await bridge('userData', { action:'savePreferences', preferences:{ profession:'', categories:['计算机与AI'], province:'安徽省', surveyStatus:'completed', dontShowAgain:true } });
    expect(save.body.ok).toBe(true);
    const preferences = await post('/api/userData', { action:'getPreferences', userSessionToken:token });
    expect(preferences.body.data.province).toBe('安徽省');
    const other = await bridge('userData', { action:'getPreferences' }, { ...wxContext, OPENID:'other-user' });
    expect(other.body.data).toBeNull();
    expect((await post('/api/userData', { action:'listFavorites', __openid:wxContext.OPENID })).body.ok).toBe(false);
    const log = await bridge('clientLog', { events:[{ kind:'load_failed', action:'test', message:'test error', openid:'must-not-be-stored' }] });
    expect(log.body.ok).toBe(true);
    expect(log.body.saved).toBe(1);
    const stored = openDatabase(dbFile);
    try {
      const records = stored.prepare("SELECT data FROM documents WHERE collection = 'client_issues'").all();
      expect(records).toHaveLength(1);
      expect(records[0].data).not.toContain('must-not-be-stored');
      expect(records[0].data).not.toContain('existing-user');
    } finally { stored.close(); }
    expect((await post('/api/cloudBridge', { payload:'{}', signature:'0'.repeat(64) })).status).toBe(403);
    const anonymousPublic = await bridge('publicData', { action:'get', id:'public-edition' }, { APPID:wxContext.APPID });
    expect(anonymousPublic.body.data.id).toBe('public-edition');
    const once = createEnvelope('publicData', { action:'get', id:'public-edition' }, { APPID:wxContext.APPID }, secret);
    expect((await post('/api/cloudBridge', once)).body.ok).toBe(true);
    expect((await post('/api/cloudBridge', once)).body.message).toBe('cloud_bridge_replayed');
    expect(fs.existsSync(`${dbFile}.bridge-nonces.db`)).toBe(true);
    expect((await post('/api/publicData', { action:'get', id:'public-edition' })).body.data).toEqual(anonymousPublic.body.data);
    const anonymousLog = await post('/api/clientLog', { events:[{ kind:'slow', action:'publicData.list', message:'slow' }] });
    expect(anonymousLog.body.saved).toBe(1);
    expect((await post('/api/clientLog', { Type:'Timer', events:[] })).status).toBe(403);
    expect((await post('/api/publicSync', { action:'status' })).status).toBe(403);
    expect((await post('/api/publicSync', { action:'status', userSessionToken:token })).status).toBe(403);
    expect((await post('/api/publicSync', { action:'status', secret, Type:'Timer' })).status).toBe(403);
    const syncStatus = await post('/api/publicSync', { action:'status', secret });
    expect(syncStatus.body).toMatchObject({ ok:true, count:1 });
    expect((await post('/api/publicSync', { action:'prune', secret, keepIds:[] })).body.status).toBe('refuse_empty_keep');
  } finally {
    if (child.exitCode === null) {
      const stopped = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await stopped;
    }
    fs.rmSync(directory, { recursive:true, force:true });
  }
}, 15_000);
