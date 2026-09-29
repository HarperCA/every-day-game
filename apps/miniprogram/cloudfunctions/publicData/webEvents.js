// 网页测试版（apps/web）的匿名使用统计：校验、截断、限流。
//
// 目的：验证学生到底需不需要这个产品——多少人来过、搜什么、看了哪些赛事、
// 有没有点进官网或报名入口、收藏和纠错。
//
// 不收集个人信息：没有登录，只有浏览器本地生成的随机编号（visitor）；
// 不记 IP、不记完整 User-Agent，只记“手机/电脑”。
// 这个接口不需要登录就能调，所以每个字段都有长度上限，每个编号每小时有条数上限。

const EVENT_TYPES = new Set([
  'visit',          // 打开网页
  'view_page',      // 切换页面：收藏、说明页等
  'search',         // 搜索：keyword、resultCount
  'filter',         // 使用筛选：kind、value
  'view_detail',    // 打开赛事详情：id、name
  'open_official',  // 点击官方报名页或官方来源：id、name、target
  'copy_link',      // 复制官方链接：id、name
  'favorite',       // 收藏或取消：id、name、on
  'feedback',       // 信息纠错：id、name、text
]);

const LIMITS = { keyword:60, id:160, name:160, kind:40, value:80, target:20, text:500, page:40 };
const MAX_BATCH = 20;
const MAX_PER_VISITOR_PER_HOUR = 400;
const VISITOR_PATTERN = /^[a-z0-9-]{8,40}$/;

const clip = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit);

function sanitizeData(raw) {
  const data = {};
  const source = raw && typeof raw === 'object' ? raw : {};
  for (const [field, limit] of Object.entries(LIMITS)) {
    if (source[field] !== undefined && source[field] !== null && source[field] !== '') data[field] = clip(source[field], limit);
  }
  if (Number.isFinite(source.resultCount)) data.resultCount = Math.max(0, Math.min(100000, Math.floor(source.resultCount)));
  if (typeof source.on === 'boolean') data.on = source.on;
  return data;
}

// 返回 { visitor, items }；visitor 不合法时 items 为空（整批丢弃）。
function sanitizeBatch(event, now = new Date()) {
  const visitor = String(event?.visitor || '').toLowerCase();
  if (!VISITOR_PATTERN.test(visitor)) return { visitor:'', items:[] };
  const device = event?.device === 'mobile' ? 'mobile' : 'desktop';
  const at = now.toISOString();
  const items = (Array.isArray(event?.events) ? event.events : []).slice(0, MAX_BATCH)
    .filter(item => EVENT_TYPES.has(item?.type))
    .map(item => ({ visitor, device, type:item.type, at, data:sanitizeData(item.data) }));
  return { visitor, items };
}

// 进程内限流：每个编号每小时最多 MAX_PER_VISITOR_PER_HOUR 条。服务重启后清零，测试阶段够用。
function createRateLimiter({ limit = MAX_PER_VISITOR_PER_HOUR, windowMs = 60 * 60 * 1000 } = {}) {
  const buckets = new Map();
  return {
    allow(visitor, count, nowMs = Date.now()) {
      const bucket = buckets.get(visitor);
      if (!bucket || nowMs - bucket.start >= windowMs) {
        if (buckets.size > 50000) buckets.clear();
        buckets.set(visitor, { start:nowMs, count });
        return count <= limit;
      }
      bucket.count += count;
      return bucket.count <= limit;
    },
  };
}

module.exports = { EVENT_TYPES, LIMITS, MAX_BATCH, sanitizeBatch, createRateLimiter };
