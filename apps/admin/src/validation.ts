export const participationFormats = ['个人赛', '团队赛', '个人或团队均可', '暂未明确'];
export const teamSizeCategories = ['1人', '2～3人', '4～5人', '6人及以上', '人数范围不固定', '暂未明确'];
export const feeTypes = ['免费', '收费', '不同赛项费用不同', '暂未公布'];
export const registrationOrganizations = ['自行报名', '学校统一报名', '两种方式均可', '需先校内选拔', '以赛区或学校通知为准', '暂未明确'];

export function validateAdminRecord(record: any): string[] {
  const errors: string[] = [];
  if (!record.name?.trim()) errors.push('赛事名称不能为空');
  if (!record.editionName?.trim()) errors.push('届次名称不能为空');
  if (!participationFormats.includes(record.participationFormat)) errors.push('参赛形式不在允许范围内');
  if (!teamSizeCategories.includes(record.teamSizeCategory)) errors.push('队伍人数不在允许范围内');
  if (!feeTypes.includes(record.feeType)) errors.push('报名费用不在允许范围内');
  if (!registrationOrganizations.includes(record.registrationOrganization)) errors.push('报名组织方式不在允许范围内');
  if (record.participationFormat !== '暂未明确' && !record.teamSize?.trim()) errors.push('明确参赛形式时必须保留组队人数原文');
  if (record.registrationOrganization !== '暂未明确' && !record.registrationMethod?.trim()) errors.push('明确报名组织方式时必须保留报名方式原文');
  if (record.feeType !== '暂未公布' && !record.fees?.trim()) errors.push('明确费用类型时必须填写费用说明原文');
  return errors;
}
