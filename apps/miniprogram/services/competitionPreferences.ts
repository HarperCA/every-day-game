import { PROFESSION_CATEGORIES } from './filterOptions';
import { callUserData, getCurrentUserId, isCloudSessionReady } from './cloudSession';

const STORAGE_KEY = 'competition-preferences-v1';
const LEGACY_OWNER_KEY = 'competition-preferences-legacy-owner-v1';
function currentOwner() { return isCloudSessionReady() ? getCurrentUserId() : ''; }
function storageKey(base: string) { const owner = currentOwner(); return owner ? `${base}:${owner}` : base; }
function readPreferenceStorage(base: string) {
  const scoped = storageKey(base);
  const value = wx.getStorageSync(scoped);
  if (value !== undefined && value !== null && value !== '') return value;
  if (scoped === base) return value;
  // 老版本和未登录问卷只允许迁移给首个登录账号，避免复制给其他账号。
  const legacyOwner = wx.getStorageSync(LEGACY_OWNER_KEY);
  if (!legacyOwner || legacyOwner === currentOwner()) return wx.getStorageSync(base);
  return undefined;
}
function claimLegacyPreferences() {
  const owner = currentOwner();
  if (owner && !wx.getStorageSync(LEGACY_OWNER_KEY)) wx.setStorageSync(LEGACY_OWNER_KEY, owner);
}
let shownThisSession = false;
let reopenRequested = false;

export const surveyProvinceOptions = ['全国', '北京市', '天津市', '河北省', '山西省', '内蒙古自治区', '辽宁省', '吉林省', '黑龙江省', '上海市', '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省', '河南省', '湖北省', '湖南省', '广东省', '广西壮族自治区', '海南省', '重庆市', '四川省', '贵州省', '云南省', '西藏自治区', '陕西省', '甘肃省', '青海省', '宁夏回族自治区', '新疆维吾尔自治区', '香港特别行政区', '澳门特别行政区', '台湾省'];

export interface CompetitionPreferences {
  profession: string;
  categories: string[];
  province: string;
  dontShowAgain: boolean;
}

export function loadCompetitionPreferences(): CompetitionPreferences {
  let saved: any;
  try { saved = readPreferenceStorage(STORAGE_KEY); } catch (_error) { saved = null; }
  return normalizeCompetitionPreferences(saved);
}

// 旧单选专业只用于迁移；两步流程只保留一组多选专业方向。
export function normalizeCompetitionPreferences(saved: any): CompetitionPreferences {
  const categories = Array.isArray(saved?.categories)
    ? [...new Set<string>(saved.categories.filter((value: string) => PROFESSION_CATEGORIES.includes(value)))] : [];
  if (!categories.length && PROFESSION_CATEGORIES.includes(saved?.profession)) categories.push(saved.profession);
  return { profession: '', categories,
    province: surveyProvinceOptions.slice(1).includes(saved?.province) ? saved.province : '',
    dontShowAgain: saved?.dontShowAgain === true };
}

export function saveCompetitionPreferences(preferences: CompetitionPreferences) {
  wx.setStorageSync(storageKey(STORAGE_KEY), normalizeCompetitionPreferences(preferences));
}

// 登录用户把问卷答案存进账号（userData 云函数的 savePreferences），换手机登录能带上。
// 没登录就只存在本机；存账号失败不影响本机已经生效的筛选，下次登录时再补传。
export type SurveyStatus = 'completed' | 'skipped';
const SURVEY_STATUS_KEY = 'competition-preferences-status-v1';

export function saveSurveyStatus(status: SurveyStatus) {
  try { wx.setStorageSync(storageKey(SURVEY_STATUS_KEY), status); } catch (_error) { /* 记不住只影响下次补传 */ }
}

function loadSurveyStatus(): SurveyStatus | '' {
  try {
    const value = readPreferenceStorage(SURVEY_STATUS_KEY);
    return value === 'completed' || value === 'skipped' ? value : '';
  } catch (_error) { return ''; }
}

export async function uploadCompetitionPreferences(status?: SurveyStatus) {
  if (!isCloudSessionReady()) return false;
  const surveyStatus = status || loadSurveyStatus();
  if (!surveyStatus) return false;
  await callUserData('savePreferences', { preferences: { ...loadCompetitionPreferences(), surveyStatus } });
  return true;
}

// 登录后：账号里有答案、本机没填过的（换了手机），用账号里的；本机填过的，以本机为准传上去。
export async function syncCompetitionPreferencesAfterLogin() {
  const owner = currentOwner();
  claimLegacyPreferences();
  const status = loadSurveyStatus();
  if (status) {
    // 将迁移答案落到账号自己的缓存，后续访客修改不应改动此账号。
    saveCompetitionPreferences(loadCompetitionPreferences());
    saveSurveyStatus(status);
    await uploadCompetitionPreferences();
    return;
  }
  const cloud = await callUserData<any>('getPreferences');
  if (owner !== currentOwner()) throw new Error('账号已变更，请重新加载偏好');
  if (!cloud) return;
  const local = loadCompetitionPreferences();
  const normalizedCloud = normalizeCompetitionPreferences(cloud);
  saveCompetitionPreferences({
    profession: '',
    categories: Array.isArray(cloud.categories) || cloud.profession ? normalizedCloud.categories : local.categories,
    province: cloud.province === '' || surveyProvinceOptions.slice(1).includes(cloud.province) ? normalizedCloud.province : local.province,
    dontShowAgain: cloud.dontShowAgain === true || local.dontShowAgain,
  });
  if (cloud.surveyStatus === 'completed' || cloud.surveyStatus === 'skipped') saveSurveyStatus(cloud.surveyStatus);
}

export function shouldShowPreferenceSurvey() {
  if (shownThisSession || loadCompetitionPreferences().dontShowAgain) return false;
  shownThisSession = true;
  return true;
}

export function requestPreferenceSurvey() { reopenRequested = true; }
export function takePreferenceSurveyRequest() {
  const requested = reopenRequested;
  reopenRequested = false;
  return requested;
}

// 赛事的大类沿用已核验的专业关联标签，多选采用“任意一项匹配”。
export function matchesCompetitionPreferences(item: any, categories: string[] = [], province = '') {
  if (categories.length && !(item.professions || []).some((value: string) => value === '综合/不限专业' || categories.includes(value))) return false;
  if (!province) return true;
  const region = String(item.region || '').trim();
  // 没有明确地区限制的记录继续显示，避免把全国赛事或待核实地区误排除。
  if (!region || /全国|不限|全球|国际/.test(region)) return true;
  const short = province.replace(/壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市/g, '');
  if (region.includes(short)) return true;
  const regions: Record<string, string[]> = {
    华东:['上海','江苏','浙江','安徽','福建','江西','山东'], 华北:['北京','天津','河北','山西','内蒙古'],
    华南:['广东','广西','海南','香港','澳门'], 华中:['河南','湖北','湖南'],
    西南:['重庆','四川','贵州','云南','西藏'], 西北:['陕西','甘肃','青海','宁夏','新疆'], 东北:['辽宁','吉林','黑龙江'],
  };
  return Object.keys(regions).some(name => region.includes(name) && regions[name].includes(short));
}
