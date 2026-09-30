// 来源链：每条候选记下它是走哪条路线、用哪个查询词、在哪一轮被发现的。
// 搜索额度按三条路线分配（2026-09-24 定为 60/25/15）。
export const ROUTES = Object.freeze({ trace:'追溯线索与主办方监测', gap:'覆盖空白', probe:'新词试探' });
export const ROUTE_SHARE = Object.freeze({ [ROUTES.trace]:0.6, [ROUTES.gap]:0.25, [ROUTES.probe]:0.15 });

// 平台抓取（天池、辽宁平台）属于追溯与监测，不花搜索额度；
// 当前固定的按专业百度查询属于覆盖空白。候选自己带了路线的以候选为准。
const SOURCE_ROUTE = { tianchi:ROUTES.trace, upln:ROUTES.trace, baidu:ROUTES.gap, 通知追溯:ROUTES.trace };

export function stampDiscovery(candidate, source, runId) {
  return { ...candidate, discovery:{ route:SOURCE_ROUTE[source] || null, source, ...(candidate.discovery || {}), runId } };
}
