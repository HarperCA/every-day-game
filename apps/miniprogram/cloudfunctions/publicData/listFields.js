// 列表只返回卡片和本地筛选用得到的字段（2026-10-18）。
//
// 为什么：小程序调用云函数，返回结果不能超过 1MB（腾讯云开发官方错误码 EXCEED_MAX_RESPONSE_SIZE：
// “小程序链路的最大响应包体为 1 MB”）。每条公开比赛有 62 个字段，其中赛制规则、参赛资格、来源、奖励等长文本
// 只有详情页才用；325 条全部带上是 1.21MB，超限后小程序要等一轮失败再退回美国服务器，中位数 9.5 秒。
// 只留下面这些字段，同样 325 条约 0.22MB。点进详情页走 get 动作，仍然返回完整记录，不受影响。
//
// 这份清单怎么来的：把 10 月 1 日以来各个版本首页卡片读过的字段取并集（报名状态、名称、届次、级别、专业、
// 推荐等级、截止日期、是否已归档），再加上手机端本地按专业/省份筛选要用的 professions、region。
// tests/public-data-list-fields.test.mjs 用真实形状的记录，对几个历史版本的字段转换代码逐条比对卡片内容。
const LIST_FIELDS = [
  'id', 'event_id', 'name', 'edition_name', 'edition_year', 'edition_ordinal',
  'event_level', 'professions', 'region',
  'registration_status', 'registration_start', 'registration_end', 'registration_end_note',
  'data_status', 'next_edition_estimate', 'last_verified_at',
  'recommendation', 'recommendation_reasons',
];

function toListItem(item) {
  const slim = {};
  for (const key of LIST_FIELDS) if (item[key] !== undefined) slim[key] = item[key];
  return slim;
}

// filterPublicRecords 的结果：只换掉 items，total / hasMore 等原样保留
function slimList(result) {
  return { ...result, items:(result.items || []).map(toListItem) };
}

module.exports = { LIST_FIELDS, toListItem, slimList };
