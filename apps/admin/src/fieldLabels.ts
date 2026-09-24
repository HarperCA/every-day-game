const objectLabels: Record<string, string> = {
  event_edition: '赛事届次',
  event_track: '赛事赛道',
  data_source: '信息来源',
};

const fieldLabels: Record<string, string> = {
  organizer: '主办方', name: '名称', data_status: '数据状态',
  registration_url: '报名链接', registration_start: '报名开始时间', registration_end: '报名截止时间',
};

/** 把审计记录的机器定位字段转换为后台可读的中文名称。 */
export function displayAuditField(value: string) {
  const colonPath = /^([a-z_]+):[^:]+(?::([a-z_]+))?$/.exec(value);
  const dotPath = /^([a-z_]+)\.([a-z_]+)$/.exec(value);
  const objectType = colonPath?.[1] || dotPath?.[1];
  const field = colonPath?.[2] || dotPath?.[2];
  if (!objectType) return fieldLabels[value] || value;
  const objectLabel = objectLabels[objectType] || objectType;
  return field ? `${objectLabel}·${fieldLabels[field] || field}` : objectLabel;
}
