// 问卷统计 · 整理（纯计算）：照旧 publicSync/preferenceValidation.js 的 aggregatePreferences 搬（2026-11-02），只出计数，不带任何账号信息。
// 选项名单照旧（必须和小程序 services/filterOptions.ts、services/competitionPreferences.ts 一致），不在名单里的值丢掉，不报错。
//   整理(原始) → { 统计: { total, completed, skipped, noProfession, noCategory, noProvince, profession, categories, province }, 现在, 接好了, 来源 }
const PROFESSIONS = ['人文与法学', '外语与教育', '建筑与土木', '数学与统计', '机械与自动化', '材料与化工', '生物与医药', '电子信息', '经管与商科', '综合/不限专业', '能源与环境', '计算机与AI', '设计与艺术'];
const PROVINCES = ['北京市', '天津市', '河北省', '山西省', '内蒙古自治区', '辽宁省', '吉林省', '黑龙江省', '上海市', '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省', '河南省', '湖北省', '湖南省', '广东省', '广西壮族自治区', '海南省', '重庆市', '四川省', '贵州省', '云南省', '西藏自治区', '陕西省', '甘肃省', '青海省', '宁夏回族自治区', '新疆维吾尔自治区', '香港特别行政区', '澳门特别行政区', '台湾省'];
const SURVEY_STATUSES = ['completed', 'skipped'];

function 规整(行 = {}) {
  return {
    profession: PROFESSIONS.includes(行.profession) ? 行.profession : '',
    categories: Array.isArray(行.categories) ? [...new Set(行.categories.filter(值 => PROFESSIONS.includes(值)))] : [],
    province: PROVINCES.includes(行.province) ? 行.province : '',
    surveyStatus: SURVEY_STATUSES.includes(行.survey_status) ? 行.survey_status : 'completed',
  };
}

function aggregatePreferences(rows = []) {
  const count = (map, key) => { if (key) map[key] = (map[key] || 0) + 1; };
  const stats = { total: 0, completed: 0, skipped: 0, noProfession: 0, noCategory: 0, noProvince: 0, profession: {}, categories: {}, province: {} };
  for (const row of rows) {
    const item = 规整(row);
    stats.total += 1;
    stats[item.surveyStatus] += 1;
    if (item.surveyStatus !== 'completed') continue;
    if (item.profession) count(stats.profession, item.profession); else stats.noProfession += 1;
    if (item.categories.length) item.categories.forEach(value => count(stats.categories, value)); else stats.noCategory += 1;
    if (item.province) count(stats.province, item.province); else stats.noProvince += 1;
  }
  return stats;
}

export function 整理(原始) {
  if (!原始?.接好了) return { 接好了: false, 来源: 原始?.来源 };
  return { 统计: aggregatePreferences(原始.偏好们), 现在: 原始.现在, 接好了: true, 来源: 原始.来源 };
}
