import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../apps/server/src/db.mjs';
import { createCloudBridgeVerifier } from '../apps/server/src/cloudBridge.mjs';

const require = createRequire(import.meta.url);
const { createEnvelope, forwardIfConfigured } = require('../apps/miniprogram/cloudfunctions/login/cloudBridge.js');
const secret = 'isolated-test-bridge-secret-at-least-32-bytes';
const context = { OPENID:'trusted-user', APPID:'test-app', UNIONID:'union' };
const cleanups = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-bridge-'));
  cleanups.push(() => fs.rmSync(directory, { recursive:true, force:true }));
  const db = openDatabase(path.join(directory, 'test.db'));
  cleanups.push(() => db.close());
  return { db, verifier:createCloudBridgeVerifier({ secret, appId:context.APPID, db, now:() => 1_000_000 }) };
}
function resign(envelope, mutate) {
  const claims = JSON.parse(envelope.payload);
  mutate(claims);
  const payload = JSON.stringify(claims);
  return { payload, signature:createHmac('sha256', secret).update(payload).digest('hex') };
}

describe('Shanghai trusted compatibility bridge', () => {
  it('gets identity from WX context and never from client fields', () => {
    const { verifier } = fixture();
    const envelope = createEnvelope('userData', { action:'listFavorites', __openid:'victim', identity:{ openid:'victim' } }, context, secret, 1_000_000);
    expect(verifier(envelope).identity).toEqual({ openid:'trusted-user', appid:'test-app', unionid:'union' });
  });
  it('rejects tampering, wrong keys, cross-app calls and expired calls', () => {
    const { verifier } = fixture();
    const valid = createEnvelope('login', {}, context, secret, 1_000_000);
    expect(() => verifier({ ...valid, payload:valid.payload.replace('trusted-user', 'victim') })).toThrow('cloud_bridge_invalid');
    expect(() => verifier(createEnvelope('login', {}, context, 'wrong-key', 1_000_000))).toThrow('cloud_bridge_invalid');
    expect(() => verifier(createEnvelope('login', {}, { ...context, APPID:'other-app' }, secret, 1_000_000))).toThrow('identity_invalid');
    expect(() => verifier(createEnvelope('login', {}, context, secret, 900_000))).toThrow('cloud_bridge_expired');
  });
  it('blocks admin/timer dispatch and malformed identities', () => {
    const { verifier } = fixture();
    const valid = createEnvelope('userData', {}, context, secret, 1_000_000);
    expect(() => verifier(resign(valid, claims => { claims.functionName = 'adminData'; }))).toThrow('cloud_bridge_invalid');
    expect(() => verifier(resign(valid, claims => { claims.event.Type = 'Timer'; }))).toThrow('cloud_bridge_invalid');
    expect(() => verifier(resign(valid, claims => { claims.identity.openid = ''; }))).toThrow('identity_invalid');
    expect(() => verifier(resign(valid, claims => { claims.timestamp = '1000000'; }))).toThrow('cloud_bridge_expired');
    expect(() => verifier(createEnvelope('publicData', { action:'warm' }, { APPID:'test-app' }, secret, 1_000_000))).toThrow('cloud_bridge_invalid');
  });
  it('allows signed public queries without a user identity', () => {
    const { verifier } = fixture();
    expect(verifier(createEnvelope('publicData', { action:'list' }, { APPID:'test-app' }, secret, 1_000_000)).identity.openid).toBe('');
  });
  it('keeps replay protection across verifier restarts and consumes only valid signatures', () => {
    const { verifier, db } = fixture();
    const valid = createEnvelope('login', {}, context, secret, 1_000_000);
    expect(() => verifier({ ...valid, signature:'0'.repeat(64) })).toThrow('cloud_bridge_invalid');
    expect(verifier(valid).functionName).toBe('login');
    const restarted = createCloudBridgeVerifier({ secret, appId:context.APPID, db, now:() => 1_000_001 });
    expect(() => restarted(valid)).toThrow('cloud_bridge_replayed');
  });
  it('rejects missing bridge configuration without enabling the route', () => {
    const { db } = fixture();
    expect(() => createCloudBridgeVerifier({ secret:'short', appId:'test-app', db })({})).toThrow('cloud_bridge_disabled');
  });
  it('fails closed when forwarding is configured incorrectly; does not silently write locally', async () => {
    const previousUrl = process.env.CLOUD_USER_BRIDGE_URL;
    const previousSecret = process.env.CLOUD_USER_BRIDGE_SECRET;
    const previousMode = process.env.CLOUD_USER_SERVICE_MODE;
    cleanups.push(() => {
      if (previousUrl === undefined) delete process.env.CLOUD_USER_BRIDGE_URL; else process.env.CLOUD_USER_BRIDGE_URL = previousUrl;
      if (previousSecret === undefined) delete process.env.CLOUD_USER_BRIDGE_SECRET; else process.env.CLOUD_USER_BRIDGE_SECRET = previousSecret;
      if (previousMode === undefined) delete process.env.CLOUD_USER_SERVICE_MODE; else process.env.CLOUD_USER_SERVICE_MODE = previousMode;
    });
    delete process.env.CLOUD_USER_SERVICE_MODE;
    delete process.env.CLOUD_USER_BRIDGE_URL;
    expect(await forwardIfConfigured('login', {}, context)).toBeNull();
    process.env.CLOUD_USER_BRIDGE_URL = 'https://beijing.example/api/cloudBridge';
    expect(await forwardIfConfigured('login', {}, context)).toBeNull();
    process.env.CLOUD_USER_SERVICE_MODE = 'maintenance';
    await expect(forwardIfConfigured('login', {}, context)).rejects.toThrow('迁移中');
    process.env.CLOUD_USER_SERVICE_MODE = 'bridge';
    delete process.env.CLOUD_USER_BRIDGE_SECRET;
    await expect(forwardIfConfigured('login', {}, context)).rejects.toThrow('config_invalid');
    process.env.CLOUD_USER_BRIDGE_SECRET = secret;
    process.env.CLOUD_USER_BRIDGE_URL = 'http://beijing.example/api/cloudBridge';
    await expect(forwardIfConfigured('login', {}, context)).rejects.toThrow('url_invalid');
  });
  it('all separately packaged compatibility helpers are identical', () => {
    const contents = ['login', 'userData', 'clientLog', 'publicData'].map(name => fs.readFileSync(new URL(`../apps/miniprogram/cloudfunctions/${name}/cloudBridge.js`, import.meta.url), 'utf8'));
    expect(new Set(contents).size).toBe(1);
  });
});
