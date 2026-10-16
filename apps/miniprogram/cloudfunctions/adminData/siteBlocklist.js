// 百度搜索屏蔽网站名单的后台部分（2026-10-12，用户定）。
//
// 内置名单写在服务器脚本 site-blocklist.mjs 里；这里存的是：
//   blocked      后台确认要屏蔽的网站（夜间搜索、通知追溯用百度时和内置名单合并使用）
//   suggestions  每周一 site-block-suggest.mjs 统计出的“建议屏蔽”：近 30 天出现很多次、一次都没被放行或追溯成功
//   dismissed    看过、决定不屏蔽的（之后的统计不再建议）
//   builtin      内置名单的副本，统计脚本每次写入，只用来在后台显示
// 存在 admin_state 的一个文档里：云开发的集合要先手动建，写不存在的集合会静默失败。
const DOC = 'site_blocklist';
const DECISIONS = ['block', 'dismiss', 'unblock', 'restore'];

function normalizeHost(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
}

function emptyState() {
  return { blocked:[], suggestions:[], dismissed:[], builtin:[], generatedAt:'', windowDays:30, minRefs:0, runs:0 };
}

function cleanState(data) {
  const state = { ...emptyState(), ...(data && typeof data === 'object' ? data : {}) };
  for (const key of ['blocked', 'suggestions', 'dismissed', 'builtin']) if (!Array.isArray(state[key])) state[key] = [];
  return state;
}

async function loadSiteBlocklist(db) {
  try {
    const result = await db.collection('admin_state').doc(DOC).get();
    return cleanState(result.data);
  } catch (_error) {
    return emptyState();
  }
}

async function saveState(db, state) {
  const data = { ...state, updated_at:new Date().toISOString() };
  await db.collection('admin_state').doc(DOC).set({ data });
  return cleanState(data);
}

// 统计脚本写入新一周的建议：已屏蔽、已忽略的不再列出；确认过的名单不动
function mergeSuggestions(state, payload = {}, now = new Date()) {
  const taken = new Set([...state.blocked.map(item => item.host), ...state.dismissed.map(item => item.host)]);
  const suggestions = (Array.isArray(payload.suggestions) ? payload.suggestions : [])
    .map(item => ({ ...item, host:normalizeHost(item?.host) }))
    .filter(item => item.host && !taken.has(item.host))
    .slice(0, 100);
  const builtin = (Array.isArray(payload.builtin) ? payload.builtin : [])
    .map(item => ({ host:normalizeHost(item?.host), reason:String(item?.reason || '').slice(0, 200) })).filter(item => item.host);
  return { ...state, suggestions, builtin:builtin.length ? builtin : state.builtin, generatedAt:now.toISOString(),
    windowDays:Number(payload.windowDays) || state.windowDays, minRefs:Number(payload.minRefs) || 0, runs:Number(payload.runs) || 0 };
}

// 后台的四个操作：确认屏蔽 / 忽略（都从建议里来）、取消屏蔽、恢复（把忽略的放回去，下次统计可能再建议）
function applyDecision(state, { host, decision, note = '' } = {}, now = new Date()) {
  const target = normalizeHost(host);
  if (!target) throw new Error('invalid_site_host');
  if (!DECISIONS.includes(decision)) throw new Error('invalid_site_decision');
  const at = now.toISOString();
  const suggestion = state.suggestions.find(item => item.host === target);
  const without = list => list.filter(item => item.host !== target);
  if (decision === 'block') {
    if (state.builtin.some(item => item.host === target)) throw new Error('site_already_builtin');
    const entry = { host:target, reason:String(note || suggestion?.reason || '').slice(0, 200), decidedAt:at,
      ...(suggestion ? { evidence:{ refs:suggestion.refs, candidates:suggestion.candidates, generatedAt:state.generatedAt } } : {}) };
    return { ...state, blocked:[...without(state.blocked), entry], suggestions:without(state.suggestions), dismissed:without(state.dismissed) };
  }
  if (decision === 'dismiss') {
    return { ...state, dismissed:[...without(state.dismissed), { host:target, decidedAt:at, ...(suggestion ? { refs:suggestion.refs } : {}) }], suggestions:without(state.suggestions) };
  }
  if (decision === 'unblock') {
    if (!state.blocked.some(item => item.host === target)) throw new Error('site_not_blocked');
    return { ...state, blocked:without(state.blocked) };
  }
  return { ...state, dismissed:without(state.dismissed) };
}

async function saveSuggestions(db, payload) {
  const state = await loadSiteBlocklist(db);
  const next = await saveState(db, mergeSuggestions(state, payload));
  return { suggestions:next.suggestions.length, blocked:next.blocked.length };
}

async function decideSiteBlock(db, input) {
  const state = await loadSiteBlocklist(db);
  return saveState(db, applyDecision(state, input));
}

module.exports = { DOC, normalizeHost, loadSiteBlocklist, mergeSuggestions, applyDecision, saveSuggestions, decideSiteBlock };
