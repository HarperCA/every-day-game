// 首次打开的偏好问卷（专业、关心的比赛大类、省份），登录用户存进账号（2026-10-09 起）。
// 选项必须和小程序 services/filterOptions.ts 的 PROFESSION_CATEGORIES、
// services/competitionPreferences.ts 的 surveyProvinceOptions 一致；不在名单里的值一律丢掉，不报错。
const PROFESSIONS = ['人文与法学', '外语与教育', '建筑与土木', '数学与统计', '机械与自动化', '材料与化工', '生物与医药', '电子信息', '经管与商科', '综合/不限专业', '能源与环境', '计算机与AI', '设计与艺术'];
const PROVINCES = ['北京市', '天津市', '河北省', '山西省', '内蒙古自治区', '辽宁省', '吉林省', '黑龙江省', '上海市', '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省', '河南省', '湖北省', '湖南省', '广东省', '广西壮族自治区', '海南省', '重庆市', '四川省', '贵州省', '云南省', '西藏自治区', '陕西省', '甘肃省', '青海省', '宁夏回族自治区', '新疆维吾尔自治区', '香港特别行政区', '澳门特别行政区', '台湾省'];
const SURVEY_STATUSES = ['completed', 'skipped'];

function normalizePreferenceInput(input = {}) {
  const profession = PROFESSIONS.includes(input.profession) ? input.profession : '';
  const categories = Array.isArray(input.categories) ? [...new Set(input.categories.filter(value => PROFESSIONS.includes(value)))] : [];
  const province = PROVINCES.includes(input.province) ? input.province : '';
  const surveyStatus = SURVEY_STATUSES.includes(input.surveyStatus) ? input.surveyStatus : 'completed';
  return { profession, categories, province, surveyStatus, dontShowAgain:input.dontShowAgain === true };
}

// 后台“问卷统计”用：只给计数，不带任何账号信息
function aggregatePreferences(rows = []) {
  const count = (map, key) => { if (key) map[key] = (map[key] || 0) + 1; };
  const stats = { total:0, completed:0, skipped:0, noProfession:0, noCategory:0, noProvince:0, profession:{}, categories:{}, province:{} };
  for (const row of rows) {
    const item = normalizePreferenceInput({ profession:row.profession, categories:row.categories, province:row.province, surveyStatus:row.survey_status });
    stats.total += 1;
    stats[item.surveyStatus] += 1;
    if (item.surveyStatus !== 'completed') continue;
    if (item.profession) count(stats.profession, item.profession); else stats.noProfession += 1;
    if (item.categories.length) item.categories.forEach(value => count(stats.categories, value)); else stats.noCategory += 1;
    if (item.province) count(stats.province, item.province); else stats.noProvince += 1;
  }
  return stats;
}

module.exports = { PROFESSIONS, PROVINCES, normalizePreferenceInput, aggregatePreferences };
