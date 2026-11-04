// 屏蔽网站：百度搜索带上的屏蔽名单（block_websites，屏蔽该站及其子站；2026-10-12 用户定，2026-11-02 照旧代码搬来）。
// 夜间搜索（01）、通知追溯（03 Codex 代理追踪）用百度时都带上：内置名单 + 后台确认的名单。
// 屏蔽只对百度有效（Kimi 搜索接口没有这个参数）；按调用次数计费，屏蔽不省搜索次数，省的是结果位置和后面判重、筛选、追溯的开销。
//
// 规则原样搬自 scripts/server/site-blocklist.mjs（内置名单、网址变域名、合并）和 adminData/siteBlocklist.js（后台的状态和四个操作）。
// 存放换了：旧的存在后台 admin_state 集合的一份文档里，新的存在比赛库“后台状态”表（admin_state）编号 site_blocklist 的一行里。
// 内置名单直接取代码里的，不再等每周统计写一份副本进来。
//
//   读状态(db) → { blocked, suggestions, dismissed, builtin, generatedAt, windowDays, minRefs, runs }
//   写建议(db, 统计结果, { now }) → { suggestions, blocked }        每周统计写进新一周的建议
//   决定(db, { host, decision, note }, { now }) → 新的状态         decision：block 确认屏蔽、dismiss 不屏蔽、unblock 取消屏蔽、restore 恢复
//   当前屏蔽(db) → [域名]    名单(状态) → [域名]                   内置 + 后台确认的
export const DOC = 'site_blocklist';
const 表 = 'admin_state';

// ---- 搬自 site-blocklist.mjs ----
export const BUILTIN_BLOCKED = [
  { host:'zhihu.com', reason:'问答站，转述别人的内容' },
  { host:'sohu.com', reason:'转载' },
  { host:'baijiahao.baidu.com', reason:'自媒体转载' },
  { host:'52jingsai.com', reason:'竞赛信息聚合站（子站一并屏蔽，挂在子站下的官网改由通知追溯找）' },
  { host:'saikr.com', reason:'竞赛信息聚合站' },
  // 2026-10-12 起
  { host:'tianchi.aliyun.com', reason:'已有专门抓取器，搜到也会被丢掉，白占结果位置' },
  { host:'datafountain.cn', reason:'2026-09-30 停用的来源，搜到也会被丢掉' },
  { host:'baike.baidu.com', reason:'百科不是原文；10/11、10/12 两晚通知追溯 50 篇只找到 4 个官方来源，平均 20 万 token 一个' },
  { host:'mp.weixin.qq.com', reason:'公众号文章不允许抓取、读不了；两晚通知追溯 64 篇找到 5 个，平均 14 万 token 一个' },
];
export const BUILTIN_HOSTS = BUILTIN_BLOCKED.map(item => item.host);

// 只要域名：去掉协议、路径、端口和开头的 www.，转小写；不像域名的返回空串
export function normalizeHost(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
}

// 某个网址或域名是否已被名单覆盖（名单里的站及其子站）
export function isBlockedHost(value, hosts) {
  const host = normalizeHost(value);
  return Boolean(host) && hosts.some(item => host === item || host.endsWith(`.${item}`));
}

// 内置名单 + 后台确认的名单，去重
export function mergeBlocked(confirmed = []) {
  const out = [...BUILTIN_HOSTS];
  for (const item of confirmed) {
    const host = normalizeHost(typeof item === 'string' ? item : item?.host);
    if (host && !out.includes(host)) out.push(host);
  }
  return out;
}

// ---- 搬自 adminData/siteBlocklist.js ----
//   blocked      后台确认要屏蔽的网站（夜间搜索、通知追溯用百度时和内置名单合并使用）
//   suggestions  每周一统计出的“建议屏蔽”：近 30 天出现很多次、一次都没被放行或追溯成功
//   dismissed    看过、决定不屏蔽的（之后的统计不再建议）
//   builtin      内置名单，只用来在后台显示
const DECISIONS = ['block', 'dismiss', 'unblock', 'restore'];

function emptyState() {
  return { blocked:[], suggestions:[], dismissed:[], builtin:[], generatedAt:'', windowDays:30, minRefs:0, runs:0 };
}

function cleanState(data) {
  const state = { ...emptyState(), ...(data && typeof data === 'object' ? data : {}) };
  for (const key of ['blocked', 'suggestions', 'dismissed', 'builtin']) if (!Array.isArray(state[key])) state[key] = [];
  return state;
}

// 统计脚本写入新一周的建议：已屏蔽、已忽略的不再列出；确认过的名单不动
export function mergeSuggestions(state, payload = {}, now = new Date()) {
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
export function applyDecision(state, { host, decision, note = '' } = {}, now = new Date()) {
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

// ---- 存放（新）：比赛库 admin_state 表的 site_blocklist 一行 ----
// 读出来的一行是 { id, version, data: { id, data, updated_at } }：设置内容在里层的 data 字段
export function 读状态(db) {
  return { ...cleanState(db.get(表, DOC)?.data?.data), builtin: BUILTIN_BLOCKED };
}

function 存状态(db, state, now) {
  const { builtin: _内置, ...data } = state;   // 内置名单在代码里，不存
  const updated_at = now.toISOString();
  db.transaction(tx => {
    const 原 = tx.get(表, DOC);
    // 这一行的 updated_at 由比赛库自己填；内容里也记一份（和旧的一样），用调用方给的时间
    if (原) tx.update(表, DOC, { data: { ...data, updated_at } }, 原.version);
    else tx.insert(表, DOC, { data: { ...data, updated_at } });
  });
  return 读状态(db);
}

export function 写建议(db, payload, { now = () => new Date() } = {}) {
  const 现在 = now();
  const next = 存状态(db, mergeSuggestions(读状态(db), payload, 现在), 现在);
  return { suggestions: next.suggestions.length, blocked: next.blocked.length };
}

export function 决定(db, input, { now = () => new Date() } = {}) {
  const 现在 = now();
  return 存状态(db, applyDecision(读状态(db), input, 现在), 现在);
}

// 名单：内置 + 后台确认的。读不到或坏了只用内置名单，不影响搜索（旧的读后台失败时也是这样）
export const 名单 = state => mergeBlocked(Array.isArray(state?.blocked) ? state.blocked : []);
export const 当前屏蔽 = db => 名单(读状态(db));
