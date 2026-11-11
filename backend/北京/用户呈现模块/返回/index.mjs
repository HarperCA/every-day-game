// 返回：把排好的条目分页，换成首页卡片要的字段。字段名沿用现在的小程序（旧 publicData/listFields.js 的 LIST_FIELDS + list_group），
// 不用改小程序就能接。分页是累计的：第 n 页交回前 n×每页 条，手机整页替换。
//   返回({ 条目们, 搜到的专业 }, 条件, { now, 海报链接 }) → { items, total, hasMore, preview, listVersion, appliedFilters? }
//     有搜索词时 appliedFilters.categories 是搜索词对应的专业大类，手机显示在筛选面板上
// 只给卡片用得到的字段（小程序链路一次最多 1MB）；详情另外取。
// poster_url 每张卡片都带（和旧版一样）：海报链接(文件名) 给出链接，没有海报或北京还没收到这张图时是空的，小程序显示文字封面。
import { 报名状态 } from '../../../共用/推荐排序/index.mjs';

function 卡片(item, now, 海报链接) {
  const 推荐 = item.recommendation;
  const 卡 = {
    id: item.id, event_id: item.competition_id, name: item.name,
    edition_name: item.edition_name, edition_year: item.edition_year, edition_ordinal: item.edition_ordinal,
    event_level: item.level, professions: item.professions, region: item.region,
    registration_status: 报名状态(item, now), registration_start: item.registration_start, registration_end: item.registration_end,
    registration_end_note: item.registration_end_note,
    data_status: item.status === '已归档' ? 'archived' : 'published',
    next_edition_estimate: item.next_edition_estimate, last_verified_at: item.last_verified_at,
    // 比赛库里推荐存成对象（等级在 recommendation，理由在 reasons），卡片上只要等级和理由
    recommendation: typeof 推荐 === 'string' ? 推荐 : 推荐?.recommendation,
    recommendation_reasons: typeof 推荐 === 'object' && 推荐 ? 推荐.reasons : undefined,
  };
  const 留下 = Object.fromEntries(Object.entries(卡).filter(([, 值]) => 值 !== undefined && 值 !== null));
  return { ...留下, poster_url: item.poster?.file ? 海报链接(item.poster.file) : '', list_group: item.列表分组 };
}

export function 返回({ 条目们, 搜到的专业 }, 条件, { now = new Date(), 海报链接 = () => '' } = {}) {
  const 可见 = Math.min(条目们.length, 条件.页 * 条件.每页);
  return {
    items: 条目们.slice(0, 可见).map(item => 卡片(item, now, 海报链接)),
    total: 条目们.length,
    hasMore: 可见 < 条目们.length,
    preview: false,
    listVersion: 2,
    ...(搜到的专业 ? { appliedFilters: { categories: 搜到的专业 } } : {}),
  };
}
