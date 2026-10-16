// 后台“接口用量”页的数据（2026-10-10 起）：读服务器上各进程记下的调用账（scripts/server/api-usage.mjs 写的
// state/api-usage/<北京日期>.jsonl，每次调用一行），汇总成
//   ① 总调度汇总：每天 × 每个接口的调用次数、失败次数、token、费用；
//   ② 细分：每天 × 接口 × 使用位置（哪个程序、哪个操作）的明细，含主要错误码。
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DIR = '/opt/daily-contest/state/api-usage';
const MAX_DAYS = 60;

// 接口：名称、计量方式、额度说明（额度是已知的规则，不是接口实时返回的余额）
const APIS = {
  codex_cli:{ label:'Codex CLI', unit:'token', quota:'使用 ChatGPT 账户额度；记录 CLI 返回的 token，不代表账户剩余额度或单次费用' },
  baidu_search:{ label:'百度搜索', unit:'次', quota:'免费约 50 次/天；自动任务限 30 次，其余留给测试' },
  kimi_chat:{ label:'Kimi 模型', unit:'token', quota:'会员通道，每 5 小时一个用量窗口' },
  kimi_search:{ label:'Kimi 搜索', unit:'次', quota:'会员通道，与 Kimi 模型共用额度' },
  kimi_fetch:{ label:'Kimi 读网页', unit:'次', quota:'会员通道，与 Kimi 模型共用额度' },
  deepseek:{ label:'DeepSeek', unit:'token', quota:'按 token 计费' },
  openrouter:{ label:'OpenRouter（Jev）', unit:'美元', quota:'预付余额' },
  wechat:{ label:'微信接口', unit:'次', quota:'登录换取身份、发订阅消息、取 access_token' },
};

// 使用位置的中文名：脚本名或“函数.操作”。没列到的照原样显示
const CALLERS = {
  'run-crawl-pipeline':'夜间抓取（总控）', 'search-baidu':'夜间百度搜索', 'notice-agent':'通知追溯代理',
  'run-extract':'读详情与字段抽取', 'ingest-candidates':'入库核验', 'arbitrate-dedupe':'判重裁决', 'trace-drafts':'记录追溯',
  'search-plan':'次日搜索计划', 'organizer-watch':'主办方监测', 'rescore-review-drafts':'草稿重新评分', 'lead-followups':'线索复查',
  'known-event-mentions':'已有赛事提及整理', 'page-supplement':'页面补读', 'same-name-supplement':'同名补来源',
  'agent-trace':'代理追溯试验', 'agent-replay':'代理结果试跑', 'baidu-reset-probe':'百度额度重置实测',
  'api-server':'后台服务（登录、提醒等）', 'adminData.runScheduledAiReview':'定时 AI 审核', 'adminData.runScheduledFieldVerification':'定时三项核验',
  'adminData.archiveExpiredRegistrations':'定时归档', 'adminData.flagStaleDrafts':'过期草稿检查', 'sendReminders.dispatch':'发送报名提醒',
};

function callerLabel(caller) {
  const [head, ...rest] = String(caller || 'unknown').split(' › ');
  return [CALLERS[head] || head, ...rest].join(' › ');
}

function beijingDates(now, days) {
  const base = new Date(now.getTime() + 8 * 3600000);
  return Array.from({ length:days }, (_, i) => new Date(base.getTime() - i * 86400000).toISOString().slice(0, 10));
}

function emptyStats() { return { calls:0, ok:0, failed:0, tokens:0, tokensIn:0, tokensOut:0, costUsd:0, ms:0 }; }
function add(stats, entry) {
  stats.calls += 1;
  if (entry.ok) stats.ok += 1; else stats.failed += 1;
  stats.tokens += Number(entry.tokens) || 0;
  stats.tokensIn += Number(entry.tokensIn) || 0;
  stats.tokensOut += Number(entry.tokensOut) || 0;
  stats.costUsd += Number(entry.costUsd) || 0;
  stats.ms += Number(entry.ms) || 0;
}
const round = value => Math.round(value * 10000) / 10000;

function summarizeEntries(entriesByDate, dates) {
  const days = [];
  const details = [];
  for (const date of dates) {
    const entries = entriesByDate.get(date) || [];
    const perApi = {};
    const perCaller = new Map();
    for (const entry of entries) {
      const api = APIS[entry.api] ? entry.api : 'other';
      add(perApi[api] ||= emptyStats(), entry);
      const key = `${api}|${entry.caller || 'unknown'}`;
      if (!perCaller.has(key)) perCaller.set(key, { ...emptyStats(), errors:{}, lastAt:'' });
      const row = perCaller.get(key);
      add(row, entry);
      if (!entry.ok) row.errors[entry.error || 'unknown'] = (row.errors[entry.error || 'unknown'] || 0) + 1;
      if (String(entry.at || '') > row.lastAt) row.lastAt = entry.at;
    }
    days.push({ date, total:entries.length, apis:Object.fromEntries(Object.entries(perApi).map(([api, s]) => [api, { calls:s.calls, ok:s.ok, failed:s.failed, tokens:s.tokens, costUsd:round(s.costUsd) }])) });
    for (const [key, s] of perCaller) {
      const [api, caller] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];
      details.push({ date, api, apiLabel:APIS[api]?.label || '其他', caller, callerLabel:callerLabel(caller), calls:s.calls, ok:s.ok, failed:s.failed,
        tokens:s.tokens, tokensIn:s.tokensIn, tokensOut:s.tokensOut, costUsd:round(s.costUsd), avgMs:s.calls ? Math.round(s.ms / s.calls) : 0,
        errors:Object.entries(s.errors).sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })), lastAt:s.lastAt });
    }
  }
  details.sort((a, b) => b.date.localeCompare(a.date) || Object.keys(APIS).indexOf(a.api) - Object.keys(APIS).indexOf(b.api) || b.calls - a.calls);
  return { days, details };
}

function readEntries(dir, date) {
  try {
    return fs.readFileSync(path.join(dir, `${date}.jsonl`), 'utf8').split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

function buildApiUsageReport({ days = 14, now = new Date(), dir = process.env.API_USAGE_DIR || DEFAULT_DIR } = {}) {
  const count = Math.min(MAX_DAYS, Math.max(1, Number(days) || 14));
  const dates = beijingDates(now, count);
  const entriesByDate = new Map(dates.map(date => [date, readEntries(dir, date)]));
  const files = (() => { try { return fs.readdirSync(dir).filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort(); } catch { return []; } })();
  // 百度当天的自动用量（search-engines.mjs 的共享计数，自动任务每天最多 30 次）
  const baidu = readJson(path.join(path.dirname(dir), 'baidu-usage.json'));
  return {
    generatedAt:now.toISOString(), dates, since:files[0] ? files[0].slice(0, 10) : null,
    apis:Object.entries(APIS).map(([id, meta]) => ({ id, ...meta })),
    baiduToday:baidu && baidu.date === dates[0] ? { auto:baidu.auto || 0, manual:baidu.manual || 0, limit:30, byCaller:baidu.byCaller || {} } : { auto:0, manual:0, limit:30, byCaller:{} },
    ...summarizeEntries(entriesByDate, dates),
  };
}

module.exports = { APIS, buildApiUsageReport, callerLabel, summarizeEntries };
