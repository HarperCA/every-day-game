// 上报内容清洗：只留白名单字段、限制长度和条数（小程序端也做了，这里不信任客户端，再做一次）
const KINDS = new Set(['cloud_fallback', 'load_failed', 'slow', 'user_data_failed', 'js_error']);
const TEXT_FIELDS = { page:120, action:40, message:300, extra:200, networkType:20, platform:20, system:60, wechatVersion:30, sdkVersion:30, appVersion:30, envVersion:20 };
const MAX_EVENTS = 20;

function sanitizeEvents(events, receivedAt) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (const raw of events.slice(0, MAX_EVENTS)) {
    if (!raw || typeof raw !== 'object' || !KINDS.has(raw.kind)) continue;
    const item = { kind:raw.kind, received_at:receivedAt };
    item.client_id = /^[a-z0-9-]{6,40}$/i.test(String(raw.id || '')) ? String(raw.id) : '';
    const at = Date.parse(raw.at);
    item.at = Number.isFinite(at) ? new Date(at).toISOString() : receivedAt;
    for (const [field, max] of Object.entries(TEXT_FIELDS)) item[field] = String(raw[field] ?? '').slice(0, max);
    const elapsed = Number(raw.elapsedMs);
    item.elapsed_ms = Number.isFinite(elapsed) && elapsed >= 0 ? Math.min(Math.round(elapsed), 600000) : null;
    out.push(item);
  }
  return out;
}

module.exports = { sanitizeEvents, KINDS, MAX_EVENTS };
