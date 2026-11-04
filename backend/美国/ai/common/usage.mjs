// 记账和汇总：每次调用（包括失败和重试）当场写一行进 usage.db，再按模块、按晚、按天汇总。
// Codex 按月订阅：单次费用记 0、token 照记；每月的固定费用记进 fixed_fees，算月度总花费时加上。
//
// 表：
//   calls          每次调用：时间、来源、运行编号、模块或功能、用途、接口、模型、提示词版本、第几次尝试、
//                  输入输出 token、费用、用时、成败、错误类型和原因
//   run_usage      每晚流程跑完时的汇总（closeRun 写入）
//   fixed_fees     按月付的固定费用
//   problems       调用方报告的问题：接口调用成功了，但返回的内容用不了（漏条目、结论不在规定里……），AI 总管自己看不出来
// 按天的汇总由查询算出来，不另存一份。
import { openSqlite } from '../../../共用/工具/sqlite.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, day TEXT NOT NULL,
  source TEXT NOT NULL, run_id TEXT, module TEXT, purpose TEXT NOT NULL, provider TEXT NOT NULL, model TEXT,
  prompt_version TEXT, attempt INTEGER NOT NULL DEFAULT 1,
  tokens_in INTEGER, tokens_out INTEGER, cost REAL, ms INTEGER, ok INTEGER NOT NULL, error_kind TEXT, error TEXT);
