import { registrationScheduleIssues } from './registrationSchedule';

export const eventLevels = ['国际级', '国家级', '省级/区域级', '其他/未明确'];
export const participationFormats = ['个人赛', '团队赛', '个人或团队均可', '暂未明确'];
export const teamSizeCategories = ['1人', '2～3人', '4～5人', '6人及以上', '人数范围不固定', '暂未明确'];
export const feeTypes = ['免费', '收费', '不同赛项费用不同', '暂未公布'];
export const registrationOrganizations = ['自行报名', '学校统一报名', '两种方式均可', '需先校内选拔', '以赛区或学校通知为准', '暂未明确'];

export function validateAdminRecord(record: any): string[] {
  const errors: string[] = [];
  errors.push(...registrationScheduleIssues(record.schedule));
  if (!record.name?.trim()) errors.push('赛事名称不能为空');
  if (!record.editionName?.trim()) errors.push('届次名称不能为空');
  if (/(?:19|20)\d{2}|第[零〇一二三四五六七八九十百千万两\d]+届/.test(String(record.name || ''))) errors.push('赛事名称只保留正文；年份和第几届请填入独立字段');
  if (record.editionYear && !/^(?:19|20)\d{2}(?:[—–~～至-](?:19|20)\d{2})?$/.test(String(record.editionYear).trim())) errors.push('年份请填写四位年份或年份区间');
  if (record.editionOrdinal && !/^第[零〇一二三四五六七八九十百千万两\d]+届(?:、第[零〇一二三四五六七八九十百千万两\d]+届)*$/.test(String(record.editionOrdinal).trim())) errors.push('第几届请填写“第八届”等格式');
  if (/通知/.test(String(record.name || '')) || /通知/.test(String(record.editionName || ''))) errors.push('名称含“通知”的条目只能作为线索，不得入赛事库');
  if (/[!！]/.test(String(record.name || '')) || /[!！]/.test(String(record.editionName || ''))) errors.push('名称含感叹号，不得入赛事库');
  if (/正式启动|正式开启|正式开赛|启动仪式|开幕仪式|正式拉开帷幕|火热开启|隆重开幕/.test(`${record.name || ''} ${record.editionName || ''}`)) errors.push('名称含“正式启动”等活动报道用语，不得入赛事库');
  if (!eventLevels.includes(record.eventLevel)) errors.push('赛事级别不在允许范围内');
  if (!participationFormats.includes(record.participationFormat)) errors.push('参赛形式不在允许范围内');
  if (!teamSizeCategories.includes(record.teamSizeCategory)) errors.push('队伍人数不在允许范围内');
  if (!feeTypes.includes(record.feeType)) errors.push('报名费用不在允许范围内');
  if (!registrationOrganizations.includes(record.registrationOrganization)) errors.push('报名组织方式不在允许范围内');
  if (record.participationFormat !== '暂未明确' && !record.teamSize?.trim()) errors.push('明确参赛形式时必须保留组队人数原文');
  if (record.registrationOrganization !== '暂未明确' && !record.registrationMethod?.trim()) errors.push('明确报名组织方式时必须保留报名方式原文');
  if (record.feeType !== '暂未公布' && !record.fees?.trim()) errors.push('明确费用类型时必须填写费用说明原文');
  return errors;
}
