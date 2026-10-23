// 偏好筛选（专业大类、省份），从手机端 services/competitionPreferences.ts 的 matchesCompetitionPreferences 原样搬来（2026-10-24）。
// 新版首页把筛选放到服务器做，规则必须和手机端一致：tests/public-list-order.test.mjs 用同一批样例对照两边结果。
const REGIONS = {
  华东:['上海', '江苏', '浙江', '安徽', '福建', '江西', '山东'], 华北:['北京', '天津', '河北', '山西', '内蒙古'],
  华南:['广东', '广西', '海南', '香港', '澳门'], 华中:['河南', '湖北', '湖南'],
  西南:['重庆', '四川', '贵州', '云南', '西藏'], 西北:['陕西', '甘肃', '青海', '宁夏', '新疆'], 东北:['辽宁', '吉林', '黑龙江'],
};

// 赛事的大类沿用已核验的专业关联标签，多选采用“任意一项匹配”，“综合/不限专业”的赛事对任何专业都算。
function matchesCategories(item, categories = []) {
  if (!categories.length) return true;
  return (item.professions || []).some(value => value === '综合/不限专业' || categories.includes(value));
}

function matchesProvince(item, province = '') {
  if (!province) return true;
  const region = String(item.region || '').trim();
  // 没有明确地区限制的记录继续显示，避免把全国赛事或待核实地区误排除。
  if (!region || /全国|不限|全球|国际/.test(region)) return true;
  // 选“全国”只要上面这些不限地区的赛事，各省和大区的赛事不算。
  if (province === '全国') return false;
  const short = province.replace(/壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市/g, '');
  if (region.includes(short)) return true;
  return Object.keys(REGIONS).some(name => region.includes(name) && REGIONS[name].includes(short));
}

function matchesCompetitionPreferences(item, categories = [], province = '') {
  return matchesCategories(item, categories) && matchesProvince(item, province);
}

module.exports = { matchesCategories, matchesCompetitionPreferences, matchesProvince };
