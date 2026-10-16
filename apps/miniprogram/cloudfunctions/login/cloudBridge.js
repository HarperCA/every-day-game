// Packaged independently in each Shanghai compatibility function. Keep all copies identical.
const https = require('https');
const crypto = require('crypto');

function createEnvelope(functionName, event, wxContext, secret, now = Date.now()) {
  if (!['login', 'userData', 'clientLog', 'publicData'].includes(functionName)) throw new Error('cloud_bridge_function_invalid');
  if (!wxContext?.APPID || (['login', 'userData'].includes(functionName) && !wxContext.OPENID)) throw new Error('cloud_bridge_identity_missing');
  const payload = JSON.stringify({ functionName, event:event || {}, identity:{ openid:wxContext.OPENID || '', appid:wxContext.APPID, unionid:wxContext.UNIONID || '' }, timestamp:now, nonce:crypto.randomBytes(24).toString('hex') });
  return { payload, signature:crypto.createHmac('sha256', secret).update(payload).digest('hex') };
}

async function forwardIfConfigured(functionName, event, wxContext) {
  // URL/secret can be prepared before cutover without changing the write owner.
  const mode = process.env.CLOUD_USER_SERVICE_MODE || 'local';
  if (mode === 'local') return null;
  if (mode === 'maintenance') throw new Error('用户服务迁移中，请稍后重试');
  if (mode !== 'bridge') throw new Error('cloud_bridge_mode_invalid');
  const target = process.env.CLOUD_USER_BRIDGE_URL;
  if (!target) throw new Error('cloud_bridge_config_invalid');
  const secret = process.env.CLOUD_USER_BRIDGE_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('cloud_bridge_config_invalid');
  const url = new URL(target);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('cloud_bridge_url_invalid');
  const body = JSON.stringify(createEnvelope(functionName, event, wxContext, secret));
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method:'POST', headers:{ 'content-type':'application/json', 'content-length':Buffer.byteLength(body) }, timeout:15_000 }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        text += chunk;
        if (Buffer.byteLength(text) > 10 * 1024 * 1024) request.destroy(new Error('cloud_bridge_response_too_large'));
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`cloud_bridge_http_${response.statusCode}`));
        try {
          const result = JSON.parse(text);
          if (!result || typeof result.ok !== 'boolean') throw new Error('cloud_bridge_response_invalid');
          resolve(result);
        } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('cloud_bridge_timeout')));
    request.on('error', reject);
    request.end(body);
  });
}

module.exports = { createEnvelope, forwardIfConfigured };
