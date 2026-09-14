const crypto = require('crypto');

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireStaticAdminToken(value, secret) {
  if (!secret) throw new Error('admin_token_not_configured');
  if (!safeEqual(value, secret)) throw new Error('admin_unauthorized');
}

function signature(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

function issueAdminSession(secret, now = Date.now()) {
  if (!secret) throw new Error('admin_token_not_configured');
  const body = Buffer.from(JSON.stringify({ version:1, expiresAt:now + SESSION_DURATION_MS, nonce:crypto.randomBytes(12).toString('hex') })).toString('base64url');
  return `${body}.${signature(body, secret)}`;
}

function verifyAdminSession(token, secret, now = Date.now()) {
  if (!secret || typeof token !== 'string') return false;
  const [body, suppliedSignature, extra] = token.split('.');
  if (!body || !suppliedSignature || extra || !safeEqual(suppliedSignature, signature(body, secret))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.version === 1 && Number.isFinite(payload.expiresAt) && payload.expiresAt > now;
  } catch (_error) { return false; }
}

module.exports = { issueAdminSession, requireStaticAdminToken, verifyAdminSession, SESSION_DURATION_MS };
