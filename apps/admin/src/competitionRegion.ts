// 地区仅按比赛名称、届次名称或已核实地区字段推断，不参考主办学校所在地。
const REGION_PATTERNS: Array<[string, RegExp]> = [
  ['内蒙古自治区', /内蒙古(?:自治区|赛区|地区|高校|大学生)/], ['广西壮族自治区', /广西(?:壮族自治区|赛区|地区|高校|大学生)/],
  ['西藏自治区', /西藏(?:自治区|赛区|地区|高校|大学生)/], ['宁夏回族自治区', /宁夏(?:回族自治区|赛区|地区|高校|大学生)/],
  ['新疆维吾尔自治区', /新疆(?:维吾尔自治区|赛区|地区|高校|大学生)/],
  ['北京市', /北京(?:市|赛区|地区|高校|大学生)/], ['天津市', /天津(?:市|赛区|地区|高校|大学生)/],
  ['上海市', /上海(?:市|赛区|地区|高校|大学生)/], ['重庆市', /重庆(?:市|赛区|地区|高校|大学生)/],
  ...['河北','山西','辽宁','吉林','黑龙江','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','海南','四川','贵州','云南','陕西','甘肃','青海']
    .map(name => [`${name}省`, new RegExp(`${name}(?:省|赛区|地区|高校|大学生)`)] as [string, RegExp]),
  ['台湾地区', /台湾(?:地区|赛区|高校|大学生)/], ['香港特别行政区', /香港(?:特别行政区|赛区|地区|高校|大学生)/],
  ['澳门特别行政区', /澳门(?:特别行政区|赛区|地区|高校|大学生)/],
];

export function competitionRegion(record: any): string {
  const explicit = String(record?.region || '').trim();
  if (explicit) return explicit;
  const name = `${record?.name || ''} ${record?.editionName || ''}`;
  const area = name.match(/华北|华东|华南|华中|东北|西北|西南|长三角|珠三角|京津冀|东三省/);
  if (area) return `${area[0]}地区`;
  const province = REGION_PATTERNS.find(([, pattern]) => pattern.test(name));
  if (province) return province[0];
  if (record?.eventLevel === '国际级' || /国际|亚太|全球|世界/.test(name)) return '国际';
  if (/全国/.test(name)) return '全国';
  return '';
}
