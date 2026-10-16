import { createHmac, timingSafeEqual } from 'node:crypto';

export const CLOUD_BRIDGE_FUNCTIONS = new Set(['login', 'userData', 'clientLog', 'publicData']);
const MAX_AGE_MS = 60_000;
const MAX_PAYLOAD_BYTES = 1024 * 1024;

// Durable replay protection shared by workers and preserved across restarts.
export function createCloudBridgeVerifier({ secret, appId, db, now = Date.now }) {
  const configured = typeof secret === 'string' && Buffer.byteLength(secret) >= 32 && !!appId;
  if (configured) db.exec('CREATE TABLE IF NOT EXISTS cloud_bridge_nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');
  const consume = configured ? db.transaction((nonce, at) => {
    db.prepare('DELETE FROM cloud_bridge_nonces WHERE expires_at < ?').run(at);
    if (db.prepare('SELECT nonce FROM cloud_bridge_nonces WHERE nonce = ?').get(nonce)) throw new Error('cloud_bridge_replayed');
    db.prepare('INSERT INTO cloud_bridge_nonces (nonce, expires_at) VALUES (?, ?)').run(nonce, at + MAX_AGE_MS * 2);
  }) : null;
  return envelope => {
    if (!configured) throw new Error('cloud_bridge_disabled');
    const payload = envelope?.payload;
    const signature = envelope?.signature;
    if (typeof payload !== 'string' || Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) throw new Error('cloud_bridge_invalid');
    const actual = Buffer.from(signature, 'hex');
    const expected = createHmac('sha256', secret).update(payload).digest();
    if (!timingSafeEqual(actual, expected)) throw new Error('cloud_bridge_invalid');
    let claims;
    try { claims = JSON.parse(payload); } catch { throw new Error('cloud_bridge_invalid'); }
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new Error('cloud_bridge_invalid');
    const at = now();
    if (!Number.isSafeInteger(claims.timestamp) || Math.abs(at - claims.timestamp) > MAX_AGE_MS) throw new Error('cloud_bridge_expired');
    if (!/^[a-f0-9]{48}$/.test(claims.nonce || '') || !CLOUD_BRIDGE_FUNCTIONS.has(claims.functionName)) throw new Error('cloud_bridge_invalid');
    if (!claims.identity || claims.identity.appid !== appId || typeof claims.identity.openid !== 'string' || claims.identity.openid.length > 256 || (['login', 'userData'].includes(claims.functionName) && !claims.identity.openid)) throw new Error('cloud_bridge_identity_invalid');
    if (!claims.event || typeof claims.event !== 'object' || Array.isArray(claims.event) || claims.event.Type === 'Timer') throw new Error('cloud_bridge_invalid');
    if (claims.functionName === 'publicData' && !['list', 'get'].includes(claims.event.action)) throw new Error('cloud_bridge_invalid');
    consume(claims.nonce, at);
    return { functionName:claims.functionName, event:claims.event, identity:{ openid:claims.identity.openid, appid:appId, unionid:typeof claims.identity.unionid === 'string' ? claims.identity.unionid : '' } };
  };
}
