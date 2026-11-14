import { readWeChatConfig } from '../../共用/工具/微信.mjs';
import { createPool } from '../../共用/工具/concurrency.mjs';

const 接口 = 'https://api.weixin.qq.com/';
const 天 = 86400000;
const 日期 = ms => new Date(ms).toISOString().slice(0, 10);
const 路径 = {
  趋势: 'getweanalysisappiddailyvisittrend',
  来源: 'getweanalysisappidvisitdistribution',
  页面: 'getweanalysisappidvisitpage',
  留存: 'getweanalysisappiddailyretaininfo',
};

const 数字 = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const 来源名 = { 1: '小程序历史列表', 2: '搜索', 3: '会话', 4: '扫码', 5: '公众号主页', 6: '聊天顶部', 7: '系统桌面',
  8: '小程序主页', 9: '附近的小程序', 10: '其他', 11: '模板消息', 12: '客服消息', 13: '公众号菜单', 14: 'APP 分享',
  15: '支付完成页', 16: '长按识别二维码', 17: '相册选取二维码', 18: '公众号文章', 19: '钱包', 20: '卡包',
  22: '其他小程序', 23: '其他小程序返回', 25: '搜索框快捷入口', 26: '小程序客服消息', 27: '公众号下发', 29: '任务栏最近使用' };

function 统计范围(参数, now) {
  const 昨天 = 日期(now + 8 * 3600000 - 天);
  const 截止 = 参数.日期 || 昨天;
  const 天数 = 参数.天数 ?? 7;
  const 到 = typeof 截止 === 'string' ? Date.parse(截止) : NaN;
  if (typeof 截止 !== 'string' || !Number.isFinite(到) || 日期(到) !== 截止 || 截止 > 昨天 ||
      ![7, 30].includes(天数)) {
    throw Object.assign(new Error('请选择昨天或更早的有效日期，统计天数为 7 或 30'), { kind: '请求有误' });
  }
  return { 昨天, 截止, 到, 天数 };
}

export function 建统计读取器({ fetchImpl = globalThis.fetch, 读配置 = readWeChatConfig, 时钟 = Date.now } = {}) {
  const 缓存 = new Map();
  const 正在取 = new Map();
  const 并发池 = createPool({ limit: 6 });
  let 凭证;
  let 凭证请求;

  async function 请求(url, body) {
    try {
      const r = await fetchImpl(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) return { 错误: '微信请求失败（HTTP ' + r.status + '）' };
      const data = await r.json();
      if (data?.errcode) return { 错误: '微信接口错误（' + Number(data.errcode) + '）', 错误码: Number(data.errcode) };
      return data && typeof data === 'object' ? data : { 错误: '微信接口返回了无效数据' };
    } catch {
      return { 错误: '微信接口暂时无法访问' };
    }
  }

  async function 取凭证() {
    if (凭证?.过期 > 时钟()) return 凭证;
    if (!凭证请求) {
      凭证请求 = (async () => {
        const { appId, appSecret } = 读配置();
        if (!appId || !appSecret) return { 错误: '服务器未配置小程序接口凭证' };
        const data = await 请求(接口 + 'cgi-bin/stable_token', {
          grant_type: 'client_credential', appid: appId, secret: appSecret, force_refresh: false,
        });
        if (!data.access_token) return { 错误: data.错误 || '微信未返回小程序接口凭证' };
        凭证 = { token: data.access_token, 过期: 时钟() + Math.max(0, (Number(data.expires_in) || 7200) - 300) * 1000 };
        return 凭证;
      })().catch(() => ({ 错误: '服务器无法读取小程序接口配置' })).finally(() => { 凭证请求 = null; });
    }
    return 凭证请求;
  }

  function 按日取(类型, 日期值) {
    const key = 类型 + ':' + 日期值;
    const 上次 = 缓存.get(key);
    if (上次?.过期 > 时钟()) return Promise.resolve(上次.data);
    if (正在取.has(key)) return 正在取.get(key);
    const task = 并发池.run(async () => {
      const d = 日期值.replaceAll('-', '');
      const body = { begin_date: d, end_date: d };
      const 请求数据 = token => 请求(接口 + 'datacube/' + 路径[类型] + '?access_token=' + encodeURIComponent(token), body);
      let v = await 取凭证();
      if (v.错误) return v;
      let data = await 请求数据(v.token);
      if ([40001, 40014, 42001].includes(data.错误码)) {
        if (凭证 === v) 凭证 = null;
        v = await 取凭证();
        if (v.错误) return v;
        data = await 请求数据(v.token);
      }
      if (data.错误) return data;
      缓存.delete(key);
      if (缓存.size >= 160) 缓存.delete(缓存.keys().next().value);
      缓存.set(key, { data, 过期: 时钟() + 30 * 60 * 1000 });
      return data;
    }).finally(() => 正在取.delete(key));
    正在取.set(key, task);
    return task;
  }

  return async function 读取(参数 = {}, { now = new Date(时钟()) } = {}) {
    const { 昨天, 截止, 到, 天数 } = 统计范围(参数, now.getTime());
    const 留存日期 = 截止 === 昨天 ? 日期(到 - 天) : 截止;
    const dates = Array.from({ length: 天数 }, (_, i) => 日期(到 - i * 天));
    const [分布, 页面, 留存, ...趋势] = await Promise.all([
      按日取('来源', 截止), 按日取('页面', 截止), 按日取('留存', 留存日期), ...dates.map(d => 按日取('趋势', d)),
    ]);
    const 来源次数 = 分布.list?.find(x => x.index === 'access_source_session_cnt')?.item_list ?? [];
    const 来源人数 = 分布.list?.find(x => x.index === 'access_source_visit_uv')?.item_list ?? [];
    const 留存值 = (组, key) => 数字(留存[组]?.find(x => x.key === key)?.value);
    return {
      日期: 截止, 最晚日期: 昨天, 天数,
      趋势: 趋势.map((row, i) => {
        const d = row.list?.[0];
        return { 日期: dates[i], 访客: 数字(d?.visit_uv), 新访客: 数字(d?.visit_uv_new),
          打开次数: 数字(d?.session_cnt), 页面访问次数: 数字(d?.visit_pv), ...(row.错误 && { 错误: row.错误 }) };
      }),
      来源: 来源次数.map(x => ({ 编号: x.key, 名称: 来源名[x.key] || '来源 ' + x.key, 打开次数: 数字(x.value),
        访客: 数字(来源人数.find(v => v.key === x.key)?.value) })).sort((a, b) => (b.打开次数 ?? 0) - (a.打开次数 ?? 0)),
      页面: (页面.list ?? []).map(x => ({ 路径: x.page_path, 访客: 数字(x.page_visit_uv), 访问次数: 数字(x.page_visit_pv),
        入口次数: 数字(x.entrypage_pv), 退出次数: 数字(x.exitpage_pv) })),
      留存: { 日期: 留存日期, 新访客: 留存值('visit_uv_new', 0), 新访客次日: 留存值('visit_uv_new', 1),
        访客: 留存值('visit_uv', 0), 访客次日: 留存值('visit_uv', 1) },
      错误: Object.fromEntries(Object.entries({ 来源: 分布, 页面, 留存 }).filter(([, v]) => v.错误).map(([k, v]) => [k, v.错误])),
    };
  };
}

export const 读取小程序统计 = 建统计读取器();
