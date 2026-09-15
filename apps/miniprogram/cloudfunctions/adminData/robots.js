// 抓取赛事来源前先检查 robots.txt。部分主办方站点对所有 UA 全站禁止，
// 不检查就等于无视站方声明。robots.txt 取不到时按惯例视为允许。
const DEFAULT_USER_AGENT = 'competition-review';

function parseGroups(text) {
  const groups = [];
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      // 连续的 user-agent 行共享同一组规则
      if (!current || current.rules.length) current = { agents: [], rules: [] };
      current.agents.push(value.toLowerCase());
      if (!groups.includes(current)) groups.push(current);
    } else if ((field === 'allow' || field === 'disallow') && current) {
      current.rules.push({ allow: field === 'allow', path: value });
    }
  }
  return groups;
}

function pickGroup(groups, userAgent) {
  const agent = String(userAgent || DEFAULT_USER_AGENT).toLowerCase();
  const named = groups.find(group => group.agents.some(name => name !== '*' && agent.includes(name)));
  if (named) return named;
  return groups.find(group => group.agents.includes('*')) || null;
}

function ruleMatches(path, rulePath) {
  if (rulePath === '') return false; // 空 Disallow 表示不限制
  return path.startsWith(rulePath);
}

// 最长匹配优先；同长度时 Allow 胜出，与主流爬虫一致。
function isAllowed(text, userAgent, path) {
  const group = pickGroup(parseGroups(text), userAgent);
  if (!group) return true;
  let best = null;
  for (const rule of group.rules) {
    if (!ruleMatches(path, rule.path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

module.exports = { DEFAULT_USER_AGENT, isAllowed, parseGroups, pickGroup };
