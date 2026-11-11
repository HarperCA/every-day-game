// 找官网 · 核实：程序打开 DeepSeek 给的网址，页面上有比赛名称（任一写法）就算是这个比赛的页面。
// 年份、届次、主办单位只记下来不卡（11-07 方案三实测：主办单位写法不一、首页没有年份，卡了反而把真官网否掉）。
//   名称写法(比赛) → [规范后的写法]   原名、别名、去掉括号里的、按“—”“·”拆开的 4 个字以上的段
//   核实页面(页, 比赛, 目标) → { 结果: '合格' | '不合格' | '打不开', 缺, 有新一届, 年份对上, 主办单位对上 }
//     有新一届：页面上有目标年份或目标届次；年份对上：目标的或库里最新一届的年份、届次出现了
//   页是 美国/web 读网页 交回的结果；超时、网络错误、HTTP 错误算打不开（美国读不到改由北京读，由传进来的 读网页 负责）。
const 打不开的 = new Set(['超时', '网络错误', 'HTTP错误']);
const 有内容的 = new Set(['成功', '正文太短']);

export const 规范名 = s => String(s ?? '').normalize('NFKC').replace(/\s/g, '').toLowerCase();

export function 名称写法(比赛) {
  const 原名 = 规范名(比赛.name);
  const 写法们 = [原名, ...(比赛.aliases || []).map(规范名), 原名.replace(/[(（][^()（）]*[)）]/g, ''), ...原名.split(/[—–·•]/).filter(段 => 段.length >= 4)];
  return [...new Set(写法们.filter(名 => 名.length >= 2))];
}

const 主办方们 = 比赛 => String(比赛.organizer || '').split(/[、，,；;\s]+/).map(规范名).filter(段 => 段.length >= 4);

export function 核实页面(页, 比赛, { 年份, 届次, 已知年份 = null, 已知届次 = null } = {}) {
  if (打不开的.has(页?.status)) return { 结果: '打不开', 缺: [], 原因: 页.error || 页.status };
  if (!有内容的.has(页?.status)) return { 结果: '不合格', 缺: ['读不出内容'], 原因: 页?.error || 页?.status || '' };
  const 文字 = 规范名(`${页.title || ''} ${页.text || ''}`);
  const 有 = 值 => 值 != null && 值 !== '' && 文字.includes(规范名(值));
  const 缺 = 名称写法(比赛).some(名 => 文字.includes(名)) ? [] : ['比赛名称'];
  return {
    结果: 缺.length ? '不合格' : '合格',
    缺,
    有新一届: 有(年份) || 有(届次),
    年份对上: [年份, 已知年份, 届次, 已知届次].some(有),
    主办单位对上: 主办方们(比赛).some(段 => 文字.includes(段)),
  };
}