CREATE INDEX IF NOT EXISTS calls_run ON calls(run_id, module);
CREATE INDEX IF NOT EXISTS calls_day ON calls(day);
CREATE TABLE IF NOT EXISTS run_usage (run_id TEXT PRIMARY KEY, closed_at TEXT NOT NULL, totals TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS problems (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, day TEXT NOT NULL,
  source TEXT NOT NULL, run_id TEXT, module TEXT, purpose TEXT NOT NULL, prompt_version TEXT, reason TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS problems_run ON problems(run_id);
CREATE TABLE IF NOT EXISTS fixed_fees (month TEXT NOT NULL, provider TEXT NOT NULL, amount REAL NOT NULL, note TEXT, PRIMARY KEY (month, provider));
`;

const SUM = `COUNT(*) AS calls, SUM(ok) AS ok, SUM(1 - ok) AS failed,
  COALESCE(SUM(tokens_in), 0) AS tokensIn, COALESCE(SUM(tokens_out), 0) AS tokensOut,
  SUM(cost) AS cost, COALESCE(SUM(ms), 0) AS ms`;

// 北京时间的日期，按天汇总用
const beijingDay = date => new Date(date.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

export function createUsageStore(file = ':memory:', { now = () => new Date() } = {}) {
  const db = openSqlite(file);
  db.exec(SCHEMA);
  const insert = db.prepare(`INSERT INTO calls (at, day, source, run_id, module, purpose, provider, model, prompt_version, attempt,
    tokens_in, tokens_out, cost, ms, ok, error_kind, error)
    VALUES (@at, @day, @source, @runId, @module, @purpose, @provider, @model, @promptVersion, @attempt,
    @tokensIn, @tokensOut, @cost, @ms, @ok, @errorKind, @error)`);
  const byModule = db.prepare(`SELECT ${SUM} FROM calls WHERE run_id = ? AND module = ?`);
  const byRun = db.prepare(`SELECT ${SUM} FROM calls WHERE run_id = ?`);
  const byRunModules = db.prepare(`SELECT module, ${SUM} FROM calls WHERE run_id = ? GROUP BY module ORDER BY module`);
  const byDay = db.prepare(`SELECT source, provider, purpose, ${SUM} FROM calls WHERE day = ? GROUP BY source, provider, purpose ORDER BY source, provider, purpose`);
  const byRange = db.prepare(`SELECT day, source, provider, ${SUM} FROM calls WHERE day BETWEEN ? AND ? GROUP BY day, source, provider ORDER BY day, source, provider`);
  const saveRun = db.prepare('INSERT INTO run_usage (run_id, closed_at, totals) VALUES (?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET closed_at = excluded.closed_at, totals = excluded.totals');
  const getRun = db.prepare('SELECT * FROM run_usage WHERE run_id = ?');
  const putFee = db.prepare('INSERT INTO fixed_fees (month, provider, amount, note) VALUES (?, ?, ?, ?) ON CONFLICT(month, provider) DO UPDATE SET amount = excluded.amount, note = excluded.note');
  const feesOf = db.prepare('SELECT provider, amount, note FROM fixed_fees WHERE month = ?');
  const putProblem = db.prepare(`INSERT INTO problems (at, day, source, run_id, module, purpose, prompt_version, reason)
    VALUES (@at, @day, @source, @runId, @module, @purpose, @promptVersion, @reason)`);
  const problemsByRun = db.prepare('SELECT * FROM problems WHERE run_id = ? ORDER BY id');
  const problemsFrom = db.prepare('SELECT * FROM problems WHERE day >= ? ORDER BY id DESC');
  const tidy = row => ({ ...row, ok: row.ok ?? 0, failed: row.failed ?? 0 });
  const countDay = db.prepare('SELECT COUNT(*) AS n FROM calls WHERE day = ? AND provider = ? AND ok = 1 AND source <> ?');

  return {
    file,
    // 记一次调用。entry 里 identity 是会话身份 { source, runId, module }
    recordCall({ identity = {}, purpose, provider, model = null, promptVersion = null, attempt = 1, tokensIn = null, tokensOut = null,
      cost = null, ms = null, ok, errorKind = null, error = null }) {
      const at = now();
      insert.run({ at: at.toISOString(), day: beijingDay(at), source: identity.source || '未注明', runId: identity.runId ?? null,
        module: identity.module ?? null, purpose, provider, model, promptVersion, attempt, tokensIn, tokensOut, cost, ms,
        ok: ok ? 1 : 0, errorKind, error: error ? String(error).slice(0, 500) : null });
    },
    // 记一条调用方报告的问题（不算一次调用）
    recordProblem({ identity = {}, purpose, promptVersion = null, reason }) {
      const at = now();
      putProblem.run({ at: at.toISOString(), day: beijingDay(at), source: identity.source || '未注明', runId: identity.runId ?? null,
        module: identity.module ?? null, purpose, promptVersion, reason: String(reason).slice(0, 500) });
    },
    problemsOf: runId => problemsByRun.all(runId),
    // 某天（北京时间，YYYY-MM-DD）以来所有来源报告的问题，新的在前（后台“失败任务”页用）
    problemsSince: day => problemsFrom.all(day),
    // 今天（北京时间）这家接口成功调用了多少次；excludeSource 的来源不算（手动测试）
    countToday: (provider, { excludeSource = '' } = {}) => countDay.get(beijingDay(now()), provider, excludeSource).n,
    ofModule: (runId, module) => tidy(byModule.get(runId, module)),
    ofRun: runId => ({ ...tidy(byRun.get(runId)), modules: byRunModules.all(runId).map(tidy) }),
    ofDay: day => byDay.all(day).map(tidy),
    report: (fromDay, toDay) => byRange.all(fromDay, toDay).map(tidy),
    // 一晚跑完时调用：把这一晚的汇总存一份，后台看历史不用每次重算
    closeRun(runId) {
      const totals = { ...tidy(byRun.get(runId)), modules: byRunModules.all(runId).map(tidy) };
      saveRun.run(runId, now().toISOString(), JSON.stringify(totals));
      return totals;
    },
    closedRun: runId => { const row = getRun.get(runId); return row ? { ...row, totals: JSON.parse(row.totals) } : null; },
    setFixedFee: (month, provider, amount, note = '') => putFee.run(month, provider, amount, note),
    fixedFees: month => feesOf.all(month),
    close: () => db.close(),
  };
}
